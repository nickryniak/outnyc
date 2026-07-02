// =============================================================================
// OutNYC — events provider (lib/providers/eventsProvider.ts)
// =============================================================================
// Merges FOUR event sources for a date, never throwing:
//   - Ticketmaster Discovery v2 (key-gated, EXPO_PUBLIC_TICKETMASTER_API_KEY)
//   - SeatGeek (key-gated, EXPO_PUBLIC_SEATGEEK_CLIENT_ID) — see seatgeekProvider
//   - NYC Open Data "Permitted Event Information" (no key) — nycOpenDataProvider
//   - NYC Parks public events (no key) — nycParksProvider
// Venues are snapped onto the app's neighborhood list by coordinates (see
// lib/geo.ts) so live events obey the strict neighborhood filter. The curated
// seed ACTIVITIES (museums, parks, walks — no live source supplies these) are
// always kept as a floor; the curated seed EVENTS are the fallback only when
// no ticketed live source (Ticketmaster/SeatGeek) returns anything usable for
// the day. Any one source failing never blocks the others.
//
// TODO(prod): route the Ticketmaster key through a server/edge function rather
// than bundling EXPO_PUBLIC_TICKETMASTER_API_KEY into the client.
// =============================================================================

import { env, providerFlags } from '../config';
import { SEED_EVENTS } from '../constants';
import { nearestNeighborhood, OUTSIDE_AREA_LABEL } from '../geo';
import { fromMinutes, nyDateTimeToLocalDate, toMinutes } from '../time';
import type { Candidate, PriceTier, ProviderInfo } from '../types';
import { fetchJson } from './net';
import { nycOpenDataProvider } from './nycOpenDataProvider';
import { nycParksProvider } from './nycParksProvider';
import { seatgeekProvider } from './seatgeekProvider';

export interface ProviderResult {
  candidates: Candidate[];
  /** True when results came from a live API; false when seed/mock. */
  live: boolean;
  /** Non-null when a live call failed and we fell back. */
  error?: string;
}

const TM_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
// Centered near Union Square with a 10-mile radius: covers all supported
// neighborhoods (Harlem to DUMBO to Astoria) without pulling in NJ arenas.
const TM_LATLONG = '40.7359,-73.9911';
const TM_RADIUS_MILES = '10';
/** Assumed running time when Ticketmaster gives no end time. */
const DEFAULT_EVENT_RUNTIME_MIN = 150;

/** Ticketmaster price floor -> the app's $..$$$$ tier. */
function tmPriceTier(min: number | undefined): PriceTier | undefined {
  if (min == null || Number.isNaN(min)) return undefined;
  if (min <= 25) return 1;
  if (min <= 60) return 2;
  if (min <= 120) return 3;
  return 4;
}

/** Map Ticketmaster classifications onto the app's interest tags. */
function tmTags(classification: any): string[] {
  const segment: string = classification?.segment?.name ?? '';
  const genre: string = classification?.genre?.name ?? '';
  if (segment === 'Music') return ['live music'];
  if (segment === 'Film') return ['film'];
  if (segment === 'Arts & Theatre') {
    return genre.toLowerCase().includes('comedy') ? ['comedy'] : ['art'];
  }
  return [];
}

/** Map one Discovery event into a Candidate, or null if unusable. */
function tmToCandidate(e: any, date: string): Candidate | null {
  // Only same-day events with a concrete local start time are schedulable.
  if (e?.dates?.start?.localDate !== date) return null;
  const localTime: string | undefined = e?.dates?.start?.localTime;
  if (!localTime) return null;
  const startTime = localTime.slice(0, 5);
  const endTime = fromMinutes(Math.min(toMinutes(startTime) + DEFAULT_EVENT_RUNTIME_MIN, 1439));

  const venue = e?._embedded?.venues?.[0];
  // Parse-then-validate: a malformed coordinate string must yield undefined
  // (not NaN), so Directions falls back to the name+area search as designed.
  const latRaw = Number.parseFloat(venue?.location?.latitude);
  const lngRaw = Number.parseFloat(venue?.location?.longitude);
  const lat = Number.isFinite(latRaw) ? latRaw : undefined;
  const lng = Number.isFinite(lngRaw) ? lngRaw : undefined;
  // Snap to a supported neighborhood; anything else gets the honest
  // OUTSIDE_AREA_LABEL so the strict filter excludes it (never `undefined`,
  // which would read as location-agnostic and bypass the filter).
  const neighborhood =
    lat != null && lng != null ? nearestNeighborhood(lat, lng) : OUTSIDE_AREA_LABEL;

  const venueName: string = venue?.name ?? '';
  const addressLine = [venue?.address?.line1, venue?.city?.name].filter(Boolean).join(', ');
  const classification = e?.classifications?.[0];
  const genre: string = classification?.genre?.name ?? '';
  const description: string =
    (typeof e?.info === 'string' && e.info.trim().slice(0, 160)) ||
    [genre || 'Live event', venueName ? `at ${venueName}` : '']
      .filter(Boolean)
      .join(' ');

  return {
    id: `tm-${e.id}`,
    name: e.name,
    kind: 'event',
    neighborhood,
    priceTier: tmPriceTier(e?.priceRanges?.[0]?.min),
    startTime,
    endTime,
    lat,
    lng,
    address: addressLine || undefined,
    bookingUrl: typeof e?.url === 'string' ? e.url : undefined,
    description,
    tags: tmTags(classification),
  };
}

/** Fetch Ticketmaster events for a date. Never throws; [] when no key/error. */
async function fetchTicketmaster(date: string): Promise<ProviderResult> {
  if (!providerFlags.events.isLive) {
    return { candidates: [], live: false };
  }
  try {
    // The Discovery API takes UTC instants; convert the NY-local day bounds.
    const toZ = (hhmm: string) =>
      nyDateTimeToLocalDate(date, hhmm).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const params = new URLSearchParams({
      apikey: env.ticketmasterKey,
      latlong: TM_LATLONG,
      radius: TM_RADIUS_MILES,
      unit: 'miles',
      startDateTime: toZ('00:00'),
      endDateTime: toZ('23:59'),
      size: '50',
      sort: 'date,asc',
    });
    const json = await fetchJson(`${TM_URL}?${params.toString()}`, undefined, 8000);
    const events: any[] = json?._embedded?.events ?? [];
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const e of events) {
      const c = tmToCandidate(e, date);
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
      error: err instanceof Error ? err.message : 'ticketmaster fetch failed',
    };
  }
}

function dedupeById(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export const eventsProvider = {
  info(): ProviderInfo {
    return providerFlags.events;
  },

  /**
   * Fetch events for a date from every configured source. Always resolves —
   * never throws.
   */
  async fetchEvents(date: string): Promise<ProviderResult> {
    const seedActivities = SEED_EVENTS.filter((s) => s.kind !== 'event');
    const seedFixedEvents = SEED_EVENTS.filter((s) => s.kind === 'event');

    const [tm, sg, od, pk] = await Promise.all([
      fetchTicketmaster(date),
      seatgeekProvider.fetchEvents(date),
      nycOpenDataProvider.fetchEvents(date),
      nycParksProvider.fetchEvents(date),
    ]);

    // Ticketed live sources (Ticketmaster + SeatGeek) replace the curated
    // fixed-time seed events only once at least one USABLE (in-area) result
    // comes back; otherwise the curated shows stay so the day still has real
    // fixed-time events to anchor around.
    const ticketed = [...tm.candidates, ...sg.candidates].filter(
      (c) => c.neighborhood !== OUTSIDE_AREA_LABEL,
    );
    const eventsBucket = ticketed.length > 0 ? ticketed : seedFixedEvents;

    // The civic/park feeds (no key required) and the curated activities are
    // pure ADDITIONS on top, never replaced — they're what fills the "Do"
    // category outside of ticketed shows.
    const candidates = dedupeById([
      ...eventsBucket,
      ...seedActivities,
      ...od.candidates,
      ...pk.candidates,
    ]);

    const live = tm.live || sg.live || od.live || pk.live;
    const error = [tm.error, sg.error, od.error, pk.error].filter(Boolean).join('; ') || undefined;
    return { candidates, live, error };
  },
};
