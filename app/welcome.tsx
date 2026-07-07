// =============================================================================
// OutNYC: welcome (app/welcome.tsx)
// =============================================================================
// A full-bleed station sign: black field, six subway-bullet roundels spelling
// the wordmark, one caution-yellow rule. Pure welcome: no onboarding fields:
// leading into the app.
// =============================================================================

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '../lib/store';
import { colors, font, radius, spacing } from '../lib/theme';

/** The wordmark as subway line bullets: one letter per MTA line color. */
const ROUNDELS: { letter: string; bg: string; ink: string }[] = [
  { letter: 'O', bg: colors.restaurant, ink: colors.onArt },
  { letter: 'U', bg: colors.bar, ink: colors.onArt },
  { letter: 'T', bg: colors.gold, ink: colors.sign },
  { letter: 'N', bg: colors.bucket, ink: colors.onArt },
  { letter: 'Y', bg: colors.activity, ink: colors.onArt },
  { letter: 'C', bg: colors.event, ink: colors.onArt },
];

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
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <Text style={styles.eyebrow}>NEW YORK CITY</Text>

        <View style={styles.bottom}>
          <View style={styles.roundelRow} accessible accessibilityLabel="OutNYC">
            {ROUNDELS.map((r) => (
              <View key={r.letter} style={[styles.roundel, { backgroundColor: r.bg }]}>
                <Text style={[styles.roundelLetter, { color: r.ink }]} maxFontSizeMultiplier={1.2}>
                  {r.letter}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.rule} />
          <Text style={styles.tagline}>Your day out, planned.</Text>
          <Text style={styles.blurb}>
            Mark when you are free and get a walkable plan for every day of your
            week: events, restaurants, and your own bucket list, in order.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={enter}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.ctaText}>PLAN YOUR WEEK!</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.sign },
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
  bottom: { gap: spacing.md },
  roundelRow: { flexDirection: 'row', gap: spacing.sm },
  roundel: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundelLetter: {
    fontFamily: font.family.displayBlack,
    fontSize: font.size.xl,
  },
  rule: { height: 3, backgroundColor: colors.gold, marginTop: spacing.xs },
  tagline: {
    color: colors.onArt,
    fontFamily: font.family.display,
    fontSize: font.size.xxl,
    letterSpacing: -0.5,
  },
  blurb: {
    color: colors.onArtMuted,
    fontSize: font.size.md,
    lineHeight: 23,
    marginBottom: spacing.md,
  },
  cta: {
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: colors.sign,
    fontFamily: font.family.display,
    fontSize: font.size.md,
    letterSpacing: 1,
  },
});
