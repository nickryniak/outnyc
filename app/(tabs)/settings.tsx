// =============================================================================
// OutNYC: settings (app/(tabs)/settings.tsx)
// =============================================================================
// Default preferences, a clear "where your picks come from" section, and
// reset. Copy stays user-friendly: no technical jargon on this screen.
// =============================================================================

import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body,
  Button,
  Caption,
  Card,
  ErrorView,
  Heading,
  LoadingView,
  PersistenceBanner,
} from '../../components/ui';
import { providerFlags } from '../../lib/config';
import { confirmDestructive } from '../../lib/confirm';
import { useStore } from '../../lib/store';
import { colors, radius, spacing } from '../../lib/theme';

type SourceStatus = 'On' | 'Ready to turn on' | 'On the roadmap' | 'Not wired up yet';

/**
 * Where picks come from, in plain language. Each status is honest about where
 * things stand: 'Ready to turn on' feeds are built and flip On once their key
 * is set (lib/config.ts), 'On the roadmap' ones aren't built yet, and 'Not
 * wired up yet' means a key alone changes nothing: the hookup isn't finished.
 */
const DATA_SOURCES: { name: string; detail: string; status: SourceStatus }[] = [
  {
    name: 'Curated NYC guide',
    detail: 'Hand-picked venues, classics, and happenings across the city, built in.',
    status: 'On',
  },
  {
    name: 'Your bucket list',
    detail: 'Anything you add gets woven into your week when it fits.',
    status: 'On',
  },
  {
    name: 'Live concerts, shows, and tickets',
    detail: 'Ticketmaster listings with dates and ticket links.',
    status: providerFlags.events.isLive ? 'On' : 'Ready to turn on',
  },
  {
    name: 'More live events (SeatGeek)',
    detail: 'A second real ticketed-event feed: indie venues, sports, comedy.',
    status: providerFlags.seatgeek.isLive ? 'On' : 'Ready to turn on',
  },
  {
    name: 'Live restaurant and bar listings',
    detail: 'Google Places spots with real ratings, reviews, and websites.',
    status: providerFlags.places.isLive ? 'On' : 'Ready to turn on',
  },
  {
    name: 'City permitted events',
    detail: 'Real farmers markets, parades, street fairs, and plaza events.',
    status: providerFlags.nycOpenData.isLive ? 'On' : 'Ready to turn on',
  },
  {
    name: 'NYC Parks programming',
    detail: 'Real concerts, nature walks, and free events in city parks.',
    status: providerFlags.nycParks.isLive ? 'On' : 'Ready to turn on',
  },
  {
    name: 'Smarter planning (Gemini)',
    detail: providerFlags.geminiPlanner.isLive
      ? 'Your key is set, but plans still come from the built-in planner: this hookup is not finished.'
      : 'A smarter AI planner. Even with a key set, plans still come from the built-in planner for now.',
    status: 'Not wired up yet',
  },
  {
    name: 'Private smarter planning (secure server)',
    detail: providerFlags.edgePlanner.isLive
      ? 'Your server is set up, but plans still come from the built-in planner: this hookup is not finished.'
      : 'The same smarter planner, run privately off-device. Setting it up does not change your plans yet.',
    status: 'Not wired up yet',
  },
  {
    name: 'Community boards and groups',
    detail: 'Neighborhood happenings sourced from local groups and boards.',
    status: 'On the roadmap',
  },
];

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loadStatus = useStore((s) => s.loadStatus);
  const loadError = useStore((s) => s.loadError);
  const bootstrap = useStore((s) => s.bootstrap);
  const profile = useStore((s) => s.profile);
  const resetApp = useStore((s) => s.resetApp);

  function onReset() {
    confirmDestructive(
      'Start fresh?',
      'This clears your preferences, free time, bucket list, and plans on this device.',
      'Reset',
      () => {
        void (async () => {
          await resetApp();
          router.replace('/');
        })();
      },
    );
  }

  // A failed load must not spin forever here: Settings holds "Start fresh",
  // the one control that can rescue corrupt or full storage, so it stays
  // reachable alongside the retry.
  if (loadStatus === 'error') {
    return (
      <View style={styles.errorWrap}>
        <ErrorView
          message={loadError ?? 'We could not load your settings.'}
          onRetry={() => void bootstrap()}
        />
        <View style={styles.errorAction}>
          <Button label="Start fresh" variant="ghost" onPress={onReset} />
        </View>
      </View>
    );
  }
  if (loadStatus !== 'ready' || !profile) {
    return <LoadingView label="Loading settings…" />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
      <PersistenceBanner />
      <Card>
        <Heading>Your usual preferences</Heading>
        <Caption muted>
          Starting points for every day. Change any of them for a single day
          right on the calendar.
        </Caption>
        <View style={styles.spaced}>
          <Body muted>Party of {profile.partySize}</Body>
          <Body muted>
            {profile.defaultNeighborhoods.join(', ') || 'No neighborhoods set'}
          </Body>
          <Body muted>
            Price {'$'.repeat(profile.priceRange.min)} to {'$'.repeat(profile.priceRange.max)}
          </Body>
          <Body muted>{profile.interests.join(', ') || 'No interests set'}</Body>
        </View>
        <Button
          label="Edit defaults"
          variant="secondary"
          onPress={() => router.push({ pathname: '/onboarding', params: { edit: '1' } })}
          style={styles.spaced}
        />
      </Card>

      <Card>
        <Heading>Where your picks come from</Heading>
        <Caption muted>
          Every plan is built from these sources. More live feeds are on the
          way, and your plans get better as each one turns on.
        </Caption>
        <View style={styles.sourceList}>
          {DATA_SOURCES.map((src) => (
            <View key={src.name} style={styles.sourceRow}>
              <View style={styles.sourceText}>
                <Body>{src.name}</Body>
                <Caption muted>{src.detail}</Caption>
              </View>
              <View
                style={[
                  styles.badge,
                  src.status === 'On'
                    ? styles.badgeOn
                    : src.status === 'Ready to turn on'
                      ? styles.badgeReady
                      : src.status === 'Not wired up yet'
                        ? styles.badgeUnwired
                        : styles.badgeRoadmap,
                ]}
              >
                <Caption muted={src.status === 'On the roadmap'}>{src.status}</Caption>
              </View>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <Heading>Start fresh</Heading>
        <Caption muted>Clear everything on this device and begin again.</Caption>
        <Button
          label="Reset app"
          variant="ghost"
          onPress={onReset}
          style={styles.spaced}
        />
      </Card>

    </ScrollView>
  );
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
  errorWrap: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  errorAction: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  spaced: {
    marginTop: spacing.sm,
  },
  sourceList: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  sourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  sourceText: {
    flex: 1,
    gap: 2,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeOn: {
    backgroundColor: colors.secondarySoft,
    borderColor: colors.success,
  },
  badgeReady: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  badgeUnwired: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  badgeRoadmap: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
});
