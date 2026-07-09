// =============================================================================
// OutNYC: calendar availability for candidates (lib/providers/seasonality.ts)
// =============================================================================
// Curated venues are not all open all the time. A beach day, a boat bar, a
// ballgame, a Sunday gospel service: each exists only in certain months or on
// certain weekdays. Providers run every candidate through this gate before it
// can enter a plan pool, so a January Tuesday never offers August's outdoor
// cinema. Candidates without `months`/`daysOfWeek` are year-round, any-day.
// =============================================================================

import { dayOfWeekNY, monthOf } from '../time';
import type { Candidate } from '../types';

/** True if this candidate actually happens on `date` ('YYYY-MM-DD', NY). */
export function availableOnDate(candidate: Candidate, date: string): boolean {
  if (candidate.months && candidate.months.length > 0) {
    if (!candidate.months.includes(monthOf(date))) return false;
  }
  if (candidate.daysOfWeek && candidate.daysOfWeek.length > 0) {
    if (!candidate.daysOfWeek.includes(dayOfWeekNY(date))) return false;
  }
  return true;
}

/** Keep only the candidates that happen on `date`. */
export function filterToDate(candidates: Candidate[], date: string): Candidate[] {
  return candidates.filter((c) => availableOnDate(c, date));
}
