// =============================================================================
// OutNYC — tests for lib/geo.ts
// =============================================================================

import { NEIGHBORHOODS } from './constants';
import { haversineKm, nearestNeighborhood, NEIGHBORHOOD_CENTERS, OUTSIDE_AREA_LABEL } from './geo';

describe('NEIGHBORHOOD_CENTERS', () => {
  // Runtime guard for the list-desync trap: adding a neighborhood to
  // NEIGHBORHOODS without a centroid would silently drop it from geo matching.
  it('has a finite centroid for every supported neighborhood', () => {
    for (const name of NEIGHBORHOODS) {
      const c = NEIGHBORHOOD_CENTERS[name];
      expect(c).toBeDefined();
      if (!c) continue; // toBeDefined already failed; narrow for TS
      expect(Number.isFinite(c.lat)).toBe(true);
      expect(Number.isFinite(c.lng)).toBe(true);
      // Sanity: all centroids are actually in NYC.
      expect(c.lat).toBeGreaterThan(40.5);
      expect(c.lat).toBeLessThan(41.0);
      expect(c.lng).toBeGreaterThan(-74.3);
      expect(c.lng).toBeLessThan(-73.6);
    }
  });
});

describe('haversineKm', () => {
  it('is zero for identical points and symmetric', () => {
    expect(haversineKm(40.73, -74.0, 40.73, -74.0)).toBe(0);
    const ab = haversineKm(40.7336, -74.0027, 40.7143, -73.9535);
    const ba = haversineKm(40.7143, -73.9535, 40.7336, -74.0027);
    expect(ab).toBeCloseTo(ba, 10);
    // West Village to Williamsburg is roughly 4.7km as the crow flies.
    expect(ab).toBeGreaterThan(4);
    expect(ab).toBeLessThan(6);
  });
});

describe('nearestNeighborhood', () => {
  it('maps known venue coordinates onto their neighborhoods', () => {
    // The Village Vanguard (178 7th Ave S).
    expect(nearestNeighborhood(40.7359, -74.0008)).toBe('West Village');
    // Lilia (567 Union Ave) — central Williamsburg.
    expect(nearestNeighborhood(40.7146, -73.9563)).toBe('Williamsburg');
    // The Dead Rabbit (30 Water St).
    expect(nearestNeighborhood(40.7033, -74.0114)).toBe('Financial District');
    // Mid-Central Park sits inside the Upper West Side footprint.
    expect(nearestNeighborhood(40.785, -73.968)).toBe('Upper West Side');
  });

  it('returns OUTSIDE_AREA_LABEL for venues beyond every neighborhood footprint', () => {
    // JFK Airport — nowhere near any supported neighborhood.
    expect(nearestNeighborhood(40.6413, -73.7781)).toBe(OUTSIDE_AREA_LABEL);
    // Coney Island — miles south of the closest centroid (Park Slope).
    expect(nearestNeighborhood(40.5755, -73.9707)).toBe(OUTSIDE_AREA_LABEL);
  });

  it('honors a custom maxKm radius', () => {
    // Randall's Island is outside the default 2km but inside a loosened 5km,
    // where Harlem becomes the nearest match.
    expect(nearestNeighborhood(40.793, -73.921)).toBe(OUTSIDE_AREA_LABEL);
    expect(nearestNeighborhood(40.793, -73.921, 5)).toBe('Harlem');
  });
});
