// =============================================================================
// OutNYC — NYC holiday / notable-date layer (lib/holidays.ts)
// =============================================================================
// A small static list of NYC-relevant dates. The calendar tints the matching
// day header (subtle accent + icon), and the planner receives the holiday as
// context so the day's plan can lean into it (e.g. outdoor + rooftop picks on
// July 4th). Fixed-date entries use 'MM-DD'; floating entries are computed.
// =============================================================================

export interface Holiday {
  /** Display name, e.g. 'Independence Day'. */
  name: string;
  /** Short label for tight UI, e.g. 'July 4th'. */
  short: string;
  /** Seed tags the planner should boost for this day. */
  boostTags: string[];
  /** Accent hex used for the subtle day-header theming. */
  color: string;
}

const FIXED: Record<string, Holiday> = {
  '01-01': {
    name: "New Year's Day",
    short: 'New Year',
    boostTags: ['walk', 'outdoors', 'food'],
    color: '#B07A22',
  },
  '02-14': {
    name: "Valentine's Day",
    short: 'Valentine’s',
    boostTags: ['food', 'bar'],
    color: '#B23A2E',
  },
  '03-17': {
    name: "St. Patrick's Day",
    short: 'St. Paddy’s',
    boostTags: ['bar', 'live music'],
    color: '#1E6F5C',
  },
  '06-19': {
    name: 'Juneteenth',
    short: 'Juneteenth',
    boostTags: ['live music', 'outdoors', 'art'],
    color: '#B23A2E',
  },
  '07-04': {
    name: 'Independence Day',
    short: 'July 4th',
    boostTags: ['outdoors', 'rooftop', 'bar'],
    color: '#B23A2E',
  },
  '10-31': {
    name: 'Halloween',
    short: 'Halloween',
    boostTags: ['bar', 'live music', 'comedy'],
    color: '#B07A22',
  },
  '12-25': {
    name: 'Christmas Day',
    short: 'Christmas',
    boostTags: ['walk', 'outdoors', 'film'],
    color: '#1E6F5C',
  },
  '12-31': {
    name: "New Year's Eve",
    short: 'NYE',
    boostTags: ['bar', 'live music', 'rooftop'],
    color: '#B07A22',
  },
};

/** Nth (1-based) occurrence of a weekday (0=Sun..6=Sat) in a month, as day-of-month. */
function nthWeekday(year: number, month1: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month1 - 1, 1, 12)).getUTCDay();
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

/** Last occurrence of a weekday in a month, as day-of-month. */
function lastWeekday(year: number, month1: number, weekday: number): number {
  const daysInMonth = new Date(Date.UTC(year, month1, 0, 12)).getUTCDate();
  const last = new Date(Date.UTC(year, month1 - 1, daysInMonth, 12)).getUTCDay();
  return daysInMonth - ((last - weekday + 7) % 7);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The holiday for a 'YYYY-MM-DD' date, or null. */
export function holidayFor(ymd: string): Holiday | null {
  const [ys = '', ms = '', ds = ''] = ymd.split('-');
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10);
  const d = parseInt(ds, 10);
  if (!y || !m || !d) return null;

  const fixed = FIXED[`${pad2(m)}-${pad2(d)}`];
  if (fixed) return fixed;

  // Floating NYC dates.
  if (m === 5 && d === lastWeekday(y, 5, 1)) {
    return {
      name: 'Memorial Day',
      short: 'Memorial Day',
      boostTags: ['outdoors', 'walk'],
      color: '#1E6F5C',
    };
  }
  if (m === 6 && d === lastWeekday(y, 6, 0)) {
    return {
      name: 'NYC Pride March',
      short: 'Pride',
      boostTags: ['outdoors', 'bar', 'live music'],
      color: '#7A4FA3',
    };
  }
  if (m === 9 && d === nthWeekday(y, 9, 1, 1)) {
    return {
      name: 'Labor Day',
      short: 'Labor Day',
      boostTags: ['outdoors', 'walk'],
      color: '#1E6F5C',
    };
  }
  if (m === 11 && d === nthWeekday(y, 11, 0, 1)) {
    return {
      name: 'NYC Marathon',
      short: 'Marathon',
      boostTags: ['outdoors', 'walk'],
      color: '#B07A22',
    };
  }
  if (m === 11 && d === nthWeekday(y, 11, 4, 4)) {
    return {
      name: 'Thanksgiving',
      short: 'Thanksgiving',
      boostTags: ['food', 'walk'],
      color: '#B07A22',
    };
  }
  return null;
}
