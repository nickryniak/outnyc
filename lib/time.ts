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
