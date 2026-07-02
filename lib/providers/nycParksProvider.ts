// =============================================================================
// OutNYC — NYC Parks events provider (lib/providers/nycParksProvider.ts)
// =============================================================================
// Real, public, key-free data: NYC Parks' "Public Events – Upcoming 14 Days"
// dataset (dataset id w3wp-dpdi, verified live at data.cityofnewyork.us) —
// concerts, nature walks, workshops, and free theater across the city's parks.
// No key required — always attempted.
//
// A live sample of this dataset skews heavily toward kids' recreation-center
// programming and volunteer clean-ups, so those categories are filtered out,
// keeping the genuinely public cultural/outdoor events. Real coordinates ARE
// present here, so the neighborhood is snapped the same way as the other live
// providers (lib/geo.ts), never fabricated.
//
// NEVER throws — returns [] on any failure so other event sources still load.
// =============================================================================

import { nearestNeighborhood, OUTSIDE_AREA_LABEL } from '../geo';
import type { Candidate } from '../types';
import type { ProviderResult } from './eventsProvider';
import { fetchJson } from './net';

const DATASET_URL = 'https://data.cityofnewyork.us/resource/w3wp-dpdi.json';

// Categories to exclude, verified against a live same-day sample of this
// dataset's actual category vocabulary — the bulk of it is kids'/rec-center
// day programming and park clean-up volunteering, not general public outings.
const EXCLUDE_CATEGORIES = [
  'recreation center programming',
  'best for kids',
  'volunteer',
  "it's my park",
  'summer sports experience',
];

function categoryTags(categories: string): string[] {
  const c = categories.toLowerCase();
  const tags: string[] = [];
  if (c.includes('concert')) tags.push('live music');
  if (c.includes('art') || c.includes('history')) tags.push('art');
  if (c.includes('theater') || c.includes('theatre')) tags.push('art');
  if (c.includes('film')) tags.push('film');
  if (c.includes('nature') || c.includes('garden') || c.includes('waterfront')) {
    tags.push('outdoors');
  }
  if (c.includes('food')) tags.push('food');
  if (tags.length === 0) tags.push('outdoors'); // it's a park event either way
  return tags;
}

/** '7:00 am' / '12:30 pm' -> '07:00' / '12:30'; null if unparseable. */
function parseAmPm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(raw.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = m[3].toLowerCase();
  if (period === 'pm' && h !== 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function toCandidate(row: any): Candidate | null {
  const name: unknown = row?.title;
  const categories: string = typeof row?.categories === 'string' ? row.categories : '';
  if (typeof name !== 'string') return null;
  // Cancelled events stay in the feed with a "CANCELED:"/"CANCELLED:" title
  // prefix rather than being removed (verified in a live sample) — never
  // recommend one.
  if (/^cancell?ed:/i.test(name.trim())) return null;
  const lower = categories.toLowerCase();
  if (EXCLUDE_CATEGORIES.some((ex) => lower.includes(ex))) return null;

  const startTime = parseAmPm(row?.starttime);
  const endTime = parseAmPm(row?.endtime);
  if (!startTime || !endTime) return null;

  let lat: number | undefined;
  let lng: number | undefined;
  const coordStr: unknown = row?.coordinates;
  if (typeof coordStr === 'string') {
    const [latS, lngS] = coordStr.split(',').map((s) => s.trim());
    const latN = parseFloat(latS);
    const lngN = parseFloat(lngS);
    if (Number.isFinite(latN) && Number.isFinite(lngN)) {
      lat = latN;
      lng = lngN;
    }
  }
  const neighborhood = lat != null && lng != null ? nearestNeighborhood(lat, lng) : OUTSIDE_AREA_LABEL;

  const guid: unknown = row?.guid;
  return {
    id: `pk-${guid ?? name}`,
    name,
    kind: 'activity',
    neighborhood,
    priceTier: 1, // NYC Parks public programming is free / nominal-cost
    startTime,
    endTime,
    lat,
    lng,
    address: typeof row?.location === 'string' ? row.location : row?.parknames || undefined,
    bookingUrl: typeof row?.link?.url === 'string' ? row.link.url : undefined,
    description:
      typeof row?.description === 'string' && row.description.trim()
        ? row.description.slice(0, 160)
        : `Park event at ${row?.parknames ?? 'a NYC park'}.`,
    tags: categoryTags(categories),
    // A recurring drop-in park program, not a ticketed must-attend show — the
    // planner may skip it rather than force an unfillable gap around it.
    soft: true,
  };
}

export const nycParksProvider = {
  async fetchEvents(date: string): Promise<ProviderResult> {
    try {
      const where = `startdate='${date}T00:00:00.000'`;
      const url = `${DATASET_URL}?$where=${encodeURIComponent(where)}&$limit=200`;
      const rows = await fetchJson(url, undefined, 8000);
      const seen = new Set<string>();
      const candidates: Candidate[] = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const c = toCandidate(row);
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
        error: err instanceof Error ? err.message : 'nyc parks fetch failed',
      };
    }
  },
};
