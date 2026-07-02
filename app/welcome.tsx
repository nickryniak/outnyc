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
import { colors, font, sky, spacing } from '../lib/theme';

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const markEntered = useStore((s) => s.markEntered);

  function enter() {
    // Straight into the calendar. No setup gate; preferences live per day.
    void markEntered();
    // Reached from inside the app (the header home button)? Pop back to exactly
    // where the user was. On first launch there's nothing behind us, so replace.
    if (router.canGoBack()) router.back();
    else router.replace('/week');
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
          <Text style={styles.tagline}>Your day out, planned.</Text>
          <Text style={styles.blurb}>
            Mark when you are free and get a walkable plan for every day of your
            week: events, restaurants, and your own bucket list, in order.
          </Text>
          {/* Revisited from inside the app, the CTA pops back to WHEREVER
              pushed it (week header or Settings' "View intro"), so the label
              must not promise a specific destination. */}
          <Button
            label={router.canGoBack() ? 'Done' : 'Start planning'}
            onPress={enter}
            style={styles.cta}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: sky.evening.building },
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
    fontSize: font.size.wordmark,
    letterSpacing: -1.5,
    lineHeight: font.size.wordmark + 2,
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
