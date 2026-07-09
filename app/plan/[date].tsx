// =============================================================================
// OutNYC: plan a day (app/plan/[date].tsx)
// =============================================================================
// A city-guide layout: each free-time window gets a skyline hero and a
// numbered itinerary. Reshuffle and swap live on the calendar screen, not here.
// =============================================================================

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PlanItemCard } from '../../components/PlanItemCard';
import {
  Button,
  Caption,
  EmptyView,
  ErrorView,
  LoadingView,
} from '../../components/ui';
import { planKey, useStore } from '../../lib/store';
import { colors, font, radius, spacing } from '../../lib/theme';
import { format12h, formatWindow, isValidYmd, relativeDayLabel } from '../../lib/time';
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

/**
 * "Back to your week" for a screen with no back stack. A home-screen web app
 * bookmarked on this route (Add to Home Screen while viewing a plan) launches
 * straight here every time, with no browser chrome and no synthesized history:
 * without this the day plan is a dead end.
 */
function BackToWeek() {
  const router = useRouter();
  if (router.canGoBack()) return null;
  return <Button label="Back to your week" variant="secondary" onPress={() => router.replace('/week')} />;
}

export default function PlanScreen() {
  const params = useLocalSearchParams<{ date: string }>();
  const raw = typeof params.date === 'string' ? params.date : '';
  // The static web export serves this route for ANY path segment, so the param
  // is untrusted input: a truncated bookmark or mistyped URL must land on the
  // empty state, never in Intl's date formatter (which throws a RangeError on
  // an invalid date and takes the whole screen down).
  const date = isValidYmd(raw) ? raw : '';

  const loadStatus = useStore((s) => s.loadStatus);
  const availability = useStore((s) => (date ? s.availabilityByDate[date] : undefined));

  if (loadStatus !== 'ready') return <LoadingView label="Loading…" />;
  if (!date) {
    return (
      <EmptyView
        title="Unknown day"
        message={raw ? `“${raw}” is not a date we recognize.` : 'No date was provided.'}
        action={<BackToWeek />}
      />
    );
  }

  const windows = availability?.windows ?? [];
  if (windows.length === 0) {
    return (
      <EmptyView
        title="No free time set"
        message={`Add a free-time window for ${relativeDayLabel(date)} first, then come back to plan it.`}
        action={<BackToWeek />}
      />
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {windows.map((w) => (
        <WindowPlan key={`${w.start}-${w.end}`} date={date} window={w} />
      ))}
      <Caption muted>To change a plan, use Reshuffle or Swap on the calendar.</Caption>
      <BackToWeek />
    </ScrollView>
  );
}

function WindowPlan({ date, window }: { date: string; window: TimeWindow }) {
  const key = planKey(date, window);
  const plan = useStore((s) => s.plansByKey[key]);
  const planning = useStore((s) => s.planning[key]);

  const generatePlan = useStore((s) => s.generatePlan);

  useEffect(() => {
    if (!plan && (!planning || planning.status === 'idle')) void generatePlan(date, window);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A not-yet-planned, not-errored window is LOADING (the mount effect is
  // about to plan it): never "Nothing fit this window" on first paint.
  const isPlanning =
    planning?.status === 'planning' || (!plan && planning?.status !== 'error');

  // Number the real stops by their position among non-connectors (walks and
  // breaks are unnumbered), instead of mutating a counter mid-render.
  const stops = plan?.items.filter((i) => i.kind !== 'walk' && i.kind !== 'break') ?? [];

  return (
    <View style={styles.windowBlock}>
      {/* Station-sign hero */}
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>{relativeDayLabel(date).toUpperCase()}</Text>
        <Text style={styles.heroTitle}>{formatWindow(window)}</Text>
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
      ) : !plan || plan.items.length === 0 ? (
        <EmptyView
          title="Nothing fit this window"
          message="Try a longer window, a wider price range, or different neighborhoods."
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
    backgroundColor: colors.sign,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'flex-end',
    borderBottomWidth: 3,
    borderBottomColor: colors.gold,
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
});
