// =============================================================================
// OutNYC — tests for lib/time.ts
// =============================================================================
// Pure date/time math only; no store or provider imports. Dates below are
// verified America/New_York calendar facts (2026-07-02 is a Thursday).
// =============================================================================

import {
  applyBlockDrag,
  fromMinutes,
  mondayOf,
  toMinutes,
  weekdayInitial,
} from './time';

describe('toMinutes / fromMinutes', () => {
  it('round-trips well-formed HH:MM strings', () => {
    for (const hhmm of ['00:00', '00:01', '09:30', '11:00', '12:00', '17:30', '23:59']) {
      expect(fromMinutes(toMinutes(hhmm))).toBe(hhmm);
    }
  });

  it('round-trips minute values through HH:MM', () => {
    for (const mins of [0, 1, 59, 60, 570, 719, 720, 1439]) {
      expect(toMinutes(fromMinutes(mins))).toBe(mins);
    }
  });

  it('fromMinutes clamps out-of-range values into 0..1439', () => {
    expect(fromMinutes(-10)).toBe('00:00');
    expect(fromMinutes(1440)).toBe('23:59');
    expect(fromMinutes(99999)).toBe('23:59');
  });
});

describe('weekdayInitial', () => {
  it("distinguishes Tuesday ('Tu') from Thursday ('Th')", () => {
    expect(weekdayInitial('2026-07-07')).toBe('Tu');
    expect(weekdayInitial('2026-07-09')).toBe('Th');
  });

  it('covers the rest of the week distinctly', () => {
    // Mon 2026-06-29 .. Sun 2026-07-05.
    const initials = ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'].map(weekdayInitial);
    expect(initials).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    expect(new Set(initials).size).toBe(7);
  });
});

describe('mondayOf', () => {
  it('returns the preceding Monday for a mid-week date', () => {
    expect(mondayOf('2026-07-02')).toBe('2026-06-29'); // Thursday -> Monday
  });

  it('is a fixed point on a Monday', () => {
    expect(mondayOf('2026-06-29')).toBe('2026-06-29');
  });

  it('treats Sunday as the END of the week (Mon-Sun)', () => {
    expect(mondayOf('2026-07-05')).toBe('2026-06-29');
  });
});

describe('applyBlockDrag', () => {
  // A 08:00-22:00 visible day.
  const DAY_START = 8 * 60;
  const DAY_END = 22 * 60;

  it('snaps a dragged top edge to the hour', () => {
    // 10:00-12:00 block; dragging the top down 40min lands at 10:40 -> snaps 11:00.
    const r = applyBlockDrag('top', 600, 720, 40, DAY_START, DAY_END);
    expect(r).toEqual({ start: 660, end: 720 });
  });

  it('snaps a dragged bottom edge to the hour', () => {
    // 10:00-12:00 block; dragging the bottom up 25min lands 11:35 -> snaps 12:00.
    const r = applyBlockDrag('bottom', 600, 720, -25, DAY_START, DAY_END);
    expect(r).toEqual({ start: 600, end: 720 });
  });

  it('enforces minLen when the top edge is pushed into the bottom', () => {
    // Top edge dragged 3h down onto a 2h block: start would pass end, so the
    // start is pulled back to end - minLen.
    const r = applyBlockDrag('top', 600, 720, 180, DAY_START, DAY_END);
    expect(r).toEqual({ start: 660, end: 720 });
    expect(r.end - r.start).toBe(60);
  });

  it('enforces minLen when the bottom edge is pushed into the top', () => {
    const r = applyBlockDrag('bottom', 600, 720, -180, DAY_START, DAY_END);
    expect(r).toEqual({ start: 600, end: 660 });
    expect(r.end - r.start).toBe(60);
  });

  it('respects a custom minLen', () => {
    const r = applyBlockDrag('bottom', 600, 720, -180, DAY_START, DAY_END, 30);
    expect(r).toEqual({ start: 600, end: 630 });
  });

  // Regression: the bottom-edge minLen push (ne = ns + minLen) can overshoot
  // dayEndMin; the fixup must pull the whole block back INSIDE the day instead
  // of letting the final clamp shrink it below minLen.
  it('bottom-edge minLen fixup re-clamps so end never exceeds dayEndMin', () => {
    // 21:30-22:00 block at the very bottom; dragging the bottom up 60min snaps
    // the end to 21:00, under minLen. The naive push (start 21:30 + 60 = 22:30)
    // overshoots the day, so the fixup pulls the whole block back inside:
    // 21:00-22:00 — full minLen, flush with the day end.
    const r = applyBlockDrag('bottom', 1290, 1320, -60, DAY_START, DAY_END);
    expect(r.end).toBeLessThanOrEqual(DAY_END);
    expect(r.end - r.start).toBe(60);
    expect(r).toEqual({ start: 1260, end: 1320 });
  });

  it('bottom-edge drag past the day end clamps to dayEndMin', () => {
    const r = applyBlockDrag('bottom', 1260, 1320, 120, DAY_START, DAY_END);
    expect(r).toEqual({ start: 1260, end: DAY_END });
  });

  it('moving a block keeps its length and re-clamps at the day end', () => {
    // 20:00-21:30 moved 2h later: end would hit 23:30, so the block slides back
    // to end exactly at 22:00 with its 90min length intact.
    const r = applyBlockDrag('move', 1200, 1290, 120, DAY_START, DAY_END);
    expect(r.end).toBe(DAY_END);
    expect(r.end - r.start).toBe(90);
  });

  it('moving a block snaps its start to the hour', () => {
    // 10:00-11:30 moved +100min: start 11:40 snaps to 12:00, length preserved.
    const r = applyBlockDrag('move', 600, 690, 100, DAY_START, DAY_END);
    expect(r).toEqual({ start: 720, end: 810 });
  });
});
