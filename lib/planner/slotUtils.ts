// =============================================================================
// OutNYC — shared slot utilities (lib/planner/slotUtils.ts)
// =============================================================================
// Logic shared by the heuristic planner and the swap/alternatives flow:
//   - deterministic hashing for stable tie-breaks
//   - candidate durations
//   - MEAL-TIME GATING: food only lands at food times (coffee in the morning,
//     lunch midday, dinner in the evening, drinks at night), so activities and
//     events fill the rest of the day.
// =============================================================================

import { fromMinutes, toMinutes } from '../time';
import type { Candidate, PlanItem } from '../types';

// Default durations (minutes) when a candidate has no explicit time info.
export const DEFAULT_EVENT_MIN = 90;
export const DEFAULT_PLACE_MIN = 60;

/** Deterministic small integer hash of a string (for stable tie-breaks). */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Effective duration (minutes) of a candidate. */
export function candidateDuration(c: Candidate): number {
  if (c.startTime && c.endTime) {
    return Math.max(0, toMinutes(c.endTime) - toMinutes(c.startTime));
  }
  if (c.durationMin && c.durationMin > 0) return c.durationMin;
  return c.kind === 'event' || c.kind === 'activity'
    ? DEFAULT_EVENT_MIN
    : DEFAULT_PLACE_MIN;
}

// ---- Meal-time gating --------------------------------------------------------

/** Minutes since midnight for the day's dining rhythms. */
const T = (hhmm: string) => toMinutes(hhmm);
const COFFEE = { start: T('07:00'), end: T('17:00') };
const BREAKFAST = { start: T('08:00'), end: T('11:00') };
const BRUNCH = { start: T('09:30'), end: T('14:30') };
// LUNCH starts where BREAKFAST ends so no start time falls between meal slots
// (an 11:15 brunch table must count against the lunch cap, not slip through).
const LUNCH = { start: T('11:00'), end: T('14:30') };
const DINNER = { start: T('17:30'), end: T('21:30') };
const LATE_NIGHT = { start: T('21:00'), end: T('23:59') };
const DRINKS = { start: T('16:00'), end: T('23:59') };

function inRange(min: number, r: { start: number; end: number }): boolean {
  return min >= r.start && min <= r.end;
}

/** Which meal slot a start time falls in (for the one-per-meal cap). */
export type MealSlot = 'coffee' | 'breakfast' | 'lunch' | 'dinner' | 'late-night' | null;

export function mealSlotAt(startMin: number): MealSlot {
  if (inRange(startMin, BREAKFAST)) return 'breakfast';
  if (inRange(startMin, LUNCH)) return 'lunch';
  if (inRange(startMin, DINNER)) return 'dinner';
  if (inRange(startMin, LATE_NIGHT)) return 'late-night';
  if (inRange(startMin, COFFEE)) return 'coffee';
  return null;
}

/**
 * True if a candidate is allowed to START at `startMin`. Events/activities are
 * always allowed (their own fixed times bound them); food and drinks are gated
 * to sensible hours based on kind + timing tags.
 */
export function allowedStart(c: Candidate, startMin: number): boolean {
  const tags = c.tags.map((t) => t.toLowerCase());

  if (c.kind === 'bar') {
    return inRange(startMin, DRINKS);
  }

  if (c.kind === 'restaurant') {
    // Coffee shops: mornings and afternoons only.
    if (tags.includes('coffee')) return inRange(startMin, COFFEE);
    // A place can qualify for several dining windows; allowed if ANY matches.
    if (tags.includes('brunch') && inRange(startMin, BRUNCH)) return true;
    if (tags.includes('late-night') && inRange(startMin, LATE_NIGHT)) return true;
    return (
      inRange(startMin, BREAKFAST) ||
      inRange(startMin, LUNCH) ||
      inRange(startMin, DINNER)
    );
  }

  // Bucket items tagged as food/drinks/nightlife follow the same rhythm.
  if (c.kind === 'bucket') {
    if (tags.includes('bar') || tags.includes('rooftop')) return inRange(startMin, DRINKS);
    if (tags.includes('late-night')) return inRange(startMin, LATE_NIGHT);
    if (tags.includes('coffee')) return inRange(startMin, COFFEE);
    if (tags.includes('food')) {
      return (
        inRange(startMin, BRUNCH) ||
        inRange(startMin, LUNCH) ||
        inRange(startMin, DINNER) ||
        inRange(startMin, LATE_NIGHT)
      );
    }
    // Nightlife-flavored wishes (jazz sets, comedy shows) belong to the evening.
    if (tags.includes('live music') || tags.includes('comedy')) {
      return inRange(startMin, DRINKS);
    }
    return true;
  }

  // Events, activities, walks: any time (fixed-time entries carry their own slot).
  return true;
}

/**
 * Split a possibly multi-neighborhood label into normalized tokens, so a venue
 * tagged "SoHo / Nolita" or "Chelsea & Flatiron" matches a pick of either. We
 * split on slashes, commas, ampersands, and a standalone "and".
 */
export function neighborhoodTokens(neighborhood: string): string[] {
  return neighborhood
    .split(/[/,&]|\band\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True if a candidate's neighborhood satisfies the day's selected set. Rules,
 * in order:
 *   - An empty selection matches everything (no filter is set for the day).
 *   - A candidate with NO neighborhood is location-agnostic — e.g. one of the
 *     user's own bucket wishes with no set area, or a citywide pick — and always
 *     qualifies (it can happen anywhere, including the selected neighborhoods).
 *   - Otherwise at least one of the candidate's neighborhood tokens must be one
 *     of the selected ones (case-insensitive). A venue in a neighborhood the
 *     user did NOT pick is ALWAYS excluded — there is no widening that re-admits
 *     it, so a picked neighborhood is respected end to end.
 */
export function matchesNeighborhoods(
  neighborhood: string | undefined,
  selected: string[],
): boolean {
  if (selected.length === 0) return true;
  if (!neighborhood || !neighborhood.trim()) return true;
  const want = new Set(selected.map((n) => n.trim().toLowerCase()).filter(Boolean));
  if (want.size === 0) return true;
  return neighborhoodTokens(neighborhood).some((t) => want.has(t));
}

/**
 * STRICT filter to the selected neighborhoods. Drops every candidate whose
 * neighborhood is set and not selected; keeps in-neighborhood and
 * location-agnostic (no-neighborhood) picks. There is deliberately NO
 * "fall back to everything if empty" escape hatch — an empty result is honest
 * ("nothing here fits your neighborhoods") and is far better than silently
 * showing a venue across town, which was the old bug.
 */
export function filterToNeighborhoods<T extends { neighborhood?: string }>(
  candidates: T[],
  selected: string[],
): T[] {
  return candidates.filter((c) => matchesNeighborhoods(c.neighborhood, selected));
}

/**
 * Normalize a candidate name to a venue-identity key, so a user's own bucket
 * wish ("Jazz set at the Village Vanguard") and a curated/live listing for the
 * SAME real place ("Live Jazz at the Village Vanguard") are recognized as one
 * venue rather than two different "fresh" picks. Common English phrasing is
 * "<activity> at [the] <venue>" — when present, the venue after "at" IS the
 * identity; otherwise the whole (already venue-only) name is used as-is.
 */
export function venueKey(name: string): string {
  const m = /\bat\s+(?:the\s+)?(.+)$/i.exec(name.trim());
  const core = m ? m[1] : name;
  return core
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

/** True when two candidates are the same category for swap purposes. */
export function sameCategory(a: Candidate['kind'], b: Candidate['kind']): boolean {
  const food = (k: Candidate['kind']) => k === 'restaurant';
  const drink = (k: Candidate['kind']) => k === 'bar';
  const doing = (k: Candidate['kind']) => k === 'event' || k === 'activity' || k === 'bucket';
  return (food(a) && food(b)) || (drink(a) && drink(b)) || (doing(a) && doing(b));
}

/**
 * Strip walk/break rows and re-insert walk connectors between stops whenever
 * the neighborhood changes and there is at least a 15 minute gap. The single
 * source of truth for connectors: the planner runs it as a post-pass and the
 * swap flow reruns it after replacing a stop.
 */
export function rebuildConnectors(stops: PlanItem[]): PlanItem[] {
  const sorted = stops
    .filter((i) => i.kind !== 'walk' && i.kind !== 'break')
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const out: PlanItem[] = [];
  let order = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const prev = i > 0 ? sorted[i - 1] : undefined;
    const cur = sorted[i];
    if (
      prev &&
      prev.neighborhood &&
      cur.neighborhood &&
      prev.neighborhood !== cur.neighborhood &&
      toMinutes(cur.startTime) - toMinutes(prev.endTime) >= 15
    ) {
      out.push({
        id: `walk-${order}`,
        order,
        kind: 'walk',
        title: `Walk: ${prev.neighborhood} to ${cur.neighborhood}`,
        neighborhood: cur.neighborhood,
        startTime: prev.endTime,
        endTime: fromMinutes(Math.min(toMinutes(prev.endTime) + 15, toMinutes(cur.startTime))),
        note: 'Short walk between stops.',
      });
      order += 1;
    }
    out.push({ ...cur, order });
    order += 1;
  }
  return out;
}
