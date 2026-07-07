// =============================================================================
// OutNYC — catalog invariants (lib/catalog/catalog.test.ts)
// =============================================================================
// Guards the generated area catalogs (and the hand-picked core they merge
// with): unique ids, valid kinds per pool, real neighborhoods, sane times,
// durations, price tiers, coordinates inside NYC, and known tags. A bad entry
// here would silently corrupt planning, so it fails loudly instead.
// =============================================================================

import { NEIGHBORHOODS, SEED_EVENTS, SEED_PLACES } from '../constants';

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
