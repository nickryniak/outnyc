// =============================================================================
// OutNYC — weekly calendar home (app/(tabs)/week.tsx)
// =============================================================================
// The heart of the app. A Mon–Sun calendar where you PAINT your free time by
// tapping hour cells, then generate/reshuffle a plan for a single day or the
// whole week. Each day shows its stop titles; tap "Open" for the full itinerary.
// =============================================================================

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Skyline } from '../../components/Skyline';
import { Button, Caption, LoadingView } from '../../components/ui';
import { useStore } from '../../lib/store';
import { colors, font, radius, spacing } from '../../lib/theme';
import {
  addDays,
  mondayOf,
  monthDayLabel,
  todayNY,
  toMinutes,
  weekDates,
  weekdayInitial,
  weekRangeLabel,
} from '../../lib/time';
import type { Plan, TimeWindow } from '../../lib/types';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 9); // 9 AM … 10 PM cell (→ 11 PM)

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function hourLabel(h: number): string {
  if (h === 12) return '12p';
  if (h === 0 || h === 24) return '12a';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function windowsToHours(windows: TimeWindow[]): Set<number> {
  const s = new Set<number>();
  for (const w of windows) {
    const start = Math.floor(toMinutes(w.start) / 60);
    const end = Math.ceil(toMinutes(w.end) / 60);
    for (let h = start; h < end; h += 1) s.add(h);
  }
  return s;
}

function hoursToWindows(hs: Set<number>): TimeWindow[] {
  const sorted = [...hs].filter((h) => h >= HOURS[0] && h <= HOURS[HOURS.length - 1]).sort((a, b) => a - b);
  const out: TimeWindow[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const h of sorted) {
    if (start === null) {
      start = h;
      prev = h;
    } else if (h === (prev as number) + 1) {
      prev = h;
    } else {
      out.push({ start: `${pad(start)}:00`, end: `${pad((prev as number) + 1)}:00` });
      start = h;
      prev = h;
    }
  }
  if (start !== null) out.push({ start: `${pad(start)}:00`, end: `${pad((prev as number) + 1)}:00` });
  return out;
}

export default function WeekScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loadStatus = useStore((s) => s.loadStatus);
  const availabilityByDate = useStore((s) => s.availabilityByDate);
  const plansByKey = useStore((s) => s.plansByKey);
  const setAvailability = useStore((s) => s.setAvailability);
  const generateWeek = useStore((s) => s.generateWeek);
  const reshuffleWeek = useStore((s) => s.reshuffleWeek);

  const [weekOffset, setWeekOffset] = useState(0);
  const [busy, setBusy] = useState(false);

  const today = todayNY();
  const monday = useMemo(() => mondayOf(addDays(today, weekOffset * 7)), [today, weekOffset]);
  const dates = useMemo(() => weekDates(monday), [monday]);

  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return <LoadingView label="Loading your week…" />;
  }

  const hoursByDate: Record<string, Set<number>> = {};
  for (const d of dates) hoursByDate[d] = windowsToHours(availabilityByDate[d]?.windows ?? []);

  const plansForDate = (date: string): Plan[] =>
    Object.values(plansByKey).filter((p) => p.date === date && p.items.length > 0);

  const anyFree = dates.some((d) => hoursByDate[d].size > 0);
  const anyPlans = dates.some((d) => plansForDate(d).length > 0);

  function toggleCell(date: string, h: number) {
    // Read the freshest availability from the store (not the render closure) so
    // fast repeated taps accumulate instead of clobbering each other.
    const current = useStore.getState().availabilityByDate[date]?.windows ?? [];
    const hs = windowsToHours(current);
    if (hs.has(h)) hs.delete(h);
    else hs.add(h);
    void setAvailability(date, hoursToWindows(hs));
  }

  async function onGenerateWeek() {
    setBusy(true);
    try {
      await generateWeek(dates);
    } finally {
      setBusy(false);
    }
  }

  async function onReshuffleWeek() {
    setBusy(true);
    try {
      await reshuffleWeek(dates);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      {/* Header with subtle skyline */}
      <View style={[styles.header, { height: 96 + insets.top }]}>
        <Skyline variant="evening" height={96 + insets.top} />
        <LinearGradient
          colors={['rgba(18,14,10,0.1)', 'rgba(18,14,10,0.55)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.headerText, { top: insets.top + spacing.sm }]}>
          <Text style={styles.headerEyebrow}>WEEK OF</Text>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{weekRangeLabel(monday)}</Text>
            <View style={styles.weekNav}>
              <Pressable
                accessibilityLabel="Previous week"
                onPress={() => setWeekOffset((o) => o - 1)}
                style={styles.navBtn}
              >
                <Text style={styles.navGlyph}>‹</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Next week"
                onPress={() => setWeekOffset((o) => o + 1)}
                style={styles.navBtn}
              >
                <Text style={styles.navGlyph}>›</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <Caption muted>Tap the hours you’re free, then generate your week.</Caption>

        {/* Calendar grid */}
        <View style={styles.grid}>
          {/* Column headers */}
          <View style={styles.gridRow}>
            <View style={styles.hourLabel} />
            {dates.map((d) => {
              const isToday = d === today;
              return (
                <View key={d} style={styles.dayHead}>
                  <Text style={[styles.dayInitial, isToday && styles.todayText]}>
                    {weekdayInitial(d)}
                  </Text>
                  <View style={[styles.dayNumWrap, isToday && styles.todayNumWrap]}>
                    <Text style={[styles.dayNum, isToday && styles.todayNumText]}>
                      {parseInt(d.slice(-2), 10)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Hour rows */}
          {HOURS.map((h) => (
            <View key={h} style={styles.gridRow}>
              <Text style={styles.hourLabel}>{hourLabel(h)}</Text>
              {dates.map((d) => {
                const free = hoursByDate[d].has(h);
                return (
                  <Pressable
                    key={`${d}-${h}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${weekdayInitial(d)} ${hourLabel(h)} ${free ? 'free' : 'busy'}`}
                    onPress={() => toggleCell(d, h)}
                    style={[styles.cell, free ? styles.cellFree : styles.cellBusy]}
                  />
                );
              })}
            </View>
          ))}
        </View>

        {/* Week actions */}
        <View style={styles.weekActions}>
          <Button
            label={anyPlans ? 'Regenerate week' : 'Generate week'}
            onPress={onGenerateWeek}
            loading={busy}
            disabled={!anyFree}
          />
          {anyPlans ? (
            <Button label="Reshuffle week" variant="secondary" onPress={onReshuffleWeek} disabled={busy} />
          ) : null}
        </View>

        {/* Per-day results */}
        {dates.map((d) => {
          const hasFree = hoursByDate[d].size > 0;
          if (!hasFree) return null;
          const plans = plansForDate(d);
          const titles = plans.flatMap((p) =>
            p.items.filter((i) => i.kind !== 'walk' && i.kind !== 'break').map((i) => i.title),
          );
          return (
            <Pressable
              key={`res-${d}`}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/plan/[date]', params: { date: d } })}
              style={({ pressed }) => [styles.dayCard, pressed && styles.pressed]}
            >
              <View style={styles.dayCardHead}>
                <Text style={styles.dayCardTitle}>{monthDayLabel(d)}</Text>
                <Text style={styles.openLink}>{titles.length ? 'Open →' : 'Plan →'}</Text>
              </View>
              {titles.length ? (
                <Text style={styles.titleList}>{titles.join('  ·  ')}</Text>
              ) : (
                <Caption muted>Free time set — tap to generate this day.</Caption>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const CELL = 26;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { overflow: 'hidden' },
  headerText: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  headerEyebrow: {
    color: colors.onArtMuted,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    letterSpacing: 2.5,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: {
    color: colors.onArt,
    fontFamily: font.family.display,
    fontSize: font.size.xxl,
    letterSpacing: -0.5,
  },
  weekNav: { flexDirection: 'row', gap: spacing.xs },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(251,247,236,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navGlyph: { color: colors.onArt, fontSize: font.size.lg, lineHeight: font.size.lg + 2 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  grid: { gap: 3 },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  hourLabel: {
    width: 30,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: 'right',
    paddingRight: 4,
  },
  dayHead: { flex: 1, alignItems: 'center', gap: 2, paddingBottom: 4 },
  dayInitial: { fontSize: 11, color: colors.textMuted, fontWeight: font.weight.semibold },
  dayNumWrap: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayNumWrap: { backgroundColor: colors.accent },
  dayNum: { fontSize: 12, color: colors.text, fontWeight: font.weight.semibold },
  todayNumText: { color: colors.onArt },
  todayText: { color: colors.accent },
  cell: {
    flex: 1,
    height: CELL,
    borderRadius: 5,
    borderWidth: 1,
  },
  cellBusy: { backgroundColor: colors.surface, borderColor: colors.border },
  cellFree: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  weekActions: { gap: spacing.sm, marginTop: spacing.sm },
  dayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  dayCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayCardTitle: {
    color: colors.text,
    fontFamily: font.family.heading,
    fontSize: font.size.lg,
  },
  openLink: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  titleList: { color: colors.textMuted, fontSize: font.size.sm, lineHeight: 20 },
  pressed: { opacity: 0.85 },
});
