// =============================================================================
// OutNYC — America/New_York time helpers (lib/time.ts)
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

/** Today's date in America/New_York as 'YYYY-MM-DD'. */
export function todayNY(): string {
  // en-CA renders as YYYY-MM-DD.
  return ymdFormatter.format(new Date());
}

/**
 * Parse a 'YYYY-MM-DD' string into a UTC-noon Date. We anchor at noon UTC so
 * that formatting back into NY local never crosses a day boundary regardless of
 * DST offset (NY is UTC-4/-5, so noon UTC is always the same calendar day in NY).
 */
function ymdToAnchorDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Add `days` to a 'YYYY-MM-DD' date and return a 'YYYY-MM-DD' string. */
export function addDays(ymd: string, days: number): string {
  const anchor = ymdToAnchorDate(ymd);
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
  return weekdayFormatter.format(ymdToAnchorDate(ymd));
}

/** Short month/day label, e.g. 'Jun 30'. */
export function monthDayLabel(ymd: string): string {
  return monthDayFormatter.format(ymdToAnchorDate(ymd));
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

/** Single-letter weekday for a compact calendar header (M T W T F S S). */
export function weekdayInitial(ymd: string): string {
  return weekdayLabel(ymd).slice(0, 1);
}

// ---- 'HH:MM' helpers --------------------------------------------------------

/** Minutes since midnight for an 'HH:MM' string. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
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
  // typo, not a time — reject rather than silently stripping it (e.g. '-5').
  if (/[^0-9:]/.test(trimmed)) return null;
  if ((trimmed.match(/:/g) ?? []).length > 1) return null;
  let h: number;
  let m: number;
  if (trimmed.includes(':')) {
    const [hs, ms] = trimmed.split(':');
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
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Build a JS Date for a NY-local (date, 'HH:MM') instant. Used to compute
 * notification trigger times. We construct the wall-clock components and let
 * the host interpret them; for notifications scheduled on-device this matches
 * the user's local clock (the app's audience is NYC-local).
 */
export function nyDateTimeToLocalDate(ymd: string, hhmm: string): Date {
  const [y, mo, d] = ymd.split('-').map((n) => parseInt(n, 10));
  const [h, mi] = hhmm.split(':').map((n) => parseInt(n, 10));
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}
