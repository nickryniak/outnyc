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

    // Build candidate pools.
    const openBuckets = req.bucketList
      .filter((b) => !b.done)
      .filter((b) => withinPrice(b.priceTier, req.price))
      .map(bucketToCandidate);

    const eventPool = req.events.filter((c) => withinPrice(c.priceTier, req.price));
    const placePool = req.places.filter((c) => withinPrice(c.priceTier, req.price));

    // Rank each pool. Bucket items get a placement priority boost by ranking
    // them first and prepending the best fit.
    const rankedBuckets = rankCandidates(openBuckets, req, seed);
    const rankedEvents = rankCandidates(eventPool, req, seed);
    const rankedPlaces = rankCandidates(placePool, req, seed);

    // Selection order: try to weave in one bucket item first (when it fits),
    // then alternate events/places to vary the day.
    const ordered: Candidate[] = [];
    if (rankedBuckets.length > 0) ordered.push(rankedBuckets[0].candidate);

    // Interleave remaining events + places by rank for variety.
    const evs = rankedEvents.map((s) => s.candidate);
    const pls = rankedPlaces.map((s) => s.candidate);
    let ei = 0;
    let pi = 0;
    // "more-food" front-loads places; "more-active" front-loads events.
    const placesFirst = req.modifier === 'more-food';
    while (ei < evs.length || pi < pls.length) {
      if (placesFirst) {
        if (pi < pls.length) ordered.push(pls[pi++]);
        if (ei < evs.length) ordered.push(evs[ei++]);
      } else {
        if (ei < evs.length) ordered.push(evs[ei++]);
        if (pi < pls.length) ordered.push(pls[pi++]);
      }
    }

    // Greedy time-packing within the window. Events keep their fixed times when
    // they fall inside the window; everything else flows sequentially with gaps.
    const items: PlanItem[] = [];
    let cursor = winStart;
    let order = 0;
    let lastNeighborhood: string | undefined;
    const usedIds = new Set<string>();

    for (const cand of ordered) {
      if (usedIds.has(cand.id)) continue;
      const dur = candidateDuration(cand);
      if (dur <= 0) continue;

      // Compute start/end. Fixed-time events anchor to their slot if it fits.
      let start: number;
      let end: number;
      if (cand.startTime && cand.endTime) {
        const cs = toMinutes(cand.startTime);
        const ce = toMinutes(cand.endTime);
        // Skip events that fall entirely outside the window.
        if (ce <= winStart || cs >= winEnd) continue;
        // Only place if it doesn't overlap what we've already scheduled.
        if (cs < cursor) continue;
        start = cs;
        end = Math.min(ce, winEnd);
      } else {
        start = cursor;
        end = start + dur;
        if (end > winEnd) continue; // doesn't fit remaining window
      }

      if (end > winEnd || start < cursor) continue;

      // Insert a walk connector on a neighborhood hop.
      if (
        lastNeighborhood &&
        cand.neighborhood &&
        cand.neighborhood !== lastNeighborhood &&
        start - cursor >= GAP_MIN
      ) {
        const walkBase = makeWalk(order, lastNeighborhood, cand.neighborhood);
        items.push({
          ...walkBase,
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

      // Stop when there's no meaningful time left.
      if (winEnd - cursor < 30) break;
    }

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
