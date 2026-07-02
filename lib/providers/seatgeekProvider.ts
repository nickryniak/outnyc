// =============================================================================
// OutNYC — SeatGeek events provider (lib/providers/seatgeekProvider.ts)
// =============================================================================
// A second real event source alongside Ticketmaster — SeatGeek's catalog often
// covers indie venues, sports, and comedy that Ticketmaster misses. Key-gated
// on EXPO_PUBLIC_SEATGEEK_CLIENT_ID; returns [] (never seed data — the
// eventsProvider owns the seed floor) when no key is set or on any failure.
// NEVER throws.
//
// TODO(prod): route the SeatGeek client id through a server/edge function
// rather than bundling EXPO_PUBLIC_SEATGEEK_CLIENT_ID into the client.
// =============================================================================

import { env, providerFlags } from '../config';
import { nearestNeighborhood, OUTSIDE_AREA_LABEL } from '../geo';
import { addDays, fromMinutes, toMinutes } from '../time';
import type { Candidate, PriceTier } from '../types';
import type { ProviderResult } from './eventsProvider';
import { fetchJson } from './net';

const SG_URL = 'https://api.seatgeek.com/2/events';
// Same NYC-wide search center/radius as the Ticketmaster provider.
const SG_LAT = 40.7359;
const SG_LON = -73.9911;
const SG_RANGE = '10mi';
// SeatGeek gives no end time; same conservative assumption already used for
// Ticketmaster events.
const DEFAULT_EVENT_RUNTIME_MIN = 150;

function sgPriceTier(lowest: unknown): PriceTier | undefined {
  if (typeof lowest !== 'number' || Number.isNaN(lowest)) return undefined;
  if (lowest <= 25) return 1;
  if (lowest <= 60) return 2;
  if (lowest <= 120) return 3;
  return 4;
}

/** Map a SeatGeek taxonomy name onto the app's interest tags. */
function sgTags(taxonomies: any): string[] {
  const name: string = Array.isArray(taxonomies) ? (taxonomies[0]?.name ?? '') : '';
  if (name === 'concert' || name === 'music_festival') return ['live music'];
  if (name === 'comedy') return ['comedy'];
  if (name === 'theater' || name === 'classical' || name === 'dance_performance_tour') {
    return ['art'];
  }
  if (name === 'film') return ['film'];
  return [];
}

/** Map one SeatGeek event into a Candidate, or null if unusable for `date`. */
function sgToCandidate(e: any, date: string): Candidate | null {
  if (e?.time_tbd) return null; // no real start time to schedule against
  const dt: unknown = e?.datetime_local;
  if (typeof dt !== 'string' || dt.slice(0, 10) !== date) return null;
  const startTime = dt.slice(11, 16);
  const endTime = fromMinutes(Math.min(toMinutes(startTime) + DEFAULT_EVENT_RUNTIME_MIN, 1439));

  const venue = e?.venue;
  const lat = typeof venue?.location?.lat === 'number' ? venue.location.lat : undefined;
  const lng = typeof venue?.location?.lon === 'number' ? venue.location.lon : undefined;
  const neighborhood = lat != null && lng != null ? nearestNeighborhood(lat, lng) : OUTSIDE_AREA_LABEL;

  const address = [venue?.address, venue?.city].filter(Boolean).join(', ');
  const performer: string | undefined = Array.isArray(e?.performers)
    ? e.performers.find((p: any) => p?.primary)?.name
    : undefined;
  const taxonomyName: string | undefined = e?.taxonomies?.[0]?.name;
  const description =
    [taxonomyName, venue?.name ? `at ${venue.name}` : performer].filter(Boolean).join(' ') ||
    'Live event.';

  return {
    id: `sg-${e.id}`,
    name: e.title,
    kind: 'event',
    neighborhood,
    priceTier: sgPriceTier(e?.stats?.lowest_price),
    startTime,
    endTime,
    lat,
    lng,
    address: address || undefined,
    bookingUrl: typeof e?.url === 'string' ? e.url : undefined,
    description,
    tags: sgTags(e?.taxonomies),
  };
}

export const seatgeekProvider = {
  async fetchEvents(date: string): Promise<ProviderResult> {
    if (!providerFlags.seatgeek.isLive) {
      return { candidates: [], live: false };
    }
    try {
      // datetime_local is venue-local wall-clock time (unlike Ticketmaster's
      // UTC bounds), so the NY-local day boundaries pass through unconverted.
      const params = new URLSearchParams({
        client_id: env.seatgeekClientId,
        lat: String(SG_LAT),
        lon: String(SG_LON),
        range: SG_RANGE,
        'datetime_local.gte': `${date}T00:00:00`,
        'datetime_local.lt': `${addDays(date, 1)}T00:00:00`,
        per_page: '50',
        sort: 'datetime_local.asc',
      });
      const json = await fetchJson(`${SG_URL}?${params.toString()}`, undefined, 8000);
      const events: any[] = Array.isArray(json?.events) ? json.events : [];
      const seen = new Set<string>();
      const candidates: Candidate[] = [];
      for (const e of events) {
        const c = sgToCandidate(e, date);
        if (c && !seen.has(c.id)) {
          seen.add(c.id);
          candidates.push(c);
        }
      }
      return { candidates, live: true };
    } catch (err) {
      return {
        candidates: [],
        live: false,
        error: err instanceof Error ? err.message : 'seatgeek fetch failed',
      };
    }
  },
};
