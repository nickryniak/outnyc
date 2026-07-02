// =============================================================================
// OutNYC — NYC Open Data civic events provider (lib/providers/nycOpenDataProvider.ts)
// =============================================================================
// Real, public, key-free data: NYC's "NYC Permitted Event Information" dataset
// (dataset id tvpp-9vvx, verified live at data.cityofnewyork.us) — parade,
// farmers-market, and street-fair permits. No key required — always attempted.
//
// This dataset is MOSTLY sports-league and street-closure permits (verified
// against a live sample of its actual event_type values), so results are
// filtered to just the types a visitor would want to attend. It also carries
// no coordinates, so the neighborhood is matched by text against the location/
// borough fields rather than fabricated — anything that doesn't clearly name
// one of the app's 12 supported neighborhoods is honestly marked outside them.
//
// NEVER throws — returns [] on any failure so other event sources still load.
// =============================================================================

import { NEIGHBORHOODS } from '../constants';
import { OUTSIDE_AREA_LABEL } from '../geo';
import type { Candidate } from '../types';
import type { ProviderResult } from './eventsProvider';
import { fetchJson, isOnline } from './net';

const DATASET_URL = 'https://data.cityofnewyork.us/resource/tvpp-9vvx.json';

// Only the event_type values a visitor would actually want to attend (verified
// via a live query of this dataset's distinct event_type values, which also
// includes "Sport - Youth", "Clean-Up", "Theater Load in and Load Outs",
// "Religious Event", etc. — all excluded here as not general-audience outings).
const ATTENDABLE_TYPES = [
  'Farmers Market',
  'Parade',
  'Athletic Race / Tour',
  'Special Event',
  'Plaza Event',
  'Plaza Partner Event',
  'Open Street Partner Event',
];

function typeTags(eventType: string): string[] {
  if (eventType === 'Farmers Market') return ['food', 'outdoors'];
  if (
    eventType === 'Parade' ||
    eventType === 'Athletic Race / Tour' ||
    eventType === 'Open Street Partner Event'
  ) {
    return ['outdoors', 'walk'];
  }
  return ['outdoors'];
}

/**
 * No coordinates in this dataset — match the free-text location/borough
 * fields against the app's supported neighborhood names instead of guessing a
 * position. Anything that doesn't name one is honestly OUTSIDE_AREA_LABEL, so
 * the strict neighborhood filter excludes it rather than mislabeling it.
 */
function textNeighborhood(location: string, borough: string): string {
  const hay = `${location} ${borough}`.toLowerCase();
  const hit = NEIGHBORHOODS.find((n) => hay.includes(n.toLowerCase()));
  return hit ?? OUTSIDE_AREA_LABEL;
}

/** The dataset fields actually read — compile-time documentation, not runtime validation. */
interface NycPermittedEventRow {
  event_id?: string;
  event_name?: string;
  start_date_time?: string;
  end_date_time?: string;
  event_type?: string;
  event_location?: string;
  event_borough?: string;
}

function toCandidate(row: NycPermittedEventRow): Candidate | null {
  const name = row?.event_name;
  const start = row?.start_date_time;
  const end = row?.end_date_time;
  const id = row?.event_id;
  if (typeof name !== 'string' || typeof start !== 'string' || typeof end !== 'string') {
    return null;
  }
  // The sibling NYC Parks feed keeps cancelled rows with a "CANCELED:" title
  // prefix instead of removing them — guard the same way here defensively.
  if (/^cancell?ed:/i.test(name.trim())) return null;
  return {
    id: `od-${id ?? name}`,
    name,
    kind: 'activity',
    neighborhood: textNeighborhood(row?.event_location ?? '', row?.event_borough ?? ''),
    priceTier: 1, // public street/plaza/market events — free to attend
    startTime: start.slice(11, 16),
    endTime: end.slice(11, 16),
    description:
      [row?.event_type, row?.event_location].filter(Boolean).join(' — ') || 'Public event.',
    tags: typeTags(typeof row?.event_type === 'string' ? row.event_type : ''),
    // A permitted street/plaza event, not a ticketed must-attend show — the
    // planner may skip it rather than force an unfillable gap around it.
    soft: true,
  };
}

export const nycOpenDataProvider = {
  async fetchEvents(date: string): Promise<ProviderResult> {
    // This key-free feed is otherwise always attempted; when offline, return
    // the empty fallback immediately instead of eating the full fetch timeout.
    if (!(await isOnline())) {
      return { candidates: [], live: false, error: 'offline' };
    }
    try {
      const typeList = ATTENDABLE_TYPES.map((t) => `'${t}'`).join(',');
      const where =
        `start_date_time between '${date}T00:00:00' and '${date}T23:59:59' ` +
        `AND event_type in(${typeList})`;
      const url = `${DATASET_URL}?$where=${encodeURIComponent(where)}&$limit=100`;
      const rows = await fetchJson(url, undefined, 8000);
      const candidates = (Array.isArray(rows) ? rows : [])
        .map(toCandidate)
        .filter((c): c is Candidate => c !== null);
      return { candidates, live: true };
    } catch (err) {
      return {
        candidates: [],
        live: false,
        error: err instanceof Error ? err.message : 'nyc open data fetch failed',
      };
    }
  },
};
