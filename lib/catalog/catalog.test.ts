// =============================================================================
// OutNYC: catalog invariants (lib/catalog/catalog.test.ts)
// =============================================================================
// Guards the generated area catalogs (and the hand-picked core they merge
// with): unique ids, valid kinds per pool, real neighborhoods, sane times,
// durations, price tiers, coordinates inside NYC, and known tags. A bad entry
// here would silently corrupt planning, so it fails loudly instead.
// =============================================================================

import { BUCKET_SEED, NEIGHBORHOODS, SEED_EVENTS, SEED_PLACES } from '../constants';
import { venueKey } from '../planner/slotUtils';

const ALLOWED_TAGS = new Set([
  'food',
  'bar',
  'coffee',
  'brunch',
  'late-night',
  'live music',
  'comedy',
  'art',
  'outdoors',
  'walk',
  'film',
  'rooftop',
]);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const NB_SET = new Set<string>(NEIGHBORHOODS);

describe('curated catalog', () => {
  const all = [...SEED_PLACES, ...SEED_EVENTS];

  it('is big enough that NYC never runs dry', () => {
    expect(SEED_PLACES.length).toBeGreaterThan(200);
    expect(SEED_EVENTS.length).toBeGreaterThan(100);
  });

  it('has globally unique ids', () => {
    const seen = new Set<string>();
    for (const c of all) {
      expect(seen.has(c.id)).toBe(false);
      seen.add(c.id);
    }
  });

  it('keeps kinds in the right pool', () => {
    for (const c of SEED_PLACES) {
      expect(['restaurant', 'bar']).toContain(c.kind);
    }
    for (const c of SEED_EVENTS) {
      expect(['event', 'activity']).toContain(c.kind);
    }
  });

  it('only names supported neighborhoods (or none, for citywide picks)', () => {
    for (const c of all) {
      if (c.neighborhood != null) {
        expect(NB_SET.has(c.neighborhood)).toBe(true);
      }
    }
  });

  it('gives every neighborhood real coverage', () => {
    for (const nb of NEIGHBORHOODS) {
      const places = SEED_PLACES.filter((c) => c.neighborhood === nb);
      expect(places.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('uses valid times, durations, and price tiers', () => {
    for (const c of all) {
      if (c.startTime || c.endTime) {
        expect(c.startTime).toMatch(HHMM);
        expect(c.endTime).toMatch(HHMM);
        expect(c.endTime! > c.startTime!).toBe(true);
      } else {
        expect(c.durationMin ?? 60).toBeGreaterThan(0);
      }
      if (c.priceTier != null) {
        expect([1, 2, 3, 4]).toContain(c.priceTier);
      }
    }
  });

  it('keeps coordinates inside NYC', () => {
    for (const c of all) {
      if (c.lat == null || c.lng == null) continue;
      expect(c.lat).toBeGreaterThan(40.5);
      expect(c.lat).toBeLessThan(41.0);
      expect(c.lng).toBeGreaterThan(-74.3);
      expect(c.lng).toBeLessThan(-73.6);
    }
  });

  it('only uses known tags (and tags food/bars consistently)', () => {
    for (const c of all) {
      for (const t of c.tags) {
        expect(ALLOWED_TAGS.has(t)).toBe(true);
      }
      if (c.kind === 'restaurant') expect(c.tags).toContain('food');
      if (c.kind === 'bar') expect(c.tags).toContain('bar');
    }
  });

  it('covers the cuisines the swap chips offer', () => {
    // Every cuisine chip in the day panel must be satisfiable from the seed
    // catalog alone (no live key), or the chip is a permanently dead button.
    const chipCuisines = [
      'Italian',
      'Pizza',
      'Japanese',
      'Sushi',
      'Thai',
      'Chinese',
      'Korean',
      'Indian',
      'Mexican',
      'French',
      'Southern',
      'Greek',
      'Deli',
      'Mediterranean',
      'Peruvian',
      'Seafood',
      'Steakhouse',
      'Vegan',
      'Bakery',
      'Coffee',
    ];
    const have = new Set(SEED_PLACES.map((c) => c.cuisine).filter(Boolean));
    for (const cuisine of chipCuisines) {
      expect(have.has(cuisine)).toBe(true);
    }
  });
});

// =============================================================================
// Decade-proofing invariants (added after the 2026-07 edge-case audit).
// =============================================================================

describe('catalog durability', () => {
  const ALL = [...SEED_EVENTS, ...SEED_PLACES];

  it('gives every neighborhood something to eat, drink, and do', () => {
    // A neighborhood with an empty pool silently falls back to citywide
    // floaters (a beach day, a ballgame), which reads as a broken plan.
    for (const nb of NEIGHBORHOODS) {
      const inNb = ALL.filter((c) => c.neighborhood === nb);
      const count = (kind: string) => inNb.filter((c) => c.kind === kind).length;
      expect({ nb, restaurants: count('restaurant') > 0 }).toEqual({ nb, restaurants: true });
      expect({ nb, bars: count('bar') > 0 }).toEqual({ nb, bars: true });
      // Events and activities both fill the "Do" slot.
      const toDo = count('activity') + count('event');
      expect({ nb, thingsToDo: toDo > 0 }).toEqual({ nb, thingsToDo: true });
    }
  });

  it('prices every activity, so "cheaper" never ranks a free park last', () => {
    // scoring.ts reads (5 - (priceTier ?? 4)): an unpriced free park would
    // score as if it cost $$$$ under the cheaper modifier.
    const unpriced = ALL.filter((c) => c.kind === 'activity' && c.priceTier == null);
    expect(unpriced.map((c) => c.id)).toEqual([]);
  });

  /**
   * Entries whose copy mentions a season or a weekday, but where the VENUE
   * itself is open year-round / any day: the mention is an amenity, a name, or
   * a "come on the weekend" aside. Reviewed by hand; anything not on this list
   * must carry real `months` / `daysOfWeek`. Adding an id here is a deliberate
   * statement that the place is open outside the season its copy evokes.
   */
  const REVIEWED_UNCONSTRAINED = new Set([
    'bk-mcgolrick-park', // park open daily; only its farmers market is Sunday
    'qc-culture-lab-lic', // galleries open all week; the shows are on weekends
    'up-eagle-nyc', // bar open nightly; Sunday beer blasts are one event
    'up-ess-a-bagel', // open daily; "the weekend line" is a queue, not a schedule
    'up-the-penrose', // gastropub open daily; weekend brunch is one service
    'bk-sunday-in-brooklyn', // "Sunday" is the restaurant's NAME
    'bk-ramona', // cocktail bar open nightly; weekend DJs are one program
    'bk-miriam', // brunch spot open daily
    'qc-astoria-park-track', // park and track open year-round; only the pool is summer
    'dt-adriennes-pizzabar', // pizzeria open year-round; only the picnic tables are summer
  ]);

  it('constrains seasonal and day-specific entries so they cannot be planned out of season', () => {
    // Anything whose own copy claims a season or a weekday must carry the
    // metadata the providers filter on, or the planner will schedule a
    // February beach day. Collect every offender so one run lists them all.
    const seasonalWords = /\b(seasonal|summer|beach|kayak)\b/i;
    const dayWords = /\b(sunday|saturday|weekend)\b/i;
    const missingMonths: string[] = [];
    const missingDays: string[] = [];
    for (const c of ALL) {
      if (REVIEWED_UNCONSTRAINED.has(c.id)) continue;
      const text = `${c.name} ${c.description ?? ''}`;
      if (seasonalWords.test(text) && c.months == null) missingMonths.push(c.id);
      if (dayWords.test(text) && c.daysOfWeek == null) missingDays.push(c.id);
    }
    expect({ missingMonths, missingDays }).toEqual({ missingMonths: [], missingDays: [] });
  });

  it('keeps months and daysOfWeek in range', () => {
    for (const c of ALL) {
      for (const m of c.months ?? []) expect(m).toBeGreaterThanOrEqual(1);
      for (const m of c.months ?? []) expect(m).toBeLessThanOrEqual(12);
      for (const d of c.daysOfWeek ?? []) expect(d).toBeGreaterThanOrEqual(0);
      for (const d of c.daysOfWeek ?? []) expect(d).toBeLessThanOrEqual(6);
    }
  });

  it('never lets one real venue hide behind two different names', () => {
    // venueKey() is the identity the never-repeat rule and same-day dedup use.
    // Two entries for one place must SHARE a key (so only one is scheduled);
    // two different places must NOT (so visiting one does not ban the other).
    const byKey = new Map<string, string[]>();
    for (const c of ALL) {
      const k = venueKey(c.name);
      byKey.set(k, [...(byKey.get(k) ?? []), c.id]);
    }
    // Same place, deliberately sharing an identity.
    const expectedShared: Record<string, string[]> = {
      'film forum': ['evt-film-forum', 'evt-film-matinee'],
      'high line': ['evt-highline-art', 'act-highline-day'],
      'roosevelt island': ['up-roosevelt-island-tram', 'qc-roosevelt-island-tram-loop'],
      'union hall': ['bk-union-hall-comedy', 'bk-union-hall-bar'],
      'socrates sculpture park': ['qc-socrates-sculpture-park', 'qc-socrates-outdoor-cinema'],
    };
    const collisions = [...byKey].filter(([, ids]) => ids.length > 1);
    for (const [key, ids] of collisions) {
      expect({ key, ids: ids.sort() }).toEqual({ key, ids: (expectedShared[key] ?? []).sort() });
    }
    // Every declared sharing actually happens (catches a rename that split one).
    for (const key of Object.keys(expectedShared)) {
      expect({ key, shared: (byKey.get(key)?.length ?? 0) > 1 }).toEqual({ key, shared: true });
    }
  });

  it('resolves the whole High Line to one venue across bucket seed and catalog', () => {
    // The user's own wish and the two catalog entries are the same park: if
    // their keys diverged, one week could schedule the High Line three times.
    const highLine = BUCKET_SEED.find((b) => b.id === 'seed-bucket-0');
    expect(highLine).toBeDefined();
    expect(venueKey(highLine!.title)).toBe('high line');
  });
});
