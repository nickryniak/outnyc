// =============================================================================
// OutNYC — plan a day (app/plan/[date].tsx)
// =============================================================================
// For each free-time window on the date: "Plan this day" (heuristic), render the
// ordered walkable itinerary, reshuffle with a modifier (more food / more active
// / cheaper / surprise), and lock in to schedule local notifications.
// =============================================================================

import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PlanItemCard } from '../../components/PlanItemCard';
import {
  Body,
  Button,
  Caption,
  Chip,
  EmptyView,
  ErrorView,
  Heading,
  LoadingView,
} from '../../components/ui';
import { planKey, useStore } from '../../lib/store';
import { colors, radius, spacing } from '../../lib/theme';
import { formatWindow, relativeDayLabel } from '../../lib/time';
import type { PlanModifier, TimeWindow } from '../../lib/types';

const MODIFIERS: { key: PlanModifier; label: string }[] = [
  { key: 'more-food', label: 'More food' },
  { key: 'more-active', label: 'More active' },
  { key: 'cheaper', label: 'Cheaper' },
  { key: 'surprise', label: 'Surprise me' },
];

export default function PlanScreen() {
  const params = useLocalSearchParams<{ date: string }>();
  const date = typeof params.date === 'string' ? params.date : '';

  const loadStatus = useStore((s) => s.loadStatus);
  const availability = useStore((s) => (date ? s.availabilityByDate[date] : undefined));

  if (loadStatus !== 'ready') {
    return <LoadingView label="Loading…" />;
  }

  if (!date) {
    return <EmptyView title="Unknown day" message="No date was provided." />;
  }

  const windows = availability?.windows ?? [];
  if (windows.length === 0) {
    return (
      <EmptyView
        title="No free time set"
        message={`Add a free-time window for ${relativeDayLabel(date)} first, then come back to plan it.`}
      />
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Heading>{relativeDayLabel(date)}</Heading>
      <Caption muted>{date}</Caption>
      {windows.map((w) => (
        <WindowPlan key={`${w.start}-${w.end}`} date={date} window={w} />
      ))}
    </ScrollView>
  );
}

function WindowPlan({ date, window }: { date: string; window: TimeWindow }) {
  const key = planKey(date, window);
  const plan = useStore((s) => s.plansByKey[key]);
  const planning = useStore((s) => s.planning[key]);
  const locked = useStore((s) => (plan ? !!s.lockedPlanIds[plan.id] : false));

  const generatePlan = useStore((s) => s.generatePlan);
  const reshufflePlan = useStore((s) => s.reshufflePlan);
  const lockInPlan = useStore((s) => s.lockInPlan);

  // Auto-generate the first plan for this window on mount if none exists.
  useEffect(() => {
    if (!plan && (!planning || planning.status === 'idle')) {
      void generatePlan(date, window);
    }
    // We intentionally depend only on key so this fires once per window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const isPlanning = planning?.status === 'planning';

  return (
    <View style={styles.windowCard}>
      <View style={styles.windowHeader}>
        <Heading>{formatWindow(window)}</Heading>
        {plan && plan.modifier ? (
          <Caption muted>{labelForModifier(plan.modifier)}</Caption>
        ) : null}
      </View>

      {isPlanning ? (
        <View style={styles.loadingBox}>
          <LoadingView label="Packing your itinerary…" />
        </View>
      ) : planning?.status === 'error' ? (
        <ErrorView
          message={planning.error ?? 'Could not build a plan.'}
          onRetry={() => void generatePlan(date, window, plan?.modifier)}
        />
      ) : !plan ? (
        <Button label="Plan this day" onPress={() => void generatePlan(date, window)} />
      ) : plan.items.length === 0 ? (
        <EmptyView
          title="Nothing fit this window"
          message="Try a longer window, a wider price range, or a different reshuffle."
        />
      ) : (
        <View style={styles.itinerary}>
          {plan.items.map((item) => (
            <PlanItemCard key={`${item.order}-${item.id}`} item={item} />
          ))}
        </View>
      )}

      {plan ? (
        <>
          <Caption muted>Reshuffle</Caption>
          <View style={styles.modifiers}>
            {MODIFIERS.map((m) => (
              <Chip
                key={m.key}
                label={m.label}
                selected={plan.modifier === m.key}
                onPress={() => void reshufflePlan(date, window, m.key)}
              />
            ))}
          </View>

          {plan.items.length > 0 ? (
            <Button
              label={locked ? 'Locked in ✓ — re-lock' : 'Lock in & remind me'}
              variant={locked ? 'secondary' : 'primary'}
              onPress={() => void lockInPlan(plan.id)}
              style={styles.lockBtn}
            />
          ) : null}
          {locked ? (
            <Caption muted>
              We&apos;ll nudge you ~20 min before each stop (local notifications).
            </Caption>
          ) : null}
          <Caption muted>Built by the {plan.generatedBy} planner.</Caption>
          <Body muted> </Body>
        </>
      ) : null}
    </View>
  );
}

function labelForModifier(m: PlanModifier): string {
  return MODIFIERS.find((x) => x.key === m)?.label ?? m;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  windowCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  windowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itinerary: {
    gap: spacing.sm,
  },
  modifiers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  loadingBox: {
    height: 160,
  },
  lockBtn: {
    marginTop: spacing.xs,
  },
});
