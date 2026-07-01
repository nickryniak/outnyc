// =============================================================================
// OutNYC — onboarding (app/onboarding.tsx)
// =============================================================================
// Sets party size, neighborhoods, price range, and interests, then completes
// onboarding and routes to the week view. Works fully on mock data.
// =============================================================================

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Caption, Chip, Heading, Title } from '../components/ui';
import { INTEREST_TAGS, NEIGHBORHOODS } from '../lib/constants';
import { useStore } from '../lib/store';
import { colors, radius, spacing } from '../lib/theme';
import type { PriceTier } from '../lib/types';

const PRICE_TIERS: PriceTier[] = [1, 2, 3, 4];

export default function Onboarding() {
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string }>();
  const isEdit = params.edit === '1';
  const insets = useSafeAreaInsets();
  const profile = useStore((s) => s.profile);
  const completeOnboarding = useStore((s) => s.completeOnboarding);

  const [partySize, setPartySize] = useState(profile?.partySize ?? 2);
  const [neighborhoods, setNeighborhoods] = useState<string[]>(
    profile?.defaultNeighborhoods ?? [],
  );
  const [interests, setInterests] = useState<string[]>(profile?.interests ?? []);
  const [priceMin, setPriceMin] = useState<PriceTier>(profile?.priceRange.min ?? 1);
  const [priceMax, setPriceMax] = useState<PriceTier>(profile?.priceRange.max ?? 3);
  const [saving, setSaving] = useState(false);

  const canContinue = neighborhoods.length > 0;

  const priceRange = useMemo(() => {
    const min = Math.min(priceMin, priceMax) as PriceTier;
    const max = Math.max(priceMin, priceMax) as PriceTier;
    return { min, max };
  }, [priceMin, priceMax]);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  // Leaving edit mode: pop back if possible, else fall back to Settings so the
  // user can never get stranded (e.g. if this screen is the top of the stack).
  function exitEdit() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  async function onContinue() {
    if (!canContinue) return;
    setSaving(true);
    try {
      await completeOnboarding({
        displayName: profile?.displayName ?? 'You',
        partySize,
        defaultNeighborhoods: neighborhoods,
        priceRange,
        interests,
        homeBase: neighborhoods.includes(profile?.homeBase ?? '')
          ? profile?.homeBase
          : neighborhoods[0],
      });
      if (isEdit) exitEdit();
      else router.replace('/week');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Title>{isEdit ? 'Edit preferences' : 'OutNYC'}</Title>
        <Body muted>
          {isEdit
            ? 'Update your defaults. These bias every plan the app makes.'
            : 'Tell us how you like to go out. You can change all of this later in Settings — and everything works with no accounts and no API keys.'}
        </Body>

        <Heading>Party size</Heading>
        <View style={styles.stepperRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPartySize((n) => Math.max(1, n - 1))}
            style={styles.stepBtn}
          >
            <Body>−</Body>
          </Pressable>
          <View style={styles.stepValue}>
            <Heading>{partySize}</Heading>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPartySize((n) => Math.min(20, n + 1))}
            style={styles.stepBtn}
          >
            <Body>+</Body>
          </Pressable>
        </View>

        <Heading>Neighborhoods</Heading>
        <Caption muted>Pick at least one.</Caption>
        <View style={styles.wrap}>
          {NEIGHBORHOODS.map((n) => (
            <Chip
              key={n}
              label={n}
              selected={neighborhoods.includes(n)}
              onPress={() => setNeighborhoods((cur) => toggle(cur, n))}
            />
          ))}
        </View>

        <Heading>Price range</Heading>
        <View style={styles.wrap}>
          {PRICE_TIERS.map((t) => {
            const inRange = t >= priceRange.min && t <= priceRange.max;
            return (
              <Chip
                key={t}
                label={'$'.repeat(t)}
                selected={inRange}
                onPress={() => {
                  // Tapping sets the nearer bound to t.
                  if (Math.abs(t - priceMin) <= Math.abs(t - priceMax)) setPriceMin(t);
                  else setPriceMax(t);
                }}
              />
            );
          })}
        </View>
        <Caption muted>
          {'$'.repeat(priceRange.min)} – {'$'.repeat(priceRange.max)}
        </Caption>

        <Heading>Interests</Heading>
        <View style={styles.wrap}>
          {INTEREST_TAGS.map((t) => (
            <Chip
              key={t}
              label={t}
              selected={interests.includes(t)}
              onPress={() => setInterests((cur) => toggle(cur, t))}
            />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label={
            canContinue
              ? isEdit
                ? 'Save changes'
                : 'Start planning'
              : 'Pick a neighborhood'
          }
          onPress={onContinue}
          disabled={!canContinue}
          loading={saving}
        />
        {isEdit ? (
          <Button
            label="Cancel"
            variant="ghost"
            onPress={exitEdit}
            style={styles.cancelBtn}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
  },
  scroll: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 48,
    alignItems: 'center',
  },
  footer: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  cancelBtn: {
    marginTop: 0,
  },
});
