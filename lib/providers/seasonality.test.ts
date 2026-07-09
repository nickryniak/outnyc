// =============================================================================
// OutNYC: seasonality gate tests (lib/providers/seasonality.test.ts)
// =============================================================================

import { SEED_EVENTS } from '../constants';
import type { Candidate } from '../types';
import { availableOnDate, filterToDate } from './seasonality';

const base: Candidate = { id: 'x', name: 'X', kind: 'activity', tags: [] };

describe('availableOnDate', () => {
  it('lets unconstrained candidates through on any date', () => {
    expect(availableOnDate(base, '2027-01-14')).toBe(true);
    expect(availableOnDate(base, '2027-07-04')).toBe(true);
  });

  it('honors months', () => {
    const summer = { ...base, months: [6, 7, 8] };
    expect(availableOnDate(summer, '2027-07-04')).toBe(true);
    expect(availableOnDate(summer, '2027-01-14')).toBe(false);
    expect(availableOnDate(summer, '2027-09-01')).toBe(false);
  });

  it('honors daysOfWeek (NY weekday, not the device timezone)', () => {
    const sundayOnly = { ...base, daysOfWeek: [0] };
    expect(availableOnDate(sundayOnly, '2026-07-12')).toBe(true); // a Sunday
    expect(availableOnDate(sundayOnly, '2026-07-13')).toBe(false); // Monday
  });

  it('requires BOTH constraints when both are set', () => {
    const summerSunday = { ...base, months: [7], daysOfWeek: [0] };
    expect(availableOnDate(summerSunday, '2026-07-12')).toBe(true);
    expect(availableOnDate(summerSunday, '2026-07-13')).toBe(false); // right month, wrong day
    expect(availableOnDate(summerSunday, '2026-08-09')).toBe(false); // right day, wrong month
  });

  it('keeps a ballgame out of the winter pool but offers it in July', () => {
    const january = filterToDate(SEED_EVENTS, '2027-01-20').map((c) => c.id);
    const july = filterToDate(SEED_EVENTS, '2027-07-21').map((c) => c.id);
    for (const id of ['qc-mets-game-citi-field', 'qc-yankees-game-night']) {
      expect(january).not.toContain(id);
      expect(july).toContain(id);
    }
    expect(january).not.toContain('qc-rockaway-beach-day');
    expect(july).toContain('qc-rockaway-beach-day');
  });

  it('only offers the Sunday gospel service on a Sunday', () => {
    const sunday = filterToDate(SEED_EVENTS, '2026-07-12').map((c) => c.id);
    const wednesday = filterToDate(SEED_EVENTS, '2026-07-15').map((c) => c.id);
    expect(sunday).toContain('up-harlem-gospel-fcbc');
    expect(wednesday).not.toContain('up-harlem-gospel-fcbc');
  });
});
