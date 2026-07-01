// =============================================================================
// OutNYC — design tokens (lib/theme.ts)
// =============================================================================
// No hardcoded hex in screens. Import { theme } and use these tokens.
// =============================================================================

export const colors = {
  // Surfaces — a warm-dark "night out" palette.
  bg: '#0B0B0F',
  surface: '#15151D',
  surfaceAlt: '#1E1E29',
  border: '#2A2A38',

  // Text.
  text: '#F4F2EC',
  textMuted: '#A6A2B2',
  textFaint: '#6E6A7C',

  // Brand accent (terracotta) + secondary.
  accent: '#E0613A',
  accentSoft: '#3A241C',
  secondary: '#5BC0BE',
  secondarySoft: '#16312F',

  // Semantic.
  success: '#5BD18A',
  warning: '#E8B04B',
  danger: '#E8615B',

  // Per-kind tints for plan items.
  event: '#9B7BE0',
  restaurant: '#E0613A',
  bar: '#E8B04B',
  activity: '#5BC0BE',
  bucket: '#5BD18A',
  walk: '#6E6A7C',
  break: '#4A4A5C',

  // Misc.
  overlay: 'rgba(0,0,0,0.6)',
  transparent: 'transparent',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    display: 34,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export type KindColorKey =
  | 'event'
  | 'restaurant'
  | 'bar'
  | 'activity'
  | 'bucket'
  | 'walk'
  | 'break';

/** Color for a plan-item kind. */
export function kindColor(kind: KindColorKey): string {
  return colors[kind];
}

export const theme = { colors, spacing, radius, font } as const;
