// =============================================================================
// OutNYC — weekly calendar home (app/(tabs)/week.tsx)
// =============================================================================
// The app IS this screen. A Mon-Sun calendar: paint or drag your free time,
// plan blocks tile inside the green windows once generated, tap a day (or any
// block) to expand it in place. Planning is per day: the panel's Plan/Reshuffle
// buttons and the per-block Swap. The only week-scope action is Clear week.
// =============================================================================

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Home } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayPanel } from '../../components/DayPanel';
import { Skyline } from '../../components/Skyline';
import { WeekGrid } from '../../components/WeekGrid';
import { Button, Caption, LoadingView } from '../../components/ui';
import { confirmDestructive } from '../../lib/confirm';
import { useStore } from '../../lib/store';
import { colors, font, radius, spacing } from '../../lib/theme';
import { addDays, mondayOf, todayNY, weekDates, weekRangeLabel } from '../../lib/time';

export default function WeekScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const loadStatus = useStore((s) => s.loadStatus);
  const availabilityByDate = useStore((s) => s.availabilityByDate);
  const plansByKey = useStore((s) => s.plansByKey);
  const dayPrefsByDate = useStore((s) => s.dayPrefsByDate);
  const setAvailability = useStore((s) => s.setAvailability);
  const clearWeek = useStore((s) => s.clearWeek);

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const today = todayNY();
  const monday = useMemo(() => mondayOf(addDays(today, weekOffset * 7)), [today, weekOffset]);
  const dates = useMemo(() => weekDates(monday), [monday]);

  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return <LoadingView label="Loading your week…" />;
  }

  const anyFree = dates.some((d) => (availabilityByDate[d]?.windows.length ?? 0) > 0);
  const anyPlans = dates.some((d) =>
    Object.values(plansByKey).some((p) => p.date === d && p.items.length > 0),
  );
  // A day-only override carries more than just its `date` key (a cleared one is
  // just `{date}`), so this detects real neighborhood/price/party picks to clear.
  const anyDayPrefs = dates.some(
    (d) => dayPrefsByDate[d] && Object.keys(dayPrefsByDate[d]).length > 1,
  );

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

  function selectDay(date: string) {
    setSelectedDate(date);
    // Bring the panel into view.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  return (
    <View style={styles.container}>
      {/* Header with subtle skyline */}
      <View style={[styles.header, { height: 62 + insets.top }]}>
        <Skyline variant="evening" height={62 + insets.top} />
        <LinearGradient
          colors={['rgba(18,14,10,0.1)', 'rgba(18,14,10,0.55)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.headerText, { top: insets.top + 4 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the welcome screen"
            onPress={() => router.push('/welcome')}
            hitSlop={10}
            style={styles.brandRow}
          >
            <Home size={12} color={colors.onArtMuted} strokeWidth={2.4} />
            <Text style={styles.headerEyebrow}>OUTNYC · HOME</Text>
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
        <Caption muted>
          Tap an hour to add free time, or drag down a day to paint a range. Tap
          the neighborhood tag under a day to change where it happens.
        </Caption>

        <WeekGrid
          dates={dates}
          today={today}
          availabilityByDate={availabilityByDate}
          plansByKey={plansByKey}
          selectedDate={selectedDate}
          onSelectDay={selectDay}
          onSetWindows={(date, windows) => void setAvailability(date, windows)}
          onDragActive={(active) => setScrollEnabled(!active)}
        />

        {!anyFree && !anyPlans ? (
          <Caption muted>
            Mark some free time, then tap the day to plan it.
          </Caption>
        ) : null}
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
  header: { overflow: 'hidden' },
  headerText: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
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
    backgroundColor: 'rgba(251,247,236,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navGlyph: { color: colors.onArt, fontSize: font.size.lg, lineHeight: font.size.lg + 2 },
  scroll: { padding: spacing.lg, gap: spacing.md },
});
