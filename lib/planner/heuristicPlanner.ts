// =============================================================================
// OutNYC — deterministic heuristic planner (lib/planner/heuristicPlanner.ts)
// =============================================================================
// The DEFAULT planner. No network, no key. It:
//   - filters candidates by price range and (softly) by neighborhood
//   - EXCLUDES candidates on req.excludeIds (never-repeat regenerates); if the
//     exclusion starves the pools it widens the price filter one notch, and
//     only reuses old picks once the whole catalog is exhausted
//   - gates food/drinks to sensible hours (coffee mornings, lunch midday,
//     dinner evenings, drinks at night) and fills the rest with activities
//   - weaves in OPEN bucket items that fit window/price/neighborhood
//   - boosts candidates matching the day's holiday context (e.g. July 4th)
//   - packs an ordered, walkable itinerary and inserts walk connectors
//   - writes a one-line "why this pick" note on every stop
//
// Determinism: identical inputs (including modifier + nonce) return the same
// plan; the nonce is bumped per reshuffle for fresh variety.
// =============================================================================

import { fromMinutes, toMinutes, windowMinutes } from '../time';
import type {
  BucketItem,
  Candidate,
  Plan,
  PlanItem,
  PlanItemKind,
  PlanModifier,
  PriceRange,
  PriceTier,
} from '../types';
import type { Planner, PlanRequest } from './planner';
import {
  allowedStart,
  candidateDuration,
  hash,
  matchesNeighborhoods,
  mealSlotAt,
  rebuildConnectors,
  venueKey,
  type MealSlot,
} from './slotUtils';

// Transit/seating buffer inserted between stops (minutes).
const GAP_MIN = 15;
// Most bars a single window will schedule.
const MAX_BARS = 2;
// Longest single visit for a fixed/all-day event, so a market does not eat a
// whole window.
const MAX_FIXED_VISIT = 150;
// Longest a single flexible stop may be stretched to swallow an idle gap, so
// tightening the day never balloons one activity into the whole evening.
const MAX_STRETCH = 180;
// A "soft" (recurring civic/park program, not a ticketed show) fixed-time
// candidate is dropped rather than forced in if it would strand the day with
// more than this much dead time after something else is already scheduled.
const MAX_ISOLATION_GAP = 120;

/**
 * Tighten the day so blocks flow without big empty gaps: stretch each FLEXIBLE
 * stop's end toward the next stop's start. A 15-minute transit buffer is left
 * only when the next stop is in a DIFFERENT (known) neighborhood — a walk
 * connector then fills it, so there is no visible hole; same-neighborhood stops
 * run back to back. Fixed-time stops (real events, meal anchors) are never
 * stretched past their true end, and the trailing tail after the last stop is
 * left alone (end-of-day, not a gap "between" activities). Pure + deterministic;
 * mutates the passed items.
 */
export function closeGaps(
  items: PlanItem[],
  winEnd: number,
  fixedIds: Set<string>,
): PlanItem[] {
  const sorted = [...items].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const cur = sorted[i];
    if (fixedIds.has(cur.id)) continue; // never stretch a real event / meal anchor
    const next = sorted[i + 1];
    const curStart = toMinutes(cur.startTime);
    const curEnd = toMinutes(cur.endTime);
    const nextStart = toMinutes(next.startTime);
    // Reserve a transit buffer ONLY when rebuildConnectors will actually insert
    // a walk — i.e. both neighborhoods are known AND differ. If either side has
    // no neighborhood (e.g. a location-agnostic bucket pick), no walk is drawn,
    // so reserving 15 min there would just leave a dead hole; run back to back.
    const needsWalk =
      !!cur.neighborhood && !!next.neighborhood && cur.neighborhood !== next.neighborhood;
    const buffer = needsWalk ? GAP_MIN : 0;
    const target = Math.min(nextStart - buffer, curStart + MAX_STRETCH, winEnd);
    if (target > curEnd) cur.endTime = fromMinutes(target);
  }
  return sorted;
}

/**
 * Compact the packed schedule so idle time between stops never exceeds the
 * transit buffer, wherever venue hours allow it:
 *   pass 1 (pull earlier): every flexible stop's start moves as early as its
 *     meal/venue gating allows, down to prevEnd + buffer — this erases holes
 *     the packer's "nudge forward and retry" left behind.
 *   pass 2 (close leading slack): if the first pinned or hours-gated stop still
 *     has a hole before it, the flexible run at the HEAD of the day shifts
 *     later as one piece to sit flush against it — the day simply starts later
 *     instead of trapping dead time in the middle.
 *   (closeGaps then stretches flexible stops toward the next as a final pass.)
 * Real fixed-time events never move; meal anchors keep their start (meals
 * happen at meal times). Deterministic; mutates the passed items.
 */
export function compactStops(
  items: PlanItem[],
  winStart: number,
  winEnd: number,
  realFixedIds: Set<string>,
  anchorIds: Set<string>,
  candById: Map<string, Candidate>,
): PlanItem[] {
  const sorted = [...items].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const buffer = (a: PlanItem, b: PlanItem) =>
    a.neighborhood && b.neighborhood && a.neighborhood !== b.neighborhood ? GAP_MIN : 0;
  const movable = (s: PlanItem) => !realFixedIds.has(s.id) && !anchorIds.has(s.id);

  /** True if `stop` may START at `t` without breaking hours or meal rules. */
  const canStartAt = (stop: PlanItem, t: number): boolean => {
    const cand = candById.get(stop.id);
    if (cand && !allowedStart(cand, t)) return false;
    if (stop.kind === 'restaurant') {
      // One restaurant per meal slot: moving into a slot that another stop
      // already occupies would double-book the meal.
      const slot = mealSlotAt(t);
      if (slot !== mealSlotAt(toMinutes(stop.startTime))) {
        for (const other of sorted) {
          if (other === stop || other.kind !== 'restaurant') continue;
          if (mealSlotAt(toMinutes(other.startTime)) === slot) return false;
        }
      }
    }
    return true;
  };

  const shiftTo = (stop: PlanItem, t: number): void => {
    const dur = toMinutes(stop.endTime) - toMinutes(stop.startTime);
    stop.startTime = fromMinutes(t);
    stop.endTime = fromMinutes(t + dur);
  };

  // Pass 1: pull each flexible stop's start as early as gating allows.
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i];
    if (!movable(cur)) continue;
    const prev = i > 0 ? sorted[i - 1] : undefined;
    const lower = prev ? toMinutes(prev.endTime) + buffer(prev, cur) : winStart;
    const curS = toMinutes(cur.startTime);
    for (let t = lower; t < curS; t += 5) {
      if (canStartAt(cur, t)) {
        shiftTo(cur, t);
        break;
      }
    }
  }

  // Pass 2: close the hole before the first pinned/gated stop by moving the
  // head run later as one piece. Only the run anchored at the window start can
  // shift later without just relocating the hole, so we handle exactly that.
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    const prev = sorted[i - 1];
    const gap = toMinutes(cur.startTime) - toMinutes(prev.endTime) - buffer(prev, cur);
    if (gap <= 0) continue;
    const run = sorted.slice(0, i);
    if (!run.every(movable)) break;
    let shift = gap;
    while (shift > 0) {
      const ok = run.every((s) => {
        const t = toMinutes(s.startTime) + shift;
        const dur = toMinutes(s.endTime) - toMinutes(s.startTime);
        return t + dur <= winEnd && canStartAt(s, t);
      });
      if (ok) break;
      // Step down but never below zero: a gap that isn't a multiple of 5 (live
      // events have odd-minute starts) must not underflow into a NEGATIVE
      // shift, which would slide the run before winStart / into gated hours.
      shift = shift > 5 ? shift - 5 : 0;
    }
    if (shift > 0) {
      for (const s of run) shiftTo(s, toMinutes(s.startTime) + shift);
    }
    break; // later holes are absorbed by the stretch pass
  }

  return sorted;
}

function withinPrice(tier: PriceTier | undefined, price: PriceRange): boolean {
  if (tier == null) return true; // unknown price never excludes
  return tier >= price.min && tier <= price.max;
}

/** Tag-overlap count between a candidate's tags and a tag list. */
function overlap(tags: string[], wanted: string[]): number {
  const set = new Set(wanted.map((t) => t.toLowerCase()));
  return tags.reduce((n, t) => (set.has(t.toLowerCase()) ? n + 1 : n), 0);
}

/** How a modifier weights different kinds (higher = preferred). */
function kindWeight(kind: PlanItemKind, modifier?: PlanModifier): number {
  switch (modifier) {
    case 'more-food':
      return kind === 'restaurant' ? 3 : kind === 'bar' ? 1 : 0;
    case 'more-active':
      return kind === 'activity' ? 3 : kind === 'event' ? 2 : 0;
    case 'cheaper':
      return 0; // price handled separately by the cheaper bias
    case 'surprise':
      return 0; // surprise relies on the seed shuffle below
    default:
      return kind === 'event' ? 1 : 0;
  }
}

interface Scored {
  candidate: Candidate;
  score: number;
}

/** Score + sort candidates for a given modifier (deterministic). */
function rankCandidates(candidates: Candidate[], req: PlanRequest, seed: number): Scored[] {
  const nbset = new Set(req.neighborhoods.map((n) => n.toLowerCase()));
  return candidates
    .map((candidate) => {
      let score = 0;
      // Neighborhood: a strong preference for a match, and a real penalty for a
      // stop in a neighborhood the user did NOT pick, so a day set to Manhattan
      // does not casually schedule a Brooklyn stop when local options exist.
      if (candidate.neighborhood) {
        score += nbset.has(candidate.neighborhood.toLowerCase()) ? 6 : -3;
      }
      // Interest overlap.
      score += overlap(candidate.tags, req.interests) * 2;
      // Holiday context: lean into the day (e.g. rooftops on July 4th).
      if (req.holiday) {
        score += overlap(candidate.tags, req.holiday.boostTags) * 4;
      }
      // Modifier kind weighting.
      score += kindWeight(candidate.kind, req.modifier) * 3;
      // "cheaper" prefers lower tiers.
      if (req.modifier === 'cheaper') {
        score += (5 - (candidate.priceTier ?? 4)) * 2;
      }
      // Deterministic tie-break that varies by modifier+date so reshuffle
      // across modifiers reorders selection.
      const jitter = hash(candidate.id + ':' + seed) % 7;
      // "surprise" leans heavily on jitter; an explicit reshuffle (nonce > 0)
      // also shuffles noticeably, while the first generation stays near-stable.
      const jitterWeight = req.modifier === 'surprise' ? 2 : req.nonce ? 1.3 : 0.1;
      score += jitter * jitterWeight;
      return { candidate, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable final tie-break by id hash.
      return hash(a.candidate.id) - hash(b.candidate.id);
    });
}

/**
 * Rough real-world duration (minutes) for an open-ended bucket wish, inferred
 * from its title/tags, so "Walk all of Manhattan" is not scheduled as a tidy
 * 75-minute slot. Big-day wishes get big durations and therefore only land when
 * a window is actually long enough for them.
 */
function estimateBucketDuration(title: string, tags: string[]): number {
  const t = title.toLowerCase();
  if (/\ball of\b|entire|marathon|all day|whole (day|city|island)/.test(t)) return 300;
  if (/beach|island|hike|kayak|bike|greenway|ferry|rockaway|governors|day trip/.test(t)) return 210;
  if (/museum|gallery|tour|exhibit|botanical|garden|\bzoo\b|aquarium/.test(t)) return 120;
  if (/show|concert|jazz|comedy|movie|film|broadway|play|opera|\bsnl\b|stand-?up|game|match/.test(t)) {
    return 150;
  }
  if (/brunch|dinner|lunch|breakfast/.test(t) || tags.includes('food')) return 90;
  if (/coffee|drinks|cocktail|rooftop|\bbar\b/.test(t) || tags.includes('bar')) return 75;
  if (/walk|stroll|wander|bridge|park/.test(t) || tags.includes('walk') || tags.includes('outdoors')) {
    return 90;
  }
  return 90;
}

/** Convert an OPEN bucket item into a pseudo-candidate the packer can place. */
function bucketToCandidate(b: BucketItem): Candidate {
  return {
    id: b.id,
    name: b.title,
    kind: 'bucket',
    neighborhood: b.neighborhood,
    priceTier: b.priceTier,
    durationMin: estimateBucketDuration(b.title, b.tags),
    description: b.note ?? 'One of your bucket-list picks.',
    tags: b.tags,
  };
}

/** One-line "why this pick" (no em dashes; joined with a middot). */
function whyNote(c: Candidate, req: PlanRequest): string | undefined {
  const reasons: string[] = [];
  if (c.kind === 'bucket') reasons.push('From your list');
  if (req.holiday && overlap(c.tags, req.holiday.boostTags) > 0) {
    reasons.push(`A good ${req.holiday.name} pick`);
  }
  const interestHits = c.tags.filter((t) =>
    req.interests.some((i) => i.toLowerCase() === t.toLowerCase()),
  );
  if (interestHits.length > 0) reasons.push(`Matches ${interestHits[0]}`);
  if (
    c.neighborhood &&
    req.neighborhoods.some((n) => n.toLowerCase() === c.neighborhood!.toLowerCase())
  ) {
    reasons.push(`In your ${c.neighborhood} picks`);
  }
  if (reasons.length === 0) return undefined;
  return reasons.slice(0, 2).join(' · ');
}

export class HeuristicPlanner implements Planner {
  readonly name = 'On-device heuristic';
  readonly isLive = false; // always the default; not gated behind a key

  async plan(req: PlanRequest): Promise<Plan> {
    const winStart = toMinutes(req.window.start);
    const winEnd = toMinutes(req.window.end);
    const totalMin = windowMinutes(req.window);
    const seed = hash(`${req.date}:${req.modifier ?? 'default'}:${req.nonce ?? 0}`);
    const excluded = new Set(req.excludeIds ?? []);

    // The "cheaper" modifier tightens the ceiling so pricey stops (including
    // fixed events) drop out, not just get down-weighted.
    const basePrice: PriceRange =
      req.modifier === 'cheaper'
        ? { min: req.price.min, max: Math.min(req.price.max, req.price.min + 1) as PriceTier }
        : req.price;

    // A picked neighborhood is respected end to end: every pool drops venues in
    // neighborhoods the user did NOT select (location-agnostic picks, like a
    // bucket wish with no set area, always stay). This is applied at EVERY price
    // widening below — the planner never widens the neighborhood filter, only
    // price. So no reshuffle or starvation fallback can smuggle in a stop across
    // town.
    const inArea = (c: Candidate) => matchesNeighborhoods(c.neighborhood, req.neighborhoods);

    /** Build the candidate pools for a price range, honoring the exclusions. */
    const buildPools = (price: PriceRange, honorExclusions: boolean) => {
      // Excluded by raw id OR by venue identity: a bucket wish ("Jazz set at
      // the Village Vanguard") and a curated/live listing for the SAME real
      // place ("Live Jazz at the Village Vanguard") must both be caught, even
      // though they carry different ids.
      const skip = (c: Candidate) =>
        honorExclusions && (excluded.has(c.id) || excluded.has(venueKey(c.name)));
      return {
        buckets: req.bucketList
          .filter((b) => !b.done)
          .filter((b) => withinPrice(b.priceTier, price))
          .map(bucketToCandidate)
          .filter((c) => inArea(c) && !skip(c)),
        events: req.events.filter((c) => inArea(c) && withinPrice(c.priceTier, price) && !skip(c)),
        places: req.places.filter((c) => inArea(c) && withinPrice(c.priceTier, price) && !skip(c)),
      };
    };

    // Never-repeat is ABSOLUTE: if the fresh pools are starved we widen the
    // PRICE filter (one notch, then fully) but the exclusion list is always
    // honored — a venue the user has already been given this week never comes
    // back as if it were a fresh pick. When the catalog is genuinely exhausted
    // the day honestly gets fewer stops instead of silently repeating.
    let pools = buildPools(basePrice, true);
    if (pools.places.length < 3 || pools.events.length < 2) {
      const widened: PriceRange = {
        min: Math.max(1, basePrice.min - 1) as PriceTier,
        max: Math.min(4, basePrice.max + 1) as PriceTier,
      };
      pools = buildPools(widened, true);
      if (pools.places.length + pools.events.length < 3) {
        pools = buildPools({ min: 1, max: 4 }, true);
      }
    }

    // Rank each pool. Bucket items get a placement priority boost by ranking
    // them first and prepending the best fit.
    const rankedBuckets = rankCandidates(pools.buckets, req, seed);
    const rankedEvents = rankCandidates(pools.events, req, seed);
    const rankedPlaces = rankCandidates(pools.places, req, seed);

    // Preference order: weave in one bucket item first (when it fits), then
    // alternate events/places by rank for variety.
    const preference: Candidate[] = [];
    if (rankedBuckets.length > 0) preference.push(rankedBuckets[0].candidate);

    const evs = rankedEvents.map((s) => s.candidate);
    const pls = rankedPlaces.map((s) => s.candidate);
    let ei = 0;
    let pi = 0;
    // "more-food" front-loads places; "more-active" front-loads events.
    const placesFirst = req.modifier === 'more-food';
    while (ei < evs.length || pi < pls.length) {
      if (placesFirst) {
        if (pi < pls.length) preference.push(pls[pi++]);
        if (ei < evs.length) preference.push(evs[ei++]);
      } else {
        if (ei < evs.length) preference.push(evs[ei++]);
        if (pi < pls.length) preference.push(pls[pi++]);
      }
    }

    // Split into fixed-time events (must be anchored to their real slot inside
    // the window) and flexible fillers (buckets/places/timeless activities).
    // A candidate with real start/end times that do NOT overlap the window is
    // dropped outright: a 8pm show cannot be "moved" to a noon slot.
    const hasTimes = (c: Candidate): boolean => !!c.startTime && !!c.endTime;
    const isFixed = (c: Candidate): boolean =>
      hasTimes(c) &&
      toMinutes(c.endTime as string) > winStart &&
      toMinutes(c.startTime as string) < winEnd;

    // Meal anchors: if the window covers a mealtime, reserve a restaurant so a
    // night out always includes dinner (and a midday plan includes lunch),
    // instead of two fixed events crowding food out. Anchors are synthetic
    // fixed stops; the packer places them ahead of same-time events.
    const restaurants = rankedPlaces.map((s) => s.candidate).filter((c) => c.kind === 'restaurant');
    const anchorUsed = new Set<string>();
    const anchors: Candidate[] = [];
    const addAnchor = (centerMin: number, dur: number) => {
      const start = Math.max(winStart, centerMin);
      if (start + dur > winEnd) return;
      const cand = restaurants.find((c) => !anchorUsed.has(c.id) && allowedStart(c, start));
      if (!cand) return;
      anchorUsed.add(cand.id);
      anchors.push({ ...cand, startTime: fromMinutes(start), endTime: fromMinutes(start + dur) });
    };
    if (winStart < toMinutes('14:00') && winEnd > toMinutes('12:00')) addAnchor(toMinutes('12:00'), 75);
    if (winStart < toMinutes('21:00') && winEnd > toMinutes('17:30')) addAnchor(toMinutes('17:30'), 90);
    const anchorIds = new Set(anchors.map((a) => a.id));

    const fixed = [...preference.filter(isFixed), ...anchors].sort((a, b) => {
      const d = toMinutes(a.startTime as string) - toMinutes(b.startTime as string);
      if (d !== 0) return d;
      // On a tie, the meal anchor is placed first so it is not crowded out.
      return (anchorIds.has(a.id) ? 0 : 1) - (anchorIds.has(b.id) ? 0 : 1);
    });
    // A flexible candidate for the SAME real place as an already-committed
    // fixed event (a bucket wish for "the Village Vanguard" alongside a real
    // Vanguard show) must never enter the flexible pool at all — otherwise it
    // could get placed by a fill pass that runs BEFORE the fixed event itself
    // is pushed, which a same-pass venue check can't catch after the fact.
    const fixedVenueKeys = new Set(fixed.map((f) => venueKey(f.name)));
    const flexible = preference.filter(
      (c) => !hasTimes(c) && !anchorIds.has(c.id) && !fixedVenueKeys.has(venueKey(c.name)),
    );

    const items: PlanItem[] = [];
    let cursor = winStart;
    let order = 0;
    const usedIds = new Set<string>();
    // Venue-identity dedup: a bucket wish and a curated/live listing for the
    // SAME real place must never both land in one day's plan, even though
    // they carry different ids (see venueKey's doc comment).
    const usedVenueKeys = new Set<string>();
    const usedMealSlots = new Set<MealSlot>();
    let barCount = 0;

    /** Place a stop. Walk connectors are added by the post-pass. */
    const pushStop = (cand: Candidate, start: number, end: number): void => {
      items.push({
        id: cand.id,
        order,
        kind: cand.kind,
        title: cand.name,
        neighborhood: cand.neighborhood,
        startTime: fromMinutes(start),
        endTime: fromMinutes(end),
        priceTier: cand.priceTier,
        lat: cand.lat,
        lng: cand.lng,
        address: cand.address,
        bookingUrl: cand.bookingUrl,
        rating: cand.rating,
        ratingCount: cand.ratingCount,
        description: cand.description,
        note: whyNote(cand, req),
        tags: cand.tags,
        cuisine: cand.cuisine,
        sourceId: cand.kind === 'bucket' ? undefined : cand.id,
        bucketItemId: cand.kind === 'bucket' ? cand.id : undefined,
      });
      order += 1;
      usedIds.add(cand.id);
      usedVenueKeys.add(venueKey(cand.name));
      if (cand.kind === 'restaurant') usedMealSlots.add(mealSlotAt(start));
      if (cand.kind === 'bar') barCount += 1;
      cursor = end + GAP_MIN;
    };

    /** True if a flexible candidate may be placed starting at `start`. */
    const mayPlace = (cand: Candidate, start: number): boolean => {
      if (usedVenueKeys.has(venueKey(cand.name))) return false; // same real place already in today's plan
      if (!allowedStart(cand, start)) return false;
      if (cand.kind === 'restaurant') {
        const slot = mealSlotAt(start);
        if (usedMealSlots.has(slot)) return false; // one restaurant per meal
      }
      if (cand.kind === 'bar' && barCount >= MAX_BARS) return false;
      return true;
    };

    /**
     * Greedily fill the current cursor forward with flexible stops until `limit`
     * (first-fit over the ranked queue). When `reserveGap` is set we leave a
     * transit buffer before `limit` so a following fixed event isn't overlapped.
     */
    const fillUntil = (limit: number, reserveGap: boolean): void => {
      let progressed = true;
      while (progressed && limit - cursor >= 30) {
        progressed = false;
        for (const cand of flexible) {
          if (usedIds.has(cand.id)) continue;
          const dur = candidateDuration(cand);
          if (dur <= 0) continue;
          const start = cursor;
          const end = start + dur;
          if (end + (reserveGap ? GAP_MIN : 0) > limit) continue;
          if (!mayPlace(cand, start)) continue;
          pushStop(cand, start, end);
          progressed = true;
          break;
        }
        // If nothing fits at the cursor (e.g. mid-afternoon with only dinner
        // spots left), nudge forward half an hour and try again so a later
        // meal window can still be reached instead of ending the day early.
        if (!progressed && limit - cursor >= 90) {
          cursor += 30;
          progressed = true;
        }
      }
    };

    // Pack: before each fixed event, fill the gap with flexible stops, then
    // anchor the event at its real time (clipped to the window, so an event
    // already in progress at window start is joined late, not dropped). After
    // the last event, fill to the end of the window.
    for (const ev of fixed) {
      const evS = Math.max(toMinutes(ev.startTime as string), winStart);
      // Cap a single visit so an all-day event (a 7-hour flea market) does not
      // swallow the whole window and crowd everything else out.
      const evE = Math.min(toMinutes(ev.endTime as string), winEnd, evS + MAX_FIXED_VISIT);
      if (evE - evS < 20) continue; // too little of it left to be worth going
      if (evS < cursor) continue; // no room before this event; skip it
      // Snapshot BEFORE filling: fillUntil's own "nudge forward when nothing
      // fits" fallback silently advances the cursor even when it places
      // nothing, which would otherwise hide the true size of an unfillable
      // gap from the isolation check below.
      const cursorBeforeFill = cursor;
      fillUntil(evS, true);
      if (evS < cursor) continue; // a filler overran; skip rather than overlap
      // A "soft" (drop-in, non-ticketed) event isolated by a big dead stretch
      // AFTER the day has already started — with nothing available to bridge
      // it — is worse than just not including it. A real ticket is always
      // kept regardless of the gap it needs. Measure the gap from the END OF
      // THE LAST REAL STOP anywhere in the plan so far (not the exploratory
      // "nudge forward" cursor, which advances even when nothing more fits —
      // and NOT gated on whether THIS fillUntil call specifically placed
      // something, since one early filler stop followed by a long unfillable
      // stretch must still count as isolated).
      if (ev.soft) {
        const lastPlaced = items.length > 0 ? items[items.length - 1] : null;
        const trueGapStart = lastPlaced ? toMinutes(lastPlaced.endTime) : winStart;
        if (lastPlaced && evS - trueGapStart > MAX_ISOLATION_GAP) {
          // Undo the nudge-only cursor advance so a dropped event never
          // pollutes the next fixed event's own gap math.
          cursor = cursorBeforeFill;
          continue;
        }
      }
      // A flexible candidate for the SAME real place is never even in the
      // flexible pool (the pre-filter above), so two DIFFERENT fixed events
      // that merely share a venue name (e.g. a matinee and an evening
      // showtime at Film Forum) are independent real listings and must NOT be
      // deduped just because venueKey() collapses them.
      pushStop(ev, evS, evE);
    }
    fillUntil(winEnd, false);

    // If nothing fit (e.g. tiny window), leave items empty — the UI shows an
    // empty state explaining why.
    void totalMin;

    // Tighten the day so idle time between stops never exceeds transit time:
    // pull starts earlier, close any leading hole, then stretch flexible stops
    // toward the next. Only REAL fixed-time events are fully pinned; meal
    // anchors keep their start (meals happen at meal times) but may run longer
    // (a leisurely dinner beats a dead hour before a show).
    const realFixedIds = new Set<string>(
      fixed.filter((f) => !anchorIds.has(f.id)).map((f) => f.id),
    );
    const candById = new Map<string, Candidate>();
    for (const c of [...pools.buckets, ...pools.events, ...pools.places, ...anchors]) {
      candById.set(c.id, c);
    }
    const compacted = compactStops(items, winStart, winEnd, realFixedIds, anchorIds, candById);
    const tightened = closeGaps(compacted, winEnd, realFixedIds);

    return {
      id: `plan-${req.date}-${req.window.start}-${req.window.end}-${req.modifier ?? 'base'}-${seed}`,
      date: req.date,
      window: req.window,
      neighborhoods: req.neighborhoods,
      price: req.price,
      partySize: req.partySize,
      generatedBy: 'heuristic',
      modifier: req.modifier,
      items: rebuildConnectors(tightened),
      createdAt: new Date().toISOString(),
    };
  }
}

export const heuristicPlanner: Planner = new HeuristicPlanner();
