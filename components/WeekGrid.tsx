// =============================================================================
// OutNYC — week calendar grid (components/WeekGrid.tsx)
// =============================================================================
// The heart of the app: a Mon-Sun hour grid where
//   - tapping an empty hour adds a green "free" block
//   - green blocks drag on both edges (start/end) and as a whole; long-press
//     removes them
//   - once a day is planned, navy plan blocks tile INSIDE the free window at
//     their true time/size; leftover free time stays visible as green
//   - tapping a plan block or a day header selects the day (expanded below)
// Hairline rules, near-flat corners, restrained palette.
// =============================================================================

import { useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  PanResponder,
  PanResponderGestureState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { holidayFor } from '../lib/holidays';
import { useStore } from '../lib/store';
import { colors, font, radius } from '../lib/theme';
import { applyBlockDrag, toMinutes } from '../lib/time';
import type { Availability, Plan, PlanItem, TimeWindow } from '../lib/types';

export const DAY_START_H = 9;
export const DAY_END_H = 23;
export const HOUR_PX = 30;
const HOURS = Array.from({ length: DAY_END_H - DAY_START_H }, (_, i) => i + DAY_START_H);
const TRACK_H = (DAY_END_H - DAY_START_H) * HOUR_PX;
const MIN_BLOCK_MIN = 60;

function hourLabel(h: number): string {
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/** Minutes-from-day-start -> px offset in the track. */
function minToPx(min: number): number {
  return ((min - DAY_START_H * 60) / 60) * HOUR_PX;
}

function pxToMin(px: number): number {
  return DAY_START_H * 60 + (px / HOUR_PX) * 60;
}

function snap(min: number): number {
  return Math.round(min / 60) * 60;
}

function clampMin(min: number): number {
  return Math.max(DAY_START_H * 60, Math.min(DAY_END_H * 60, min));
}

interface DragState {
  edge: 'top' | 'bottom' | 'move';
  dy: number;
}

// ---- One draggable green availability block ---------------------------------

function FreeBlock({
  window: w,
  elevated,
  onCommit,
  onRemove,
  onSelect,
  onDragActive,
}: {
  window: TimeWindow;
  /** Raise above plan blocks (the selected day) so edges stay draggable. */
  elevated: boolean;
  onCommit: (startMin: number, endMin: number) => void;
  onRemove: () => void;
  onSelect: () => void;
  onDragActive: (active: boolean) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);

  const startMin = toMinutes(w.start);
  const endMin = toMinutes(w.end);

  // PanResponders are created ONCE per mount, so their callbacks must read
  // everything through this ref (updated every render) — otherwise a drag
  // after any prop change would commit through a stale closure.
  const live = useRef({ startMin, endMin, onCommit, onRemove, onSelect, onDragActive });
  live.current = { startMin, endMin, onCommit, onRemove, onSelect, onDragActive };

  const makeResponder = (edge: DragState['edge']) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => edge !== 'move',
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        setDrag({ edge, dy: 0 });
        live.current.onDragActive(true);
      },
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
        setDrag({ edge, dy: g.dy });
      },
      onPanResponderRelease: (_e, g) => {
        const dy = g.dy;
        setDrag(null);
        live.current.onDragActive(false);
        if (edge === 'move' && Math.abs(dy) < 6) {
          live.current.onSelect();
          return;
        }
        const { start, end } = applyBlockDrag(
          edge,
          live.current.startMin,
          live.current.endMin,
          (dy / HOUR_PX) * 60,
          DAY_START_H * 60,
          DAY_END_H * 60,
          MIN_BLOCK_MIN,
        );
        live.current.onCommit(start, end);
      },
      onPanResponderTerminate: () => {
        setDrag(null);
        live.current.onDragActive(false);
      },
    });

  const topPan = useRef(makeResponder('top')).current;
  const bottomPan = useRef(makeResponder('bottom')).current;
  const movePan = useRef(makeResponder('move')).current;

  // Live-preview geometry while dragging, clamped to the track.
  let top = minToPx(startMin);
  let height = minToPx(endMin) - top;
  if (drag) {
    if (drag.edge === 'top') {
      top += drag.dy;
      height -= drag.dy;
    } else if (drag.edge === 'bottom') {
      height += drag.dy;
    } else {
      top += drag.dy;
    }
    top = Math.max(0, Math.min(top, TRACK_H - 12));
    height = Math.max(12, Math.min(height, TRACK_H - top));
  }

  return (
    <View
      {...movePan.panHandlers}
      style={[
        styles.freeBlock,
        { top, height },
        elevated ? styles.freeBlockElevated : null,
        drag ? styles.freeBlockActive : null,
      ]}
    >
      <Pressable
        accessibilityLabel={`Free ${w.start} to ${w.end}. Long press to remove.`}
        onPress={onSelect}
        onLongPress={onRemove}
        style={StyleSheet.absoluteFill}
      />
      {/* Edge handles */}
      <View {...topPan.panHandlers} style={[styles.handle, styles.handleTop]}>
        <View style={styles.handleBar} />
      </View>
      <View {...bottomPan.panHandlers} style={[styles.handle, styles.handleBottom]}>
        <View style={styles.handleBar} />
      </View>
    </View>
  );
}

// ---- The grid ----------------------------------------------------------------

export interface WeekGridProps {
  dates: string[];
  today: string;
  availabilityByDate: Record<string, Availability>;
  plansByKey: Record<string, Plan>;
  selectedDate: string | null;
  onSelectDay: (date: string) => void;
  onSetWindows: (date: string, windows: TimeWindow[]) => void;
  onDragActive: (active: boolean) => void;
}

export function WeekGrid({
  dates,
  today,
  availabilityByDate,
  plansByKey,
  selectedDate,
  onSelectDay,
  onSetWindows,
  onDragActive,
}: WeekGridProps) {
  const plansByDate = useMemo(() => {
    const map: Record<string, PlanItem[]> = {};
    for (const p of Object.values(plansByKey)) {
      if (!dates.includes(p.date)) continue;
      map[p.date] = [
        ...(map[p.date] ?? []),
        ...p.items.filter((i) => i.kind !== 'walk' && i.kind !== 'break'),
      ];
    }
    return map;
  }, [plansByKey, dates]);

  /** Merge windows through an hour-set so edits never overlap. */
  function normalize(windows: { s: number; e: number }[]): TimeWindow[] {
    const hours = new Set<number>();
    for (const w of windows) {
      for (let h = Math.floor(w.s / 60); h < Math.ceil(w.e / 60); h += 1) {
        if (h >= DAY_START_H && h < DAY_END_H) hours.add(h);
      }
    }
    const sorted = [...hours].sort((a, b) => a - b);
    const out: TimeWindow[] = [];
    let start: number | null = null;
    let prev = -2;
    const pad = (n: number) => String(n).padStart(2, '0');
    for (const h of sorted) {
      if (start === null) start = h;
      else if (h !== prev + 1) {
        out.push({ start: `${pad(start)}:00`, end: `${pad(prev + 1)}:00` });
        start = h;
      }
      prev = h;
    }
    if (start !== null) out.push({ start: `${pad(start)}:00`, end: `${pad(prev + 1)}:00` });
    return out;
  }

  /** Render path: reactive prop. */
  function windowsOf(date: string): TimeWindow[] {
    return availabilityByDate[date]?.windows ?? [];
  }

  /** Mutation path: always the freshest store state so rapid edits never
   *  clobber each other (burst taps land within one render frame). */
  function freshWindows(date: string): { s: number; e: number }[] {
    const ws = useStore.getState().availabilityByDate[date]?.windows ?? [];
    return ws.map((w) => ({ s: toMinutes(w.start), e: toMinutes(w.end) }));
  }

  function addHour(date: string, h: number) {
    const ws = freshWindows(date);
    ws.push({ s: h * 60, e: (h + 1) * 60 });
    onSetWindows(date, normalize(ws));
    onSelectDay(date);
  }

  /** Commit a resize by matching the ORIGINAL window value (never a stale
   *  index: merges/removals can reshuffle positions between render and drop). */
  function resizeWindow(date: string, orig: TimeWindow, ns: number, ne: number) {
    const os = toMinutes(orig.start);
    const oe = toMinutes(orig.end);
    const ws = freshWindows(date);
    const idx = ws.findIndex((w) => w.s === os && w.e === oe);
    if (idx < 0) return; // the window changed under us; drop the edit
    ws[idx] = { s: ns, e: ne };
    onSetWindows(date, normalize(ws));
  }

  function removeWindow(date: string, orig: TimeWindow) {
    const os = toMinutes(orig.start);
    const oe = toMinutes(orig.end);
    const ws = freshWindows(date).filter((w) => !(w.s === os && w.e === oe));
    onSetWindows(date, normalize(ws));
  }

  return (
    <View>
      {/* Day headers */}
      <View style={styles.headRow}>
        <View style={styles.gutter} />
        {dates.map((d) => {
          const isToday = d === today;
          const isSelected = d === selectedDate;
          const holiday = holidayFor(d);
          const dayNum = parseInt(d.slice(-2), 10);
          const weekday = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][
            new Date(`${d}T12:00:00Z`).getUTCDay()
          ];
          return (
            <Pressable
              key={d}
              accessibilityRole="button"
              accessibilityLabel={`Select ${d}`}
              onPress={() => onSelectDay(d)}
              style={styles.dayHead}
            >
              <Text style={[styles.dayInitial, isToday && { color: colors.accent }]}>
                {weekday}
              </Text>
              <View
                style={[
                  styles.dayNumWrap,
                  isToday && styles.todayNumWrap,
                  isSelected && !isToday && styles.selectedNumWrap,
                ]}
              >
                <Text
                  style={[
                    styles.dayNum,
                    isToday && { color: colors.onArt },
                  ]}
                >
                  {dayNum}
                </Text>
              </View>
              {holiday ? (
                <View
                  accessibilityLabel={holiday.name}
                  style={[styles.holidayTick, { backgroundColor: holiday.color }]}
                />
              ) : (
                <View style={styles.holidayTickSpacer} />
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Hour grid */}
      <View style={styles.body}>
        {/* Time gutter */}
        <View style={[styles.gutter, { height: TRACK_H }]}>
          {HOURS.map((h) => (
            <Text key={h} style={[styles.hourLabel, { top: minToPx(h * 60) - 6 }]}>
              {hourLabel(h)}
            </Text>
          ))}
        </View>

        {dates.map((d) => (
          <View key={d} style={[styles.col, { height: TRACK_H }]}>
            {/* Hairline hour rules + tap-to-add cells */}
            {HOURS.map((h) => (
              <Pressable
                key={h}
                accessibilityLabel={`Add free time ${d} ${hourLabel(h)}`}
                onPress={() => addHour(d, h)}
                style={[styles.hourCell, { top: minToPx(h * 60) }]}
              />
            ))}

            {/* Free (green) blocks */}
            {windowsOf(d).map((w) => (
              <FreeBlock
                key={`${w.start}-${w.end}`}
                window={w}
                elevated={selectedDate === d}
                onCommit={(ns, ne) => resizeWindow(d, w, ns, ne)}
                onRemove={() => removeWindow(d, w)}
                onSelect={() => onSelectDay(d)}
                onDragActive={onDragActive}
              />
            ))}

            {/* Plan blocks tile INSIDE the free window */}
            {(plansByDate[d] ?? []).map((item) => {
              const top = minToPx(Math.max(toMinutes(item.startTime), DAY_START_H * 60));
              const bottom = minToPx(Math.min(toMinutes(item.endTime), DAY_END_H * 60));
              const h = bottom - top;
              if (h <= 2) return null;
              return (
                <Pressable
                  key={`${item.id}-${item.startTime}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${item.startTime}`}
                  onPress={() => onSelectDay(d)}
                  style={({ pressed }) => [
                    styles.planBlock,
                    { top, height: h },
                    pressed && { backgroundColor: colors.plannedPressed },
                  ]}
                >
                  {h >= 24 ? (
                    <Text numberOfLines={h >= 44 ? 3 : 1} style={styles.planBlockText}>
                      {item.title}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  gutter: {
    width: 30,
    position: 'relative',
  },
  hourLabel: {
    position: 'absolute',
    right: 4,
    fontSize: 10,
    color: colors.textFaint,
  },
  dayHead: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingBottom: 2,
  },
  dayInitial: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: font.weight.semibold,
    letterSpacing: 0.5,
  },
  dayNumWrap: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayNumWrap: { backgroundColor: colors.accent },
  selectedNumWrap: { borderWidth: 1, borderColor: colors.borderStrong },
  dayNum: { fontSize: 12, color: colors.text, fontWeight: font.weight.semibold },
  holidayTick: {
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  holidayTickSpacer: { height: 2 },
  body: {
    flexDirection: 'row',
  },
  col: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.gridLine,
  },
  hourCell: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HOUR_PX,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gridLine,
  },
  freeBlock: {
    position: 'absolute',
    left: 2,
    right: 2,
    backgroundColor: colors.freeSoft,
    borderWidth: 1,
    borderColor: colors.free,
    borderRadius: radius.sm,
  },
  freeBlockActive: {
    borderColor: colors.text,
  },
  // The selected day's green blocks ride above its plan blocks so the edge
  // handles stay reachable once the day is planned; translucent so the navy
  // blocks stay visible underneath.
  freeBlockElevated: {
    zIndex: 10,
    backgroundColor: 'rgba(46,107,88,0.12)',
    borderWidth: 1.5,
  },
  handle: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleTop: { top: -4 },
  handleBottom: { bottom: -4 },
  handleBar: {
    width: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.free,
  },
  planBlock: {
    position: 'absolute',
    left: 4,
    right: 4,
    backgroundColor: colors.planned,
    borderRadius: radius.sm,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  planBlockText: {
    color: colors.onArt,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: font.weight.medium,
  },
});
