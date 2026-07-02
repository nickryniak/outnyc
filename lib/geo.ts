// =============================================================================
// OutNYC — neighborhood geography (lib/geo.ts)
// =============================================================================
// Maps a live venue's coordinates onto the app's neighborhood list, so venues
// from external APIs (Ticketmaster etc.) participate in the strict neighborhood
// filter instead of bypassing it. A venue near none of the listed neighborhoods
// is labeled OUTSIDE_AREA_LABEL — a real string that matches no selection, so
// the strict filter honestly EXCLUDES it (rather than `undefined`, which reads
// as location-agnostic and would always pass).
// =============================================================================

import { NEIGHBORHOODS } from './constants';

/** Approximate centroid of each supported neighborhood. */
export const NEIGHBORHOOD_CENTERS: Record<string, { lat: number; lng: number }> = {
  'West Village': { lat: 40.7336, lng: -74.0027 },
  'East Village': { lat: 40.7265, lng: -73.9815 },
  'Lower East Side': { lat: 40.715, lng: -73.9843 },
  Williamsburg: { lat: 40.7143, lng: -73.9535 },
  Chelsea: { lat: 40.7465, lng: -74.0014 },
  SoHo: { lat: 40.7233, lng: -74.003 },
  Greenpoint: { lat: 40.7245, lng: -73.9514 },
  DUMBO: { lat: 40.7033, lng: -73.9881 },
  'Financial District': { lat: 40.7075, lng: -74.0113 },
  Harlem: { lat: 40.8116, lng: -73.9465 },
  Astoria: { lat: 40.7644, lng: -73.9235 },
  Bushwick: { lat: 40.6944, lng: -73.9213 },
};

/** Label for live venues that sit outside every supported neighborhood. */
export const OUTSIDE_AREA_LABEL = 'Elsewhere in NYC';

/** Great-circle distance in km. */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * The supported neighborhood nearest to (lat, lng) within `maxKm`, else
 * OUTSIDE_AREA_LABEL. maxKm=2 comfortably covers each neighborhood's real
 * footprint without gluing distant venues onto the closest listed area.
 */
export function nearestNeighborhood(lat: number, lng: number, maxKm = 2): string {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const name of NEIGHBORHOODS) {
    const c = NEIGHBORHOOD_CENTERS[name];
    if (!c) continue;
    const km = haversineKm(lat, lng, c.lat, c.lng);
    if (km < bestKm) {
      bestKm = km;
      best = name;
    }
  }
  return best && bestKm <= maxKm ? best : OUTSIDE_AREA_LABEL;
}
