// =============================================================================
// OutNYC: weekly calendar home (app/(tabs)/week.tsx)
// =============================================================================
// The app IS this screen. A Mon-Sun calendar: paint or drag your free time,
// plan blocks tile inside the green windows once generated, tap a day (or any
// block) to expand it in place. Windows plan themselves automatically; the
// panel offers the day-scope Reshuffle and per-block Swap. Week-scope actions:
// "Plan my whole week" (fill + auto-plan empty future days) and Clear week.
// =============================================================================

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayPanel } from '../../components/DayPanel';
import { WeekGrid } from '../../components/WeekGrid';
import { Button, Caption, ErrorView, LoadingView, PersistenceBanner } from '../../components/ui';
import { confirmDestructive } from '../../lib/confirm';
import { useStore } from '../../lib/store';
import { colors, font, radius, spacing } from '../../lib/theme';
import {
  addDays,
  fromMinutes,
  mondayOf,
  nowMinutesNY,
  toMinutes,
  weekDates,
  weekRangeLabel,
} from '../../lib/time';
import { useTodayNY } from '../../lib/useTodayNY';
import type { TimeWindow } from '../../lib/types';

/** The free evening "Plan my whole week" paints onto an empty day. */
const DEFAULT_EVENING: TimeWindow = { start: '18:00', end: '23:00' };

export default function WeekScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const loadStatus = useStore((s) => s.loadStatus);
  const bootstrap = useStore((s) => s.bootstrap);
  const loadError = useStore((s) => s.loadError);
  const availabilityByDate = useStore((s) => s.availabilityByDate);
  const plansByKey = useStore((s) => s.plansByKey);
  const dayPrefsByDate = useStore((s) => s.dayPrefsByDate);
  const setAvailability = useStore((s) => s.setAvailability);
  const clearWeek = useStore((s) => s.clearWeek);

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  // Refreshes on foreground, on focus, and at NY midnight while the app stays
  // open, so the today-ring and the past-day filters below never go stale.
  const today = useTodayNY();
  const monday = useMemo(() => mondayOf(addDays(today, weekOffset * 7)), [today, weekOffset]);
  const dates = useMemo(() => weekDates(monday), [monday]);

  // Stable callbacks so WeekGrid's memoized internals aren't re-rendered by
  // fresh closures on every pass. Zustand actions are referentially stable.
  const selectDay = useCallback((date: string) => {
    setSelectedDate(date);
    // Bring the panel into view.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);
  const onSetWindows = useCallback(
    (date: string, windows: TimeWindow[]) => void setAvailability(date, windows),
    [setAvailability],
  );
  const onDragActive = useCallback((active: boolean) => setScrollEnabled(!active), []);

  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return <LoadingView label="Loading your week…" />;
  }
  // Without this, a failed load renders an empty but fully interactive grid:
  // the user's real week looks erased, and painting hours writes into a store
  // that never finished loading.
  if (loadStatus === 'error') {
    return (
      <ErrorView
        message={loadError ?? 'We could not load your week.'}
        onRetry={() => void bootstrap()}
      />
    );
  }

  // Only today-or-future days are auto-fillable: planning a past evening is
  // never useful, and on a fully past week the button disappears entirely.
  // Today drops out too once its default evening has already elapsed (tapping
  // this at 11:30 PM should not paint a 6-11 PM window that is entirely past).
  const todayStillPlannable = nowMinutesNY() < toMinutes(DEFAULT_EVENING.end);
  const plannableDates = dates.filter((d) => d > today || (d === today && todayStillPlannable));
  const emptyDates = plannableDates.filter(
    (d) => (availabilityByDate[d]?.windows.length ?? 0) === 0,
  );
  const anyFree = dates.some((d) => (availabilityByDate[d]?.windows.length ?? 0) > 0);
  const anyPlans = dates.some((d) =>
    Object.values(plansByKey).some((p) => p.date === d && p.items.length > 0),
  );
  // A day-only override carries more than just its `date` key (a cleared one is
  // just `{date}`), so this detects real neighborhood/price/party picks to clear.
  const anyDayPrefs = dates.some(
    (d) => dayPrefsByDate[d] && Object.keys(dayPrefsByDate[d]).length > 1,
  );

  function onPlanWholeWeek() {
    // One tap plans the entire week: every empty day gets a free evening,
    // and auto-planning fills each with an itinerary immediately. Days that
    // already have free time are left exactly as they are. On today, the
    // window starts at the next whole hour so the plan never opens in the past.
    for (const d of emptyDates) {
      const window =
        d === today
          ? {
              start: fromMinutes(
                Math.max(
                  toMinutes(DEFAULT_EVENING.start),
                  Math.ceil(nowMinutesNY() / 60) * 60,
                ),
              ),
              end: DEFAULT_EVENING.end,
            }
          : DEFAULT_EVENING;
      // A late tap can leave under an hour before 23:00; skip rather than
      // create a sliver the planner cannot fill.
      if (toMinutes(window.end) - toMinutes(window.start) < 60) continue;
      void setAvailability(d, [window]);
    }
  }

  function onClearWeek() {
    confirmDestructive(
      'Clear this week?',
      'Removes the free time, plans, and neighborhood picks for all 7 days shown. Your bucket list is kept.',
      'Clear week',
      () => {
        setSelectedDate(null);
        void clearWeek(dates);
      },
    );
  }

  return (
    <View style={styles.container}>
      {/* Station-sign header: solid black bar under the status area, one
          caution-yellow rule along its bottom edge. */}
      <View style={{ paddingTop: insets.top, backgroundColor: colors.bg }}>
        <View style={styles.signBar}>
          {/* This screen IS home; the wordmark button opens the intro. No Home
              icon or "HOME" text: that promised staying put: and the
              accessible name starts with the visible text so Voice Control's
              "Tap OutNYC" resolves (WCAG 2.5.3 label-in-name). */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="OutNYC. View the intro screen"
            onPress={() => router.push('/welcome')}
            hitSlop={10}
            style={styles.brandRow}
          >
            <View style={styles.signDot} />
            <Text style={styles.headerEyebrow}>OUTNYC</Text>
          </Pressable>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{weekRangeLabel(monday)}</Text>
            <View style={styles.weekNav}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous week"
                onPress={() => {
                  setWeekOffset((o) => o - 1);
                  setSelectedDate(null);
                }}
                style={styles.navBtn}
              >
                <Text style={styles.navGlyph}>‹</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next week"
                onPress={() => {
                  setWeekOffset((o) => o + 1);
                  setSelectedDate(null);
                }}
                style={styles.navBtn}
              >
                <Text style={styles.navGlyph}>›</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        scrollEnabled={scrollEnabled}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        <PersistenceBanner />
        {anyFree ? (
          <Caption muted>
            Tap an hour to add free time: it plans itself instantly. Drag a
            block to move it and the plan follows. Tap the neighborhood tag
            under a day to change where it happens.
          </Caption>
        ) : (
          <View style={styles.hintCard}>
            <Text style={styles.hintLine}>Tap an hour to add free time: it plans itself.</Text>
            <Text style={styles.hintLine}>Drag down a day to paint a range.</Text>
            <Text style={styles.hintLine}>Drag a block&apos;s edges to resize; the plan updates.</Text>
          </View>
        )}

        {emptyDates.length > 0 ? (
          <Button
            label={
              emptyDates.length === plannableDates.length
                ? 'Plan my whole week'
                : `Plan the other ${emptyDates.length === 1 ? 'day' : `${emptyDates.length} days`}`
            }
            onPress={onPlanWholeWeek}
          />
        ) : null}

        <WeekGrid
          dates={dates}
          today={today}
          availabilityByDate={availabilityByDate}
          plansByKey={plansByKey}
          selectedDate={selectedDate}
          onSelectDay={selectDay}
          onSetWindows={onSetWindows}
          onDragActive={onDragActive}
        />
        {anyFree || anyPlans || anyDayPrefs ? (
          <Button label="Clear week" variant="ghost" onPress={onClearWeek} />
        ) : null}

        {selectedDate ? (
          <DayPanel date={selectedDate} onClose={() => setSelectedDate(null)} />
        ) : anyFree ? (
          <Caption muted>Tap a day or any block to open, plan, and edit it.</Caption>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  signBar: {
    backgroundColor: colors.sign,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    gap: 2,
    borderBottomWidth: 3,
    borderBottomColor: colors.gold,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start' },
  signDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
  },
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
    fontSize: font.size.xl,
    letterSpacing: -0.4,
  },
  weekNav: { flexDirection: 'row', gap: spacing.xs },
  navBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navGlyph: { color: colors.onArt, fontSize: font.size.lg, lineHeight: font.size.lg + 2 },
  scroll: { padding: spacing.lg, gap: spacing.md },
  hintCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  hintLine: { color: colors.textMuted, fontSize: font.size.sm, lineHeight: 20 },
});
