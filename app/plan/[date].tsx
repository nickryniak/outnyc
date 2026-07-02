// =============================================================================
// OutNYC — plan a day (app/plan/[date].tsx)
// =============================================================================
// A printed-guide layout: each free-time window gets a "sunset over Manhattan"
// skyline hero, a numbered itinerary, and lock-in. Reshuffle and swap live on
// the calendar screen, not here.
// =============================================================================

import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PlanItemCard } from '../../components/PlanItemCard';
import { Skyline } from '../../components/Skyline';
import {
  Button,
  Caption,
  EmptyView,
  ErrorView,
  LoadingView,
} from '../../components/ui';
import { planKey, useStore } from '../../lib/store';
import { colors, font, radius, spacing, timeOfDay } from '../../lib/theme';
import { format12h, formatWindow, relativeDayLabel } from '../../lib/time';
import type { Plan, PriceTier, TimeWindow } from '../../lib/types';

/** A one-line summary: stop count · span · price range. */
function planSummary(plan: Plan): string {
  const stops = plan.items.filter((i) => i.kind !== 'walk' && i.kind !== 'break');
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 'No stops';
  const tiers = stops.map((s) => s.priceTier).filter((t): t is PriceTier => t != null);
  const priceText =
    tiers.length > 0
      ? `  ·  ${'$'.repeat(Math.min(...tiers))}–${'$'.repeat(Math.max(...tiers))}`
      : '';
  const plural = stops.length === 1 ? 'stop' : 'stops';
  return `${stops.length} ${plural}  ·  ${format12h(first.startTime)}–${format12h(last.endTime)}${priceText}`;
}

export default function PlanScreen() {
  const params = useLocalSearchParams<{ date: string }>();
  const date = typeof params.date === 'string' ? params.date : '';

  const loadStatus = useStore((s) => s.loadStatus);
  const availability = useStore((s) => (date ? s.availabilityByDate[date] : undefined));

  if (loadStatus !== 'ready') return <LoadingView label="Loading…" />;
  if (!date) return <EmptyView title="Unknown day" message="No date was provided." />;

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
      {windows.map((w) => (
        <WindowPlan key={`${w.start}-${w.end}`} date={date} window={w} />
      ))}
      <Caption muted>To change a plan, use Reshuffle or Swap on the calendar.</Caption>
    </ScrollView>
  );
}

function WindowPlan({ date, window }: { date: string; window: TimeWindow }) {
  const key = planKey(date, window);
  const plan = useStore((s) => s.plansByKey[key]);
  const planning = useStore((s) => s.planning[key]);
  const locked = useStore((s) => (plan ? !!s.lockedPlanIds[plan.id] : false));

  const generatePlan = useStore((s) => s.generatePlan);
  const lockInPlan = useStore((s) => s.lockInPlan);
  const unlockPlan = useStore((s) => s.unlockPlan);

  const [lockMsg, setLockMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!plan && (!planning || planning.status === 'idle')) void generatePlan(date, window);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const isPlanning = planning?.status === 'planning';

  async function onLock(planId: string) {
    const res = await lockInPlan(planId);
    if (res.reason === 'ok') {
      setLockMsg(`Locked in. ${res.scheduled} reminder${res.scheduled === 1 ? '' : 's'} set.`);
    } else if (res.reason === 'permission-denied') {
      setLockMsg('Notifications are off. Turn them on in your phone settings to get nudges.');
    } else {
      setLockMsg('Nothing to remind you about. Every stop starts too soon or has passed.');
    }
  }

  // Number the real stops by their position among non-connectors (walks and
  // breaks are unnumbered), instead of mutating a counter mid-render.
  const stops = plan?.items.filter((i) => i.kind !== 'walk' && i.kind !== 'break') ?? [];

  return (
    <View style={styles.windowBlock}>
      {/* Skyline hero */}
      <View style={styles.hero}>
        <Skyline variant={timeOfDay(window.start)} height={186} />
        <LinearGradient
          colors={['transparent', 'rgba(18,14,10,0.15)', 'rgba(18,14,10,0.78)']}
          style={styles.heroScrim}
        />
        <View style={styles.heroText}>
          <Text style={styles.heroEyebrow}>{relativeDayLabel(date).toUpperCase()}</Text>
          <Text style={styles.heroTitle}>{formatWindow(window)}</Text>
        </View>
      </View>

      {plan && plan.items.length > 0 ? (
        <Text style={styles.summary}>{planSummary(plan)}</Text>
      ) : null}

      {isPlanning ? (
        <View style={styles.loadingBox}>
          <LoadingView label="Packing your day…" />
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
          {plan.items.map((item) => {
            const idx = stops.indexOf(item);
            return (
              <PlanItemCard
                key={`${item.order}-${item.id}`}
                item={item}
                stopNumber={idx === -1 ? undefined : idx + 1}
              />
            );
          })}
        </View>
      )}

      {plan ? (
        <View style={styles.controls}>
          {plan.items.length > 0 ? (
            <Button
              label={locked ? 'Reschedule reminders' : 'Lock in and remind me'}
              variant={locked ? 'secondary' : 'primary'}
              disabled={isPlanning}
              onPress={() => void onLock(plan.id)}
            />
          ) : null}
          {locked ? (
            <Button
              label="Cancel reminders"
              variant="ghost"
              onPress={() => {
                setLockMsg('Reminders cancelled.');
                void unlockPlan(plan.id);
              }}
            />
          ) : null}
          {lockMsg ? <Caption muted>{lockMsg}</Caption> : null}
          {locked && !lockMsg ? (
            <Caption muted>We&apos;ll nudge you ~20 min before each stop.</Caption>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  windowBlock: {
    gap: spacing.lg,
  },
  hero: {
    height: 186,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  heroText: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
  },
  heroEyebrow: {
    color: colors.onArtMuted,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    letterSpacing: 2,
    marginBottom: 2,
  },
  heroTitle: {
    color: colors.onArt,
    fontFamily: font.family.display,
    fontSize: font.size.heroSm,
    letterSpacing: -0.6,
    lineHeight: font.size.heroSm + 4,
  },
  summary: {
    color: colors.textMuted,
    fontSize: font.size.sm,
    letterSpacing: 0.3,
    marginTop: -spacing.sm,
  },
  itinerary: {
    gap: 0,
  },
  loadingBox: {
    height: 160,
  },
  controls: {
    gap: spacing.md,
  },
});
