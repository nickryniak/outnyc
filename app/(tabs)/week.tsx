// =============================================================================
// OutNYC — week view (app/(tabs)/week.tsx)
// =============================================================================
// The next 7 days (America/New_York local). Each day shows its availability
// summary and routes to availability editing or the generated plan.
// =============================================================================

import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Caption, EmptyView, Heading, LoadingView } from '../../components/ui';
import { useStore } from '../../lib/store';
import { colors, radius, spacing } from '../../lib/theme';
import {
  formatWindow,
  monthDayLabel,
  nextDaysNY,
  relativeDayLabel,
} from '../../lib/time';
import type { Availability } from '../../lib/types';

export default function WeekScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loadStatus = useStore((s) => s.loadStatus);
  const availabilityByDate = useStore((s) => s.availabilityByDate);
  const plansByKey = useStore((s) => s.plansByKey);

  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return <LoadingView label="Loading your week…" />;
  }

  const days = nextDaysNY(7);
  const plannedDates = new Set(
    Object.values(plansByKey)
      .filter((p) => p.items.length > 0)
      .map((p) => p.date),
  );

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
      data={days}
      keyExtractor={(d) => d}
      ListHeaderComponent={
        <Caption muted>
          Tap a day to set free-time windows, then plan it.
        </Caption>
      }
      ListEmptyComponent={
        <EmptyView title="No days to show" message="Try again later." />
      }
      renderItem={({ item: date }) => {
        const availability: Availability | undefined = availabilityByDate[date];
        const windowCount = availability?.windows.length ?? 0;
        const hasWindows = windowCount > 0;
        const isPlanned = plannedDates.has(date);

        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${relativeDayLabel(date)}, ${
              hasWindows ? `${windowCount} free-time window${windowCount === 1 ? '' : 's'}` : 'no free time set'
            }`}
            onPress={() => router.push({ pathname: '/day/[date]', params: { date } })}
            style={({ pressed }) => [styles.dayCard, pressed && styles.pressed]}
          >
            <View style={styles.dayHeader}>
              <View style={styles.dayTitle}>
                <Heading>{relativeDayLabel(date)}</Heading>
                <Caption muted>{monthDayLabel(date)}</Caption>
                {isPlanned ? (
                  <View style={styles.plannedTag}>
                    <Caption>Planned ✓</Caption>
                  </View>
                ) : null}
              </View>
              {hasWindows ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Plan ${relativeDayLabel(date)}`}
                  onPress={() => router.push({ pathname: '/plan/[date]', params: { date } })}
                  style={({ pressed }) => [styles.planBtn, pressed && styles.pressed]}
                >
                  <Caption>Plan →</Caption>
                </Pressable>
              ) : (
                <View style={styles.addBtn}>
                  <Caption>Set free time →</Caption>
                </View>
              )}
            </View>

            {hasWindows ? (
              <View style={styles.windowList}>
                {availability!.windows.map((w, i) => (
                  <Body key={`${w.start}-${w.end}-${i}`} muted>
                    {formatWindow(w)}
                  </Body>
                ))}
              </View>
            ) : (
              <Caption muted>No free-time windows yet.</Caption>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  dayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayTitle: {
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  plannedTag: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.secondarySoft,
    borderWidth: 1,
    borderColor: colors.success,
  },
  planBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  addBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  windowList: {
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.8,
  },
});
