// =============================================================================
// OutNYC — settings (app/(tabs)/settings.tsx)
// =============================================================================
// Default preferences, a clear "where your picks come from" section, the
// notification permission action, and reset. Copy stays user-friendly: no
// technical jargon on this screen.
// =============================================================================

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body,
  Button,
  Caption,
  Card,
  Heading,
  LoadingView,
} from '../../components/ui';
import { providerFlags } from '../../lib/config';
import { confirmDestructive } from '../../lib/confirm';
import { ensureNotificationPermission } from '../../lib/notifications';
import { useStore } from '../../lib/store';
import { colors, font, radius, spacing } from '../../lib/theme';

type SourceStatus = 'On' | 'Coming soon' | 'Planned';

/** Where picks come from, in plain language. Statuses flip on as feeds go live. */
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
    detail: 'Real listings with dates and ticket links.',
    status: providerFlags.events.isLive ? 'On' : 'Coming soon',
  },
  {
    name: 'Live restaurant and bar listings',
    detail: 'Fresh spots with hours, photos, and reviews.',
    status: providerFlags.places.isLive ? 'On' : 'Coming soon',
  },
  {
    name: 'Pop-ups and one-off happenings',
    detail: 'Flash events, markets, and openings that are not regular venues.',
    status: 'Planned',
  },
  {
    name: 'Community boards and groups',
    detail: 'Neighborhood happenings sourced from local groups and boards.',
    status: 'Planned',
  },
];

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const loadStatus = useStore((s) => s.loadStatus);
  const profile = useStore((s) => s.profile);
  const resetApp = useStore((s) => s.resetApp);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);

  if (loadStatus !== 'ready' || !profile) {
    return <LoadingView label="Loading settings…" />;
  }

  async function onEnableNotifications() {
    const granted = await ensureNotificationPermission();
    setNotifyMsg(
      granted
        ? 'Reminders are on. Lock in a plan to get a nudge before each stop.'
        : 'Reminders are off. Turn them on in your phone settings to get nudges.',
    );
  }

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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + spacing.xxl },
      ]}
    >
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
                    : src.status === 'Coming soon'
                      ? styles.badgeSoon
                      : styles.badgePlanned,
                ]}
              >
                <Caption>{src.status}</Caption>
              </View>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <Heading>Reminders</Heading>
        <Caption muted>
          Get a nudge before each stop when you lock in a plan. Everything stays
          on your phone.
        </Caption>
        <Button
          label="Turn on reminders"
          variant="secondary"
          onPress={onEnableNotifications}
          style={styles.spaced}
        />
        {notifyMsg ? <Caption muted>{notifyMsg}</Caption> : null}
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
  badgeSoon: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.gold,
  },
  badgePlanned: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
});
