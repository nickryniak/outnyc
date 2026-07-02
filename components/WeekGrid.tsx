// =============================================================================
// OutNYC — week calendar grid (components/WeekGrid.tsx)
// =============================================================================
// The heart of the app: a Mon-Sun hour grid where
//   - each day column header carries a neighborhood button (tap to pick that
//     day's NYC neighborhoods)
//   - tapping an empty hour adds a one-hour free block; DRAGGING down an empty
//     column paints a range in one gesture
//   - green blocks resize from either edge; long-press removes them
//   - once a day is planned, plan blocks tile INSIDE the free window at their
//     true time/size (kind-colored), leftover free time stays green
//   - tapping a plan block or a day header selects the day (expanded below)
// Hairline rules, near-flat corners, restrained palette.
// =============================================================================

import { MapPin } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Modal,
  PanResponder,
  PanResponderGestureState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { NEIGHBORHOODS } from '../lib/constants';
import { holidayFor } from '../lib/holidays';
import { resolvePrefs, useStore } from '../lib/store';
import { colors, font, kindColor, radius, spacing } from '../lib/theme';
import { applyBlockDrag, monthDayLabel, toMinutes, weekdayLabel } from '../lib/time';
import type { Availability, Plan, PlanItem, TimeWindow } from '../lib/types';

export const DAY_START_H = 9;
export const DAY_END_H = 23;
export const HOUR_PX = 32;
const HOURS = Array.from({ length: DAY_END_H - DAY_START_H }, (_, i) => i + DAY_START_H);
const TRACK_H = (DAY_END_H - DAY_START_H) * HOUR_PX;
const MIN_BLOCK_MIN = 60;

function hourLabel(h: number): string {
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/** Minutes-from-midnight -> px offset in the track. */
function minToPx(min: number): number {
  return ((min - DAY_START_H * 60) / 60) * HOUR_PX;
}

/** Column-relative px -> whole hour (floored, clamped to the visible day). */
function pxToHour(relY: number): number {
  const h = DAY_START_H + Math.floor(relY / HOUR_PX);
  return Math.max(DAY_START_H, Math.min(DAY_END_H - 1, h));
}

interface DragState {
  edge: 'top' | 'bottom';
  dy: number;
}

/** Static green fill drawn BEHIND the plan blocks so leftover free time shows
 *  and planned time reads as navy on top. Tap selects the day for editing. */
function FreeFill({ window: w, onSelect }: { window: TimeWindow; onSelect: () => void }) {
  const top = minToPx(toMinutes(w.start));
  const height = minToPx(toMinutes(w.end)) - top;
  return (
    <Pressable
      accessibilityLabel={`Free ${w.start} to ${w.end}`}
      onPress={onSelect}
      style={[styles.freeFill, { top, height }]}
    />
  );
}

// ---- Editable green block (selected day only), drawn ON TOP of plan blocks --

function FreeBlockEditor({
  window: w,
  onCommit,
  onRemove,
  onSelect,
  onDragActive,
}: {
  window: TimeWindow;
  onCommit: (startMin: number, endMin: number) => void;
  onRemove: () => void;
  onSelect: () => void;
  onDragActive: (active: boolean) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const startMin = toMinutes(w.start);
  const endMin = toMinutes(w.end);

  // PanResponders are created once per mount, so read live values via a ref.
  const live = useRef({ startMin, endMin, onCommit, onDragActive });
  live.current = { startMin, endMin, onCommit, onDragActive };

  const makeEdge = (edge: DragState['edge']) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setDrag({ edge, dy: 0 });
        live.current.onDragActive(true);
      },
      onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
        setDrag({ edge, dy: g.dy });
      },
      onPanResponderRelease: (_e, g) => {
        setDrag(null);
        live.current.onDragActive(false);
        const { start, end } = applyBlockDrag(
          edge,
          live.current.startMin,
          live.current.endMin,
          (g.dy / HOUR_PX) * 60,
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

  const topPan = useRef(makeEdge('top')).current;
  const bottomPan = useRef(makeEdge('bottom')).current;

  let top = minToPx(startMin);
  let height = minToPx(endMin) - top;
  if (drag) {
    if (drag.edge === 'top') {
      top += drag.dy;
      height -= drag.dy;
    } else {
      height += drag.dy;
    }
    top = Math.max(0, Math.min(top, TRACK_H - 12));
    height = Math.max(12, Math.min(height, TRACK_H - top));
  }

  return (
    <View
      style={[styles.freeBlock, { top, height }, drag ? styles.freeBlockActive : null]}
    >
      <Pressable
        accessibilityLabel={`Free ${w.start} to ${w.end}. Long press to remove.`}
        onPress={onSelect}
        onLongPress={onRemove}
        delayLongPress={350}
        style={StyleSheet.absoluteFill}
      />
      <View {...topPan.panHandlers} style={[styles.handle, styles.handleTop]}>
        <View style={styles.handleBar} />
      </View>
      <View {...bottomPan.panHandlers} style={[styles.handle, styles.handleBottom]}>
        <View style={styles.handleBar} />
      </View>
    </View>
  );
}

// ---- Column touch surface: tap adds an hour, drag paints a range ------------

function ColumnSurface({
  date,
  hasWindowAt,
  onTapHour,
  onPaintRange,
  onDragActive,
}: {
  date: string;
  hasWindowAt: (relY: number) => boolean;
  onTapHour: (h: number) => void;
  onPaintRange: (startH: number, endH: number) => void;
  onDragActive: (active: boolean) => void;
}) {
  const [preview, setPreview] = useState<{ a: number; b: number } | null>(null);
  const startRelY = useRef(0);
  const live = useRef({ hasWindowAt, onTapHour, onPaintRange, onDragActive });
  live.current = { hasWindowAt, onTapHour, onPaintRange, onDragActive };

  const pan = useRef(
    PanResponder.create({
      // Claim empty grid; decline touches that land on an existing green block
      // so its edges/body keep working.
      onStartShouldSetPanResponder: (e) => !live.current.hasWindowAt(e.nativeEvent.locationY),
      onPanResponderGrant: (e, g) => {
        startRelY.current = e.nativeEvent.locationY - g.dy;
      },
      onPanResponderMove: (_e, g) => {
        const a = startRelY.current;
        const b = startRelY.current + g.dy;
        if (Math.abs(g.dy) > 8) {
          live.current.onDragActive(true);
          setPreview({ a: Math.min(a, b), b: Math.max(a, b) });
        }
      },
      onPanResponderRelease: (_e, g) => {
        const moved = Math.abs(g.dy) > 8;
        setPreview(null);
        live.current.onDragActive(false);
        if (!moved) {
          live.current.onTapHour(pxToHour(startRelY.current));
          return;
        }
        const startH = pxToHour(Math.min(startRelY.current, startRelY.current + g.dy));
        const endH =
          Math.max(startH + 1, pxToHour(Math.max(startRelY.current, startRelY.current + g.dy)) + 1);
        live.current.onPaintRange(startH, Math.min(endH, DAY_END_H));
      },
      onPanResponderTerminate: () => {
        setPreview(null);
        live.current.onDragActive(false);
      },
    }),
  ).current;

  return (
    <View
      accessibilityLabel={`Add free time on ${date}`}
      style={StyleSheet.absoluteFill}
      {...pan.panHandlers}
    >
      {preview ? (
        <View
          pointerEvents="none"
          style={[styles.paintPreview, { top: preview.a, height: Math.max(12, preview.b - preview.a) }]}
        />
      ) : null}
    </View>
  );
}

// ---- Neighborhood picker modal ----------------------------------------------

function NeighborhoodModal({
  date,
  onClose,
}: {
  date: string | null;
  onClose: () => void;
}) {
  const profile = useStore((s) => s.profile);
  const dayPrefs = useStore((s) => (date ? s.dayPrefsByDate[date] : undefined));
  const setDayPrefs = useStore((s) => s.setDayPrefs);
  const clearDayPrefs = useStore((s) => s.clearDayPrefs);

  if (!date || !profile) return null;
  const selected = resolvePrefs(profile, dayPrefs).neighborhoods;

  function toggle(n: string) {
    const next = selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n];
    if (next.length > 0) void setDayPrefs(date as string, { neighborhoods: next });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <Text style={styles.modalEyebrow}>NEIGHBORHOODS</Text>
          <Text style={styles.modalTitle}>
            {weekdayLabel(date)}, {monthDayLabel(date)}
          </Text>
          <Text style={styles.modalHint}>Where do you want this day to happen?</Text>
          <View style={styles.chipWrap}>
            {NEIGHBORHOODS.map((n) => {
              const on = selected.includes(n);
              return (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  onPress={() => toggle(n)}
                  style={[styles.nbChip, on && styles.nbChipOn]}
                >
                  <Text style={[styles.nbChipText, on && styles.nbChipTextOn]}>{n}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.modalActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void clearDayPrefs(date)}
              style={styles.modalGhost}
            >
              <Text style={styles.modalGhostText}>Use my usual</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalDone}>
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
  const profile = useStore((s) => s.profile);
  const dayPrefsByDate = useStore((s) => s.dayPrefsByDate);
  const [nbModalDate, setNbModalDate] = useState<string | null>(null);

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

  function windowsOf(date: string): TimeWindow[] {
    return availabilityByDate[date]?.windows ?? [];
  }

  /** Mutation path: always the freshest store state. */
  function freshWindows(date: string): { s: number; e: number }[] {
    const ws = useStore.getState().availabilityByDate[date]?.windows ?? [];
    return ws.map((w) => ({ s: toMinutes(w.start), e: toMinutes(w.end) }));
  }

  function addRange(date: string, startH: number, endH: number) {
    const ws = freshWindows(date);
    ws.push({ s: startH * 60, e: endH * 60 });
    onSetWindows(date, normalize(ws));
    onSelectDay(date);
  }

  function resizeWindow(date: string, orig: TimeWindow, ns: number, ne: number) {
    const os = toMinutes(orig.start);
    const oe = toMinutes(orig.end);
    const ws = freshWindows(date);
    const idx = ws.findIndex((w) => w.s === os && w.e === oe);
    if (idx < 0) return;
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
      {/* Day headers + per-day neighborhood buttons */}
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
          const overridden = !!dayPrefsByDate[d]?.neighborhoods?.length;
          const nbCount = profile
            ? resolvePrefs(profile, dayPrefsByDate[d]).neighborhoods.length
            : 0;
          return (
            <View key={d} style={styles.dayHead}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Select ${d}`}
                onPress={() => onSelectDay(d)}
                style={styles.dayHeadTop}
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
                  <Text style={[styles.dayNum, isToday && { color: colors.onArt }]}>{dayNum}</Text>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Choose neighborhoods for ${d}`}
                onPress={() => setNbModalDate(d)}
                style={[styles.nbButton, overridden && styles.nbButtonOn]}
              >
                <MapPin
                  size={9}
                  color={overridden ? colors.accent : colors.textFaint}
                  strokeWidth={2}
                />
                <Text style={[styles.nbButtonText, overridden && { color: colors.accent }]}>
                  {nbCount}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* Hour grid */}
      <View style={styles.body}>
        <View style={[styles.gutter, { height: TRACK_H }]}>
          {HOURS.map((h) => (
            <Text key={h} style={[styles.hourLabel, { top: minToPx(h * 60) - 6 }]}>
              {hourLabel(h)}
            </Text>
          ))}
        </View>

        {dates.map((d) => {
          const windows = windowsOf(d);
          return (
            <View key={d} style={[styles.col, { height: TRACK_H }]}>
              {/* Hairline hour rules (non-interactive) */}
              {HOURS.map((h) => (
                <View key={h} style={[styles.hourRule, { top: minToPx(h * 60) }]} />
              ))}

              {/* Touch surface: tap to add an hour, drag to paint a range */}
              <ColumnSurface
                date={d}
                hasWindowAt={(relY) => {
                  const hr = pxToHour(relY);
                  return freshWindows(d).some((w) => hr * 60 >= w.s && hr * 60 < w.e);
                }}
                onTapHour={(h) => addRange(d, h, h + 1)}
                onPaintRange={(a, b) => addRange(d, a, b)}
                onDragActive={onDragActive}
              />

              {/* Green fill behind the plans (non-selected days show it opaque) */}
              {selectedDate !== d
                ? windows.map((w) => (
                    <FreeFill key={`${w.start}-${w.end}`} window={w} onSelect={() => onSelectDay(d)} />
                  ))
                : null}

              {/* Plan blocks tile INSIDE the free window (kind-colored) */}
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
                      { top, height: h, borderLeftColor: kindColor(item.kind) },
                      pressed && { backgroundColor: colors.plannedPressed },
                    ]}
                  >
                    {h >= 20 ? (
                      <Text numberOfLines={1} style={styles.planBlockText}>
                        {item.title}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}

              {/* Selected day: an editable translucent overlay on TOP of the
                  plans, so its edges stay grabbable while plans show through. */}
              {selectedDate === d
                ? windows.map((w) => (
                    <FreeBlockEditor
                      key={`${w.start}-${w.end}`}
                      window={w}
                      onCommit={(ns, ne) => resizeWindow(d, w, ns, ne)}
                      onRemove={() => removeWindow(d, w)}
                      onSelect={() => onSelectDay(d)}
                      onDragActive={onDragActive}
                    />
                  ))
                : null}
            </View>
          );
        })}
      </View>

      <NeighborhoodModal date={nbModalDate} onClose={() => setNbModalDate(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', marginBottom: 4 },
  gutter: { width: 26, position: 'relative' },
  hourLabel: { position: 'absolute', right: 3, fontSize: 10, color: colors.textFaint },
  dayHead: { flex: 1, alignItems: 'center', gap: 3 },
  dayHeadTop: { alignItems: 'center', gap: 2 },
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
  holidayTick: { width: 14, height: 2, borderRadius: 1 },
  holidayTickSpacer: { height: 2 },
  nbButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  nbButtonOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  nbButtonText: { fontSize: 10, color: colors.textMuted, fontWeight: font.weight.semibold },
  body: { flexDirection: 'row' },
  col: {
    flex: 1,
    position: 'relative',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.gridLine,
  },
  hourRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HOUR_PX,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gridLine,
  },
  paintPreview: {
    position: 'absolute',
    left: 2,
    right: 2,
    backgroundColor: 'rgba(46,107,88,0.28)',
    borderWidth: 1,
    borderColor: colors.free,
    borderRadius: radius.sm,
  },
  // Opaque background fill (non-selected days).
  freeFill: {
    position: 'absolute',
    left: 2,
    right: 2,
    backgroundColor: colors.freeSoft,
    borderWidth: 1,
    borderColor: colors.free,
    borderRadius: radius.sm,
  },
  // Translucent editable overlay (selected day), so plans show through.
  freeBlock: {
    position: 'absolute',
    left: 2,
    right: 2,
    zIndex: 10,
    backgroundColor: 'rgba(46,107,88,0.14)',
    borderWidth: 1.5,
    borderColor: colors.free,
    borderRadius: radius.sm,
  },
  freeBlockActive: { borderColor: colors.text },
  handle: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleTop: { top: -5 },
  handleBottom: { bottom: -5 },
  handleBar: { width: 16, height: 3, borderRadius: 2, backgroundColor: colors.free },
  planBlock: {
    position: 'absolute',
    left: 3,
    right: 3,
    backgroundColor: colors.planned,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  planBlockText: {
    color: colors.onArt,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: font.weight.medium,
  },
  // Neighborhood modal
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(20,16,12,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  modalEyebrow: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: font.weight.bold,
    letterSpacing: 1.4,
  },
  modalTitle: { color: colors.text, fontFamily: font.family.heading, fontSize: font.size.xl },
  modalHint: { color: colors.textMuted, fontSize: font.size.sm, marginBottom: spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  nbChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  nbChipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  nbChipText: { color: colors.textMuted, fontSize: font.size.sm },
  nbChipTextOn: { color: colors.accent, fontWeight: font.weight.semibold },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  modalGhost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  modalGhostText: { color: colors.textMuted, fontSize: font.size.sm },
  modalDone: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
  },
  modalDoneText: { color: colors.onArt, fontSize: font.size.md, fontWeight: font.weight.semibold },
});
