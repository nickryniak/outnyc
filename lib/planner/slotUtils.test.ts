// =============================================================================
// OutNYC: tests for lib/planner/slotUtils.ts
// =============================================================================
// Pure shared planner logic: connector rebuilding, venue-identity keys, and
// the meal-time gating boundaries.
// =============================================================================

import { fromMinutes, toMinutes } from '../time';
import type { Candidate, PlanItem } from '../types';
import {
  allowedStart,
  BREAKFAST,
  COFFEE,
  DINNER,
  DRINKS,
  LUNCH,
  MAX_WALK_ONLY_GAP,
  mealSlotAt,
  rebuildConnectors,
  venueKey,
  WALK_CONNECTOR_MIN,
} from './slotUtils';

// ---- helpers -----------------------------------------------------------------

function stop(id: string, neighborhood: string, startMin: number, endMin: number): PlanItem {
  return {
    id,
    order: 0,
    kind: 'activity',
    title: id,
    neighborhood,
    startTime: fromMinutes(startMin),
    endTime: fromMinutes(endMin),
  };
}

function candidate(kind: Candidate['kind'], tags: string[] = []): Candidate {
  return { id: 'c', name: 'Test', kind, tags };
}

/** Minutes between the two real stops not covered by any walk/break row. */
function unattributedMinutes(items: PlanItem[], firstEnd: number, secondStart: number): number {
  const connectors = items.filter((i) => i.kind === 'walk' || i.kind === 'break');
  const covered = connectors.reduce(
    (sum, i) => sum + (toMinutes(i.endTime) - toMinutes(i.startTime)),
    0,
  );
  return secondStart - firstEnd - covered;
}

// ---- rebuildConnectors ---------------------------------------------------------

describe('rebuildConnectors', () => {
  // Two stops in different neighborhoods, `gap` minutes apart.
  const build = (gap: number) =>
    rebuildConnectors([
      stop('a', 'West Village', 600, 660),
      stop('b', 'SoHo', 660 + gap, 720 + gap),
    ]);

  it('leaves a sub-walk-size gap (10 min) alone: no connector rows', () => {
    // Below WALK_CONNECTOR_MIN there is nothing to draw; the planner's own
    // compaction passes remove such slack upstream.
    const items = build(10);
    expect(items.filter((i) => i.kind === 'walk' || i.kind === 'break')).toHaveLength(0);
  });

  it('spans an 18-min gap with a single gap-length walk (zero unattributed minutes)', () => {
    const items = build(18);
    const walks = items.filter((i) => i.kind === 'walk');
    expect(walks).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'break')).toHaveLength(0);
    expect(toMinutes(walks[0]!.startTime)).toBe(660);
    expect(toMinutes(walks[0]!.endTime)).toBe(678);
    expect(unattributedMinutes(items, 660, 678)).toBe(0);
  });

  it('spans a 25-min gap (the MAX_WALK_ONLY_GAP edge) with one walk', () => {
    expect(MAX_WALK_ONLY_GAP).toBe(25);
    const items = build(25);
    const walks = items.filter((i) => i.kind === 'walk');
    expect(walks).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'break')).toHaveLength(0);
    expect(unattributedMinutes(items, 660, 685)).toBe(0);
  });

  it('splits a 40-min gap into a canonical walk plus a break (zero unattributed minutes)', () => {
    const items = build(40);
    const walks = items.filter((i) => i.kind === 'walk');
    const breaks = items.filter((i) => i.kind === 'break');
    expect(walks).toHaveLength(1);
    expect(breaks).toHaveLength(1);
    expect(toMinutes(walks[0]!.endTime) - toMinutes(walks[0]!.startTime)).toBe(WALK_CONNECTOR_MIN);
    // The break starts where the walk ends and runs to the next stop.
    expect(walks[0]!.endTime).toBe(breaks[0]!.startTime);
    expect(toMinutes(breaks[0]!.endTime)).toBe(700);
    expect(unattributedMinutes(items, 660, 700)).toBe(0);
  });

  it('adds no connector between same-neighborhood stops regardless of gap', () => {
    const items = rebuildConnectors([
      stop('a', 'West Village', 600, 660),
      stop('b', 'West Village', 700, 760),
    ]);
    expect(items.filter((i) => i.kind === 'walk' || i.kind === 'break')).toHaveLength(0);
  });

  it('drops pre-existing walk/break rows and renumbers order chronologically', () => {
    const stale: PlanItem = {
      ...stop('old-walk', 'SoHo', 0, 10),
      kind: 'walk',
      title: 'stale walk',
    };
    const items = rebuildConnectors([stale, stop('b', 'SoHo', 700, 760), stop('a', 'West Village', 600, 660)]);
    expect(items.some((i) => i.id === 'old-walk')).toBe(false);
    expect(items.map((i) => i.order)).toEqual(items.map((_, idx) => idx));
    expect(items[0]!.id).toBe('a');
  });
});

// ---- venueKey ------------------------------------------------------------------

describe('venueKey', () => {
  it('collapses "<activity> at [the] <venue>" phrasings onto the venue identity', () => {
    expect(venueKey('Jazz set at the Village Vanguard')).toBe('village vanguard');
    expect(venueKey('Live Jazz at the Village Vanguard')).toBe('village vanguard');
    expect(venueKey('Stand-up at the Comedy Cellar')).toBe('comedy cellar');
  });

  it('uses the whole normalized name when there is no "at"', () => {
    expect(venueKey("Katz's Delicatessen")).toBe('katzs delicatessen');
    expect(venueKey('Via Carota')).toBe('via carota');
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(venueKey('  Peter Pan  Donut & Pastry ')).toBe('peter pan donut pastry');
  });
});

// ---- allowedStart meal gating ----------------------------------------------------

describe('allowedStart meal gating', () => {
  const restaurant = candidate('restaurant', ['food']);
  const coffee = candidate('restaurant', ['food', 'coffee']);
  const brunch = candidate('restaurant', ['food', 'brunch']);
  const lateNight = candidate('restaurant', ['food', 'late-night']);
  const bar = candidate('bar', ['bar']);

  it('shares the breakfast/lunch boundary: no dead zone at 11:00', () => {
    expect(BREAKFAST.end).toBe(LUNCH.start); // the shared-boundary invariant
    expect(allowedStart(restaurant, BREAKFAST.end)).toBe(true);
    expect(allowedStart(restaurant, LUNCH.start)).toBe(true);
    // An 11:15 table counts as lunch, not a between-meals slip-through.
    expect(mealSlotAt(toMinutes('11:15'))).toBe('lunch');
  });

  it('gates a plain restaurant to breakfast/lunch/dinner windows', () => {
    expect(allowedStart(restaurant, BREAKFAST.start)).toBe(true);
    expect(allowedStart(restaurant, LUNCH.end)).toBe(true);
    expect(allowedStart(restaurant, DINNER.start)).toBe(true);
    expect(allowedStart(restaurant, DINNER.end)).toBe(true);
    // Just past lunch and just before dinner are both closed.
    expect(allowedStart(restaurant, LUNCH.end + 1)).toBe(false);
    expect(allowedStart(restaurant, DINNER.start - 1)).toBe(false);
    // Before breakfast opens.
    expect(allowedStart(restaurant, BREAKFAST.start - 1)).toBe(false);
  });

  it('lets a brunch tag bridge the lunch-to-brunch gap but not past BRUNCH.end', () => {
    // 14:31 is past LUNCH.end and BRUNCH.end alike: closed even for brunch spots.
    expect(allowedStart(brunch, LUNCH.end + 1)).toBe(false);
    // 09:45 sits inside both BRUNCH and BREAKFAST: open either way.
    expect(allowedStart(brunch, toMinutes('09:45'))).toBe(true);
  });

  it('opens late-night tagged food after the dinner window closes', () => {
    const at22 = toMinutes('22:00');
    expect(allowedStart(lateNight, at22)).toBe(true);
    expect(allowedStart(restaurant, at22)).toBe(false);
  });

  it('gates coffee shops to COFFEE hours exactly at both boundaries', () => {
    expect(allowedStart(coffee, COFFEE.start)).toBe(true);
    expect(allowedStart(coffee, COFFEE.end)).toBe(true);
    expect(allowedStart(coffee, COFFEE.start - 1)).toBe(false);
    expect(allowedStart(coffee, COFFEE.end + 1)).toBe(false);
  });

  it('gates bars to DRINKS hours exactly at the opening boundary', () => {
    expect(allowedStart(bar, DRINKS.start)).toBe(true);
    expect(allowedStart(bar, DRINKS.start - 1)).toBe(false);
    expect(allowedStart(bar, DRINKS.end)).toBe(true);
  });

  it('never gates events or activities', () => {
    expect(allowedStart(candidate('event'), 0)).toBe(true);
    expect(allowedStart(candidate('activity'), toMinutes('03:00'))).toBe(true);
  });
});
