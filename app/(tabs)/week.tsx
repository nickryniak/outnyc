// =============================================================================
// OutNYC — weekly calendar home (app/(tabs)/week.tsx)
// =============================================================================
// The app IS this screen. A Mon-Sun calendar: paint or drag your free time,
// plan blocks tile inside the green windows once generated, tap a day (or any
// block) to expand it in place. One reshuffle control per scope: the week
// button here, the day button in the panel, the swap control per block.
// =============================================================================

import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayPanel } from '../../components/DayPanel';
import { Skyline } from '../../components/Skyline';
import { WeekGrid } from '../../components/WeekGrid';
import { Button, Caption, LoadingView } from '../../components/ui';
import { useStore } from '../../lib/store';
import { colors, font, radius, spacing } from '../../lib/theme';
import { addDays, mondayOf, todayNY, weekDates, weekRangeLabel } from '../../lib/time';

export default function WeekScreen() {
  const insets = useSafeAreaInsets();
  const loadStatus = useStore((s) => s.loadStatus);
  const availabilityByDate = useStore((s) => s.availabilityByDate);
  const plansByKey = useStore((s) => s.plansByKey);
  const setAvailability = useStore((s) => s.setAvailability);
  const planWeek = useStore((s) => s.planWeek);

  const [weekOffset, setWeekOffset] = useState(0);
  const [busy, setBusy] = useState(false);
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

  async function onPlanWeek() {
    setBusy(true);
    try {
      await planWeek(dates);
    } finally {
      setBusy(false);
    }
  }

  function selectDay(date: string) {
    setSelectedDate(date);
    // Bring the panel into view.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  return (
    <View style={styles.container}>
      {/* Header with subtle skyline */}
      <View style={[styles.header, { height: 88 + insets.top }]}>
        <Skyline variant="evening" height={88 + insets.top} />
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
                onPress={() => {
                  setWeekOffset((o) => o - 1);
                  setSelectedDate(null);
                }}
                style={styles.navBtn}
              >
                <Text style={styles.navGlyph}>‹</Text>
              </Pressable>
              <Pressable
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
          Tap the hours you are free, or drag a block by its edges. Long-press removes it.
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

        <Button
          label={anyPlans ? 'Reshuffle week' : 'Plan my week'}
          onPress={() => void onPlanWeek()}
          loading={busy}
          disabled={!anyFree}
        />
        {!anyFree ? (
          <Caption muted>Mark some free time first, then plan the week in one tap.</Caption>
        ) : null}

        {selectedDate ? (
          <DayPanel date={selectedDate} onClose={() => setSelectedDate(null)} />
        ) : anyFree ? (
          <Caption muted>Tap a day or any block to see and edit its plan.</Caption>
        ) : null}
      </ScrollView>
    </View>
  );
}

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
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(251,247,236,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navGlyph: { color: colors.onArt, fontSize: font.size.lg, lineHeight: font.size.lg + 2 },
  scroll: { padding: spacing.lg, gap: spacing.md },
});
