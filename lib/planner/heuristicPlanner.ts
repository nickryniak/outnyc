// =============================================================================
// OutNYC — deterministic heuristic planner (lib/planner/heuristicPlanner.ts)
// =============================================================================
// The DEFAULT planner. No LLM, no network, no key. It:
//   - filters candidates by price range and (softly) by neighborhood
//   - weaves in OPEN bucket items that fit window/price/neighborhood
//   - packs an ordered, walkable itinerary inside the window with realistic gaps
//   - inserts "walk" connectors between neighborhood hops
//   - applies the reshuffle modifier so output DIFFERS per modifier
//
// Determinism: given identical inputs (including modifier) it returns the same
// stop selection/order, so reshuffle with the SAME modifier is stable, while a
// DIFFERENT modifier yields a different plan. A tie-break "seed" mixes in the
// modifier + date so re-running across days/modifiers reshuffles selection.
// =============================================================================

import {
  fromMinutes,
  toMinutes,
  windowMinutes,
} from '../time';
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

// Transit/seating buffer inserted between stops (minutes).
const GAP_MIN = 15;
// Default duration for an event/activity without an explicit end (minutes).
const DEFAULT_EVENT_MIN = 90;
// Default duration for a place without an explicit duration (minutes).
const DEFAULT_PLACE_MIN = 60;

/** Deterministic small integer hash of a string (for stable tie-breaks). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function withinPrice(tier: PriceTier | undefined, price: PriceRange): boolean {
  if (tier == null) return true; // unknown price never excludes
  return tier >= price.min && tier <= price.max;
}

/** Effective duration (minutes) of a candidate within the window. */
function candidateDuration(c: Candidate): number {
  if (c.startTime && c.endTime) {
    return Math.max(0, toMinutes(c.endTime) - toMinutes(c.startTime));
  }
  if (c.durationMin && c.durationMin > 0) return c.durationMin;
  return c.kind === 'event' || c.kind === 'activity'
    ? DEFAULT_EVENT_MIN
    : DEFAULT_PLACE_MIN;
}

/** Tag-overlap count between a candidate's tags and the user's interests. */
function interestScore(tags: string[], interests: string[]): number {
  const set = new Set(interests.map((t) => t.toLowerCase()));
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
function rankCandidates(
  candidates: Candidate[],
  req: PlanRequest,
  seed: number,
): Scored[] {
  const nbset = new Set(req.neighborhoods.map((n) => n.toLowerCase()));
  return candidates
    .map((candidate) => {
      let score = 0;
      // Neighborhood match is a strong soft preference.
      if (candidate.neighborhood && nbset.has(candidate.neighborhood.toLowerCase())) {
        score += 5;
      }
      // Interest overlap.
      score += interestScore(candidate.tags, req.interests) * 2;
      // Modifier kind weighting.
      score += kindWeight(candidate.kind, req.modifier) * 3;
      // "cheaper" prefers lower tiers.
      if (req.modifier === 'cheaper') {
        score += (5 - (candidate.priceTier ?? 4)) * 2;
      }
      // Deterministic tie-break that varies by modifier+date so reshuffle
      // across modifiers reorders selection.
      const jitter = (hash(candidate.id + ':' + seed) % 7);
      // "surprise" leans heavily on the jitter for variety.
      score += req.modifier === 'surprise' ? jitter * 2 : jitter * 0.1;
      return { candidate, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable final tie-break by id hash.
      return hash(a.candidate.id) - hash(b.candidate.id);
    });
}

/** Convert an OPEN bucket item into a pseudo-candidate the packer can place. */
function bucketToCandidate(b: BucketItem): Candidate {
  return {
    id: b.id,
    name: b.title,
    kind: 'bucket',
    neighborhood: b.neighborhood,
    priceTier: b.priceTier,
    durationMin: 75,
    tags: b.tags,
  };
}

function makeWalk(order: number, from: string, to: string): Omit<PlanItem, 'startTime' | 'endTime'> {
  return {
    id: `walk-${order}`,
    order,
    kind: 'walk',
    title: `Walk: ${from} → ${to}`,
    neighborhood: to,
    note: 'Short walk between stops.',
  };
}

export class HeuristicPlanner implements Planner {
  readonly name = 'On-device heuristic';
  readonly isLive = false; // always the default; not gated behind a key

  async plan(req: PlanRequest): Promise<Plan> {
    const winStart = toMinutes(req.window.start);
    const winEnd = toMinutes(req.window.end);
    const totalMin = windowMinutes(req.window);
    const seed = hash(`${req.date}:${req.modifier ?? 'default'}`);

    // The "cheaper" modifier tightens the ceiling so pricey stops (including
    // fixed events) drop out, not just get down-weighted.
    const effPrice: PriceRange =
      req.modifier === 'cheaper'
        ? { min: req.price.min, max: Math.min(req.price.max, req.price.min + 1) as PriceTier }
        : req.price;

    // Build candidate pools.
    const openBuckets = req.bucketList
      .filter((b) => !b.done)
      .filter((b) => withinPrice(b.priceTier, effPrice))
      .map(bucketToCandidate);

    const eventPool = req.events.filter((c) => withinPrice(c.priceTier, effPrice));
    const placePool = req.places.filter((c) => withinPrice(c.priceTier, effPrice));

    // Rank each pool. Bucket items get a placement priority boost by ranking
    // them first and prepending the best fit.
    const rankedBuckets = rankCandidates(openBuckets, req, seed);
    const rankedEvents = rankCandidates(eventPool, req, seed);
    const rankedPlaces = rankCandidates(placePool, req, seed);

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
    const isFixed = (c: Candidate): boolean =>
      !!c.startTime &&
      !!c.endTime &&
      toMinutes(c.endTime) > winStart &&
      toMinutes(c.startTime) < winEnd;

    const fixed = preference
      .filter(isFixed)
      .sort((a, b) => toMinutes(a.startTime as string) - toMinutes(b.startTime as string));
    const flexible = preference.filter((c) => !isFixed(c));

    const items: PlanItem[] = [];
    let cursor = winStart;
    let order = 0;
    let lastNeighborhood: string | undefined;
    const usedIds = new Set<string>();

    /** Place a stop, inserting a walk connector on a neighborhood hop. */
    const pushStop = (cand: Candidate, start: number, end: number): void => {
      if (
        lastNeighborhood &&
        cand.neighborhood &&
        cand.neighborhood !== lastNeighborhood &&
        start - cursor >= GAP_MIN
      ) {
        items.push({
          ...makeWalk(order, lastNeighborhood, cand.neighborhood),
          startTime: fromMinutes(cursor),
          endTime: fromMinutes(Math.min(cursor + GAP_MIN, start)),
        });
        order += 1;
      }
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
        sourceId: cand.kind === 'bucket' ? undefined : cand.id,
        bucketItemId: cand.kind === 'bucket' ? cand.id : undefined,
      });
      order += 1;
      usedIds.add(cand.id);
      lastNeighborhood = cand.neighborhood ?? lastNeighborhood;
      cursor = end + GAP_MIN;
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
          if (end + (reserveGap ? GAP_MIN : 0) <= limit) {
            pushStop(cand, start, end);
            progressed = true;
            break;
          }
        }
      }
    };

    // Pack: before each fixed event, fill the gap with flexible stops, then
    // anchor the event at its real time. After the last event, fill to the end
    // of the window so it never leaves a big empty hole.
    for (const ev of fixed) {
      const evS = toMinutes(ev.startTime as string);
      const evE = Math.min(toMinutes(ev.endTime as string), winEnd);
      if (evS < cursor) continue; // no room before this event; skip it
      fillUntil(evS, true);
      if (evS < cursor) continue; // a filler overran; skip rather than overlap
      pushStop(ev, evS, evE);
    }
    fillUntil(winEnd, false);

    // If nothing fit (e.g. tiny window), leave items empty — the UI shows an
    // empty state explaining why.
    void totalMin;

    return {
      id: `plan-${req.date}-${req.window.start}-${req.window.end}-${req.modifier ?? 'base'}-${seed}`,
      date: req.date,
      window: req.window,
      neighborhoods: req.neighborhoods,
      price: req.price,
      partySize: req.partySize,
      generatedBy: 'heuristic',
      modifier: req.modifier,
      items,
      createdAt: new Date().toISOString(),
    };
  }
}

export const heuristicPlanner: Planner = new HeuristicPlanner();
