// =============================================================================
// OutNYC — shared UI primitives (components/ui.tsx)
// =============================================================================
// Subway wayfinding: Inter grotesk throughout, black-sign primary buttons,
// hairline rules. No hardcoded hex — all tokens come from lib/theme.
// =============================================================================

import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { colors, font, radius, spacing } from '../lib/theme';

// ---- Text ------------------------------------------------------------------

export function Title({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Heading({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.heading, style]}>{children}</Text>;
}

/** Small uppercase kicker above a heading — the editorial "eyebrow". */
export function Eyebrow({ children, tone }: { children: ReactNode; tone?: 'accent' | 'muted' }) {
  return (
    <Text style={[styles.eyebrow, tone === 'accent' && { color: colors.accent }]}>{children}</Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.textMuted]}>{children}</Text>;
}

export function Caption({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.caption, muted && styles.textMuted]}>{children}</Text>;
}

/** A thin warm hairline, optionally with a centered label. */
export function Rule({ label }: { label?: string }) {
  if (!label) return <View style={styles.rule} />;
  return (
    <View style={styles.ruleRow}>
      <View style={styles.ruleLine} />
      <Text style={styles.ruleLabel}>{label}</Text>
      <View style={styles.ruleLine} />
    </View>
  );
}

// ---- Button ----------------------------------------------------------------

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        // A disabled button reads as a neutral, inert control rather than a
        // faded-out version of the accent (which looked broken).
        isDisabled && styles.btnDisabled,
        pressed && !isDisabled && styles.btnPressed,
        style,
        isDisabled && styles.btnDisabledOverride,
      ]}
    >
      {loading ? (
        // A loading button always wears the disabled surfaceAlt fill (the
        // override wins over the variant), so the spinner must be ink-toned —
        // a white spinner would vanish on the pale panel.
        <ActivityIndicator color={variant === 'primary' ? colors.textFaint : colors.accent} />
      ) : (
        <Text
          style={[
            styles.btnLabel,
            variant === 'primary' && styles.btnLabelPrimary,
            variant === 'ghost' && styles.btnLabelGhost,
            isDisabled && styles.btnLabelDisabled,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ---- Pill / Chip -----------------------------------------------------------

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

// ---- Card ------------------------------------------------------------------

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ---- State views -----------------------------------------------------------

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.stateView}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Caption muted>{label}</Caption>
    </View>
  );
}

export function EmptyView({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.stateView}>
      <Heading>{title}</Heading>
      {message ? <Body muted>{message}</Body> : null}
      {action}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.stateView}>
      <Heading>Something went wrong</Heading>
      <Body muted>{message}</Body>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontFamily: font.family.display,
    fontSize: font.size.display,
    letterSpacing: -0.5,
    lineHeight: font.size.display + 4,
  },
  heading: {
    color: colors.text,
    fontFamily: font.family.heading,
    fontSize: font.size.xl,
    letterSpacing: -0.2,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  body: {
    color: colors.text,
    fontSize: font.size.md,
    lineHeight: 23,
  },
  textMuted: {
    color: colors.textMuted,
  },
  caption: {
    color: colors.text,
    fontSize: font.size.sm,
    lineHeight: 19,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  ruleLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  ruleLabel: {
    color: colors.textFaint,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  btn: {
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Primary actions are black signs with white type.
  btnPrimary: {
    backgroundColor: colors.sign,
  },
  btnSecondary: {
    backgroundColor: colors.transparent,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  btnGhost: {
    backgroundColor: colors.transparent,
  },
  btnDisabled: {
    opacity: 1,
  },
  // Applied last so it wins over the variant fill/border.
  btnDisabledOverride: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 0,
  },
  btnLabelDisabled: {
    color: colors.textFaint,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnLabel: {
    color: colors.text,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    letterSpacing: 0.2,
  },
  btnLabelPrimary: {
    color: colors.onArt,
  },
  btnLabelGhost: {
    color: colors.accent,
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
  },
  chipLabelSelected: {
    color: colors.accent,
    fontWeight: font.weight.semibold,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  stateView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
});
