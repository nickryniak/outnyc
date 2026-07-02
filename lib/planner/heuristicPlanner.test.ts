// =============================================================================
// OutNYC — tests for lib/planner/heuristicPlanner.ts
// =============================================================================
// Drives the planner exactly the way the store's runPlan does: seed profile
// prefs, the open bucket list, and the curated SEED_EVENTS/SEED_PLACES pools
// (what the zero-key providers serve). No store import — the request is built
// by hand from the same pieces.
// =============================================================================

import { BUCKET_SEED, SEED_EVENTS, SEED_PLACES, SEED_PROFILE } from '../constants';
import { holidayFor } from '../holidays';
import { toMinutes } from '../time';
import type { Plan, PlanItem, TimeWindow } from '../types';
import { heuristicPlanner } from './heuristicPlanner';
import type { PlanRequest } from './planner';

// A plain Tuesday (no holiday context) so tests aren't coupled to boost tags.
const DATE = '2026-07-07';

/** Build a PlanRequest the way lib/store.ts's runPlan does. */
function request(window: TimeWindow, overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    date: DATE,
    window,
    neighborhoods: SEED_PROFILE.defaultNeighborhoods,
    price: SEED_PROFILE.priceRange,
    partySize: SEED_PROFILE.partySize,
    interests: SEED_PROFILE.interests,
    bucketList: BUCKET_SEED.filter((b) => !b.done),
    events: SEED_EVENTS,
    places: SEED_PLACES,
    nonce: 0,
    excludeIds: [],
    holiday: holidayFor(DATE),
    ...overrides,
  };
}

const WINDOWS: TimeWindow[] = [
  { start: '11:00', end: '13:30' }, // short lunch window
  { start: '15:00', end: '19:00' }, // afternoon
  { start: '09:00', end: '23:00' }, // all day
];

function sortedByStart(items: PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
}

/** Stable view of a plan for equality checks (createdAt is wall-clock). */
function fingerprint(plan: Plan): unknown {
  return { id: plan.id, items: plan.items };
}

describe('HeuristicPlanner', () => {
  it('is deterministic: the same request twice yields an identical plan', async () => {
    for (const window of WINDOWS) {
      const a = await heuristicPlanner.plan(request(window));
      const b = await heuristicPlanner.plan(request(window));
      expect(fingerprint(b)).toEqual(fingerprint(a));
      expect(a.items.length).toBeGreaterThan(0);
    }
  });

  it('never schedules overlapping items in any window', async () => {
    for (const window of WINDOWS) {
      const plan = await heuristicPlanner.plan(request(window));
      const items = sortedByStart(plan.items);
      for (let i = 1; i < items.length; i += 1) {
        const prevEnd = toMinutes(items[i - 1]!.endTime);
        const curStart = toMinutes(items[i]!.startTime);
        expect(curStart).toBeGreaterThanOrEqual(prevEnd);
      }
    }
  });

  it('keeps every item inside the requested window', async () => {
    for (const window of WINDOWS) {
      const plan = await heuristicPlanner.plan(request(window));
      const winStart = toMinutes(window.start);
      const winEnd = toMinutes(window.end);
      for (const item of plan.items) {
        expect(toMinutes(item.startTime)).toBeGreaterThanOrEqual(winStart);
        expect(toMinutes(item.endTime)).toBeLessThanOrEqual(winEnd);
        expect(toMinutes(item.endTime)).toBeGreaterThan(toMinutes(item.startTime));
      }
    }
  });

  it('widens the price filter when the tier has zero restaurants, so dinner still lands', async () => {
    // Tier 4 has NO seed places at all (curated data tops out at $$$), while
    // price-agnostic events keep the events pool healthy — the exact starvation
    // shape the per-pool widening guards against.
    const price = { min: 4 as const, max: 4 as const };
    expect(
      SEED_PLACES.some((p) => p.priceTier != null && p.priceTier >= 4),
    ).toBe(false);
    const events = SEED_EVENTS.map((e) => ({ ...e, priceTier: undefined }));
    const plan = await heuristicPlanner.plan(
      request({ start: '17:00', end: '22:00' }, { price, events }),
    );
    // Widening one notch (to $$$) reaches real restaurants, so the dinner
    // anchor exists instead of the evening being all events.
    expect(plan.items.some((i) => i.kind === 'restaurant')).toBe(true);
  });

  it('produces distinct plans for distinct nonces (reshuffle variety hook)', async () => {
    const window: TimeWindow = { start: '09:00', end: '23:00' };
    const a = await heuristicPlanner.plan(request(window, { nonce: 0 }));
    const b = await heuristicPlanner.plan(request(window, { nonce: 1 }));
    // Seeds differ, so at minimum the plan ids differ; determinism per nonce
    // still holds (checked above). Item-level variety is jitter-dependent.
    expect(b.id).not.toEqual(a.id);
  });
});
