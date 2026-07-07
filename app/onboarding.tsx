// =============================================================================
// OutNYC — onboarding (app/onboarding.tsx)
// =============================================================================
// Sets party size, neighborhoods, price range, and interests. Doubles as the
// "Edit preferences" screen (opened from Settings with ?edit=1).
// =============================================================================

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Caption, Chip, Eyebrow } from '../components/ui';
import { INTEREST_TAGS, NEIGHBORHOODS, PRICE_TIERS } from '../lib/constants';
import { useStore } from '../lib/store';
import { colors, font, radius, spacing } from '../lib/theme';
import type { PriceTier } from '../lib/types';

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Station-sign hero */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>{isEdit ? 'YOUR USUAL PREFERENCES' : 'NEW YORK CITY'}</Text>
          <Text style={styles.heroTitle}>{isEdit ? 'Edit your defaults' : 'OutNYC'}</Text>
        </View>

        <View style={styles.bodyPad}>
          <Body muted>
            {isEdit
              ? 'These are your starting points. You can change any of them for a single day right on the calendar.'
              : 'Set your usual preferences. You can change any of them for a single day right on the calendar.'}
          </Body>

          <Eyebrow>Party size</Eyebrow>
          <View style={styles.stepperRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease party size"
              onPress={() => setPartySize((n) => Math.max(1, n - 1))}
              style={styles.stepBtn}
            >
              <Text style={styles.stepSign}>−</Text>
            </Pressable>
            <Text style={styles.stepValue}>{partySize}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase party size"
              onPress={() => setPartySize((n) => Math.min(20, n + 1))}
              style={styles.stepBtn}
            >
              <Text style={styles.stepSign}>+</Text>
            </Pressable>
          </View>

          <Eyebrow>Neighborhoods</Eyebrow>
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

          <Eyebrow>Price range</Eyebrow>
          <View style={styles.wrap}>
            {PRICE_TIERS.map((t) => {
              const inRange = t >= priceRange.min && t <= priceRange.max;
              return (
                <Chip
                  key={t}
                  label={'$'.repeat(t)}
                  selected={inRange}
                  onPress={() => {
                    if (Math.abs(t - priceMin) <= Math.abs(t - priceMax)) setPriceMin(t);
                    else setPriceMax(t);
                  }}
                />
              );
            })}
          </View>

          <Eyebrow>Interests</Eyebrow>
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
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label={
            canContinue ? (isEdit ? 'Save changes' : 'Start planning') : 'Pick a neighborhood'
          }
          onPress={onContinue}
          disabled={!canContinue}
          loading={saving}
        />
        {isEdit ? <Button label="Cancel" variant="ghost" onPress={exitEdit} /> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    paddingBottom: spacing.xl,
  },
  hero: {
    backgroundColor: colors.sign,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 3,
    borderBottomColor: colors.gold,
  },
  heroEyebrow: {
    color: colors.onArtMuted,
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    letterSpacing: 2.5,
    marginBottom: 2,
  },
  heroTitle: {
    color: colors.onArt,
    fontFamily: font.family.display,
    fontSize: font.size.hero,
    letterSpacing: -0.8,
  },
  bodyPad: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
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
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepSign: {
    color: colors.text,
    fontSize: font.size.xl,
    fontWeight: font.weight.medium,
  },
  stepValue: {
    minWidth: 40,
    textAlign: 'center',
    color: colors.text,
    fontFamily: font.family.display,
    fontSize: font.size.xxl,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
});
