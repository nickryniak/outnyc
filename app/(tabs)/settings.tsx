// =============================================================================
// OutNYC — settings (app/(tabs)/settings.tsx)
// =============================================================================
// Shows profile defaults, which API keys are detected (provider flags), a
// notification permission action, and a "reset app" maintenance action.
// =============================================================================

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import {
  Body,
  Button,
  Caption,
  Card,
  Heading,
  LoadingView,
} from '../../components/ui';
import { PROVIDER_FLAG_LIST, anyLive } from '../../lib/config';
import { ensureNotificationPermission } from '../../lib/notifications';
import { useStore } from '../../lib/store';
import { colors, radius, spacing } from '../../lib/theme';

export default function SettingsScreen() {
  const router = useRouter();
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
        ? 'Notifications are enabled. Lock in a plan to get nudges.'
        : 'Notifications are off. Enable them in iOS Settings to get nudges.',
    );
  }

  function onReset() {
    Alert.alert(
      'Reset OutNYC?',
      'This clears your profile, availability, bucket list, and plans on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetApp();
            router.replace('/');
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <Heading>Your defaults</Heading>
        <Body muted>Party of {profile.partySize}</Body>
        <Body muted>
          {profile.defaultNeighborhoods.join(', ') || 'No neighborhoods set'}
        </Body>
        {profile.homeBase ? <Body muted>Home base: {profile.homeBase}</Body> : null}
        <Body muted>
          Price {'$'.repeat(profile.priceRange.min)} – {'$'.repeat(profile.priceRange.max)}
        </Body>
        <Body muted>{profile.interests.join(', ') || 'No interests set'}</Body>
        <Button
          label="Edit preferences"
          variant="secondary"
          onPress={() => router.push({ pathname: '/onboarding', params: { edit: '1' } })}
          style={styles.spaced}
        />
      </Card>

      <Card>
        <Heading>Data sources</Heading>
        <Caption muted>
          {anyLive
            ? 'Some live providers are configured.'
            : 'Running on mock/seed data. Add keys to a local .env to go live (see .env.example).'}
        </Caption>
        <View style={styles.flagList}>
          {PROVIDER_FLAG_LIST.map((flag) => (
            <View key={flag.name} style={styles.flagRow}>
              <Body>{flag.name}</Body>
              <View
                style={[
                  styles.badge,
                  flag.isLive ? styles.badgeLive : styles.badgeMock,
                ]}
              >
                <Caption>{flag.isLive ? 'Live' : 'Mock'}</Caption>
              </View>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <Heading>Notifications</Heading>
        <Caption muted>
          Local-only reminders before each stop when you lock in a plan. No
          accounts, no push servers.
        </Caption>
        <Button
          label="Enable notifications"
          variant="secondary"
          onPress={onEnableNotifications}
          style={styles.spaced}
        />
        {notifyMsg ? <Caption muted>{notifyMsg}</Caption> : null}
      </Card>

      <Card>
        <Heading>Maintenance</Heading>
        <Caption muted>Clear all on-device data and start fresh.</Caption>
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
  flagList: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  flagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeLive: {
    backgroundColor: colors.secondarySoft,
    borderColor: colors.success,
  },
  badgeMock: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
});
