// =============================================================================
// OutNYC — welcome (app/welcome.tsx)
// =============================================================================
// A full-bleed "sunset over Manhattan" landing screen. Pure welcome — no
// onboarding fields — leading into the app.
// =============================================================================

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Skyline } from '../components/Skyline';
import { Button } from '../components/ui';
import { useStore } from '../lib/store';
import { colors, font, spacing } from '../lib/theme';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useStore((s) => s.profile);

  function enter() {
    router.replace(profile?.onboarded ? '/week' : '/onboarding');
  }

  return (
    <View style={styles.container}>
      <View style={StyleSheet.absoluteFill}>
        <Skyline variant="evening" height={900} />
      </View>
      <LinearGradient
        colors={['rgba(18,14,10,0.35)', 'rgba(18,14,10,0.1)', 'rgba(18,14,10,0.55)', 'rgba(18,14,10,0.92)']}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.eyebrow}>NEW YORK CITY</Text>

        <View style={styles.bottom}>
          <Text style={styles.wordmark}>OutNYC</Text>
          <Text style={styles.tagline}>Your night out, planned.</Text>
          <Text style={styles.blurb}>
            Events, restaurants, and your bucket list — packed into an ordered,
            walkable night across the city. No accounts, no API keys.
          </Text>
          <Button label="Start planning →" onPress={enter} style={styles.cta} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#20182a' },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colors.onArtMuted,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    letterSpacing: 3,
  },
  bottom: { gap: spacing.sm },
  wordmark: {
    color: colors.onArt,
    fontFamily: font.family.displayBlack,
    fontSize: 60,
    letterSpacing: -1.5,
    lineHeight: 62,
  },
  tagline: {
    color: colors.onArt,
    fontFamily: font.family.serifItalic,
    fontSize: font.size.xl,
    marginBottom: spacing.xs,
  },
  blurb: {
    color: colors.onArtMuted,
    fontSize: font.size.md,
    lineHeight: 23,
    marginBottom: spacing.md,
  },
  cta: {
    backgroundColor: colors.accent,
  },
});
