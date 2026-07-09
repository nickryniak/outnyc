// =============================================================================
// OutNYC: America/New_York time helpers (lib/time.ts)
// =============================================================================
// All "today"/date/window logic treats time as America/New_York local. Dates
// are 'YYYY-MM-DD' strings; window times are 'HH:MM' 24h strings. We derive NY
// local calendar fields via Intl.DateTimeFormat(timeZone:'America/New_York') so
// we never hit a UTC off-by-one at midnight.
// =============================================================================

import type { TimeWindow } from './types';

const TZ = 'America/New_York';

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'short',
});

const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  month: 'short',
  day: 'numeric',
});

const nyClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Today's date in America/New_York as 'YYYY-MM-DD'. */
export function todayNY(): string {
  // en-CA renders as YYYY-MM-DD.
  return ymdFormatter.format(new Date());
}

/**
 * True if `ymd` is a real 'YYYY-MM-DD' calendar date. Round-trips through the
 * anchor so '2026-02-31' and '2026-13-01' are rejected, not silently rolled
 * over. Route any date that came from OUTSIDE the app (a URL param, stored
 * data, a shared link) through this before formatting it: Intl throws a
 * RangeError on an Invalid Date, which would take down the whole screen.
 */
export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const anchor = ymdToAnchorDate(ymd);
  if (Number.isNaN(anchor.getTime())) return false;
  return ymdFormatter.format(anchor) === ymd;
}

/**
 * Parse a 'YYYY-MM-DD' string into a UTC-noon Date. We anchor at noon UTC so
 * that formatting back into NY local never crosses a day boundary regardless of
 * DST offset (NY is UTC-4/-5, so noon UTC is always the same calendar day in NY).
 * A malformed string yields an Invalid Date; callers that may see untrusted
 * input guard with isValidYmd first.
 */
function ymdToAnchorDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (y == null || m == null || d == null || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    return new Date(NaN);
  }
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Format via Intl, but never throw on an unparseable date: echo it back. */
function safeFormat(fmt: Intl.DateTimeFormat, ymd: string): string {
  const anchor = ymdToAnchorDate(ymd);
  if (Number.isNaN(anchor.getTime())) return ymd;
  return fmt.format(anchor);
}

/** Add `days` to a 'YYYY-MM-DD' date and return a 'YYYY-MM-DD' string. */
export function addDays(ymd: string, days: number): string {
  const anchor = ymdToAnchorDate(ymd);
  if (Number.isNaN(anchor.getTime())) return ymd;
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return ymdFormatter.format(anchor);
}

/** The next `count` days (default 7) starting today, in America/New_York. */
export function nextDaysNY(count = 7): string[] {
  const start = todayNY();
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(addDays(start, i));
  }
  return out;
}

/** Short weekday label, e.g. 'Mon'. */
export function weekdayLabel(ymd: string): string {
  return safeFormat(weekdayFormatter, ymd);
}

/** Short month/day label, e.g. 'Jun 30'. */
export function monthDayLabel(ymd: string): string {
  return safeFormat(monthDayFormatter, ymd);
}

/** A friendly relative label: 'Today', 'Tomorrow', else weekday. */
export function relativeDayLabel(ymd: string): string {
  const today = todayNY();
  if (ymd === today) return 'Today';
  if (ymd === addDays(today, 1)) return 'Tomorrow';
  return weekdayLabel(ymd);
}

/** True if `ymd` is strictly before today (NY). */
export function isPast(ymd: string): boolean {
  return ymd < todayNY();
}

/** The Monday (week start) on or before `ymd`, as 'YYYY-MM-DD'. */
export function mondayOf(ymd: string): string {
  const anchor = ymdToAnchorDate(ymd);
  const dow = anchor.getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7; // Mon=0 … Sun=6
  return addDays(ymd, -sinceMonday);
}

/** The 7 dates Mon..Sun of the week containing `mondayYmd` (pass a Monday). */
export function weekDates(mondayYmd: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) out.push(addDays(mondayYmd, i));
  return out;
}

/** A range label like 'Jul 1 – Jul 7' for the week starting at `mondayYmd`. */
export function weekRangeLabel(mondayYmd: string): string {
  return `${monthDayLabel(mondayYmd)} – ${monthDayLabel(addDays(mondayYmd, 6))}`;
}

/** Two-letter weekday for a compact calendar header (Su Mo Tu We Th Fr Sa). */
export function weekdayInitial(ymd: string): string {
  return weekdayLabel(ymd).slice(0, 2);
}

/** Day of month (1..31) for a 'YYYY-MM-DD' date. */
export function dayOfMonth(ymd: string): number {
  return ymdToAnchorDate(ymd).getUTCDate();
}

/** Day of week in NY for a 'YYYY-MM-DD' date: 0=Sun .. 6=Sat. */
export function dayOfWeekNY(ymd: string): number {
  return ymdToAnchorDate(ymd).getUTCDay();
}

/** Month (1..12) for a 'YYYY-MM-DD' date. */
export function monthOf(ymd: string): number {
  const [, m] = ymd.split('-').map((n) => parseInt(n, 10));
  return m ?? 0;
}

/** Minutes since midnight of the CURRENT America/New_York wall clock. */
export function nowMinutesNY(): number {
  const parts = nyClockFormatter.formatToParts(new Date());
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const hour = get('hour') % 24; // some engines emit '24' for midnight
  return hour * 60 + get('minute');
}

/**
 * Milliseconds until the next America/New_York midnight. DST-safe: it is
 * derived from the true NY instant of tomorrow's 00:00, so the 23-hour and
 * 25-hour days land on the real boundary rather than a fixed 24h offset.
 * Used to re-arm the day-rollover timer while the app stays open.
 */
export function msUntilNextNYMidnight(): number {
  const nextMidnight = nyDateTimeToLocalDate(addDays(todayNY(), 1), '00:00').getTime();
  return Math.max(1000, nextMidnight - Date.now());
}

// ---- 'HH:MM' helpers --------------------------------------------------------

/** Minutes since midnight for an 'HH:MM' string. */
export function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map((n) => parseInt(n, 10));
  return h * 60 + m;
}

/** 'HH:MM' from minutes since midnight (clamped to 0..1439). */
export function fromMinutes(mins: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(mins)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Window length in minutes (0 if invalid/negative). */
export function windowMinutes(w: TimeWindow): number {
  return Math.max(0, toMinutes(w.end) - toMinutes(w.start));
}

/** True if 'HH:MM' is well-formed and in 00:00..23:59. */
export function isValidTime(hhmm: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return false;
  const m = toMinutes(hhmm);
  return m >= 0 && m <= 23 * 60 + 59;
}

/** True if a window is well-formed and start < end. */
export function isValidWindow(w: TimeWindow): boolean {
  return isValidTime(w.start) && isValidTime(w.end) && toMinutes(w.start) < toMinutes(w.end);
}

/**
 * Normalize loose time entry to 'HH:MM', or null if it can't be understood.
 * Accepts '1800', '930', '6:00', '18:0', '6' (=> 06:00). Rejects out-of-range.
 */
export function normalizeTime(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // Only digits and a single colon are meaningful; a stray '-' or '.' etc. is a
  // typo, not a time: reject rather than silently stripping it (e.g. '-5').
  if (/[^0-9:]/.test(trimmed)) return null;
  if ((trimmed.match(/:/g) ?? []).length > 1) return null;
  let h: number;
  let m: number;
  if (trimmed.includes(':')) {
    const [hs = '', ms = ''] = trimmed.split(':');
    if (hs === '') return null;
    h = parseInt(hs, 10);
    m = parseInt(ms === '' ? '0' : ms, 10);
  } else {
    if (trimmed.length <= 2) {
      h = parseInt(trimmed, 10);
      m = 0;
    } else {
      h = parseInt(trimmed.slice(0, trimmed.length - 2), 10);
      m = parseInt(trimmed.slice(-2), 10);
    }
  }
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || m < 0 || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---- Calendar block drag math ------------------------------------------------

export interface BlockDragResult {
  start: number; // minutes since midnight
  end: number;
}

/**
 * Pure math for dragging a calendar block: apply a minute delta to the top
 * edge, bottom edge, or the whole block; snap to the hour; clamp to the
 * visible day; keep at least `minLen` minutes.
 */
export function applyBlockDrag(
  edge: 'top' | 'bottom' | 'move',
  startMin: number,
  endMin: number,
  deltaMin: number,
  dayStartMin: number,
  dayEndMin: number,
  minLen = 60,
): BlockDragResult {
  const snap = (m: number) => Math.round(m / 60) * 60;
  const clamp = (m: number) => Math.max(dayStartMin, Math.min(dayEndMin, m));
  let ns = startMin;
  let ne = endMin;
  if (edge === 'top') {
    ns = snap(clamp(startMin + deltaMin));
  } else if (edge === 'bottom') {
    ne = snap(clamp(endMin + deltaMin));
  } else {
    ns = snap(clamp(startMin + deltaMin));
    ne = ns + (endMin - startMin);
    if (ne > dayEndMin) {
      ne = dayEndMin;
      ns = ne - (endMin - startMin);
    }
  }
  if (ne - ns < minLen) {
    if (edge === 'top') {
      ns = ne - minLen;
    } else {
      // The minLen push can overshoot the day end; pull the block back inside
      // rather than letting the final clamp silently shrink it below minLen.
      ne = ns + minLen;
      if (ne > dayEndMin) {
        ne = dayEndMin;
        ns = ne - minLen;
      }
    }
  }
  return { start: clamp(ns), end: clamp(ne) };
}

/** True if two windows share any minute. */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** Display a window as '6:00 PM – 11:00 PM'. */
export function formatWindow(w: TimeWindow): string {
  return `${format12h(w.start)} – ${format12h(w.end)}`;
}

/** '18:00' -> '6:00 PM'. */
export function format12h(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map((n) => parseInt(n, 10));
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Build a JS Date for a NY-local (date, 'HH:MM') wall-clock instant: the TRUE
 * America/New_York moment, regardless of the device's own timezone. Used to
 * build UTC instants for live-event provider queries. On a device already set
 * to NY this yields exactly the same instant (DST included); on a UTC
 * emulator, CI, or a traveling user it no longer lands hours off.
 */
export function nyDateTimeToLocalDate(ymd: string, hhmm: string): Date {
  const [y = 0, mo = 1, d = 1] = ymd.split('-').map((n) => parseInt(n, 10));
  const [h = 0, mi = 0] = hhmm.split(':').map((n) => parseInt(n, 10));
  // Treat the wall-clock components as if they were UTC, then correct by the
  // America/New_York offset at that instant so the Date is the true NY moment.
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  return new Date(asUTC - nyOffsetMsAt(asUTC));
}

/**
 * The America/New_York UTC offset (ms; e.g. -4h in EDT, -5h in EST) at the given
 * instant, derived via Intl so DST is handled without a hardcoded table.
 */
function nyOffsetMsAt(instant: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(instant));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  let hour = get('hour');
  if (hour === 24) hour = 0; // some engines emit '24' for midnight
  const asIfUTC = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asIfUTC - instant;
}
