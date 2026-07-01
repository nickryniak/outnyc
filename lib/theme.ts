// =============================================================================
// OutNYC — design tokens (lib/theme.ts)
// =============================================================================
// "Editorial & warm" — a printed NYC nightlife-zine look: cream paper, charcoal
// ink, a Fraunces serif display face, warm terracotta/ochre accents, and
// time-of-day sky gradients for the illustrated skyline art. No hardcoded hex
// in screens — import { colors, font, ... } and use these tokens.
// =============================================================================

export const colors = {
  // Warm paper surfaces.
  bg: '#F4EEE1', // cream paper
  surface: '#FBF7EC', // lighter card paper
  surfaceAlt: '#EDE4D1', // tan panel
  border: '#E0D4BC', // warm hairline
  borderStrong: '#CBB99B',

  // Ink.
  text: '#211C17', // warm charcoal ink
  textMuted: '#6A5F51', // warm brown-gray
  textFaint: '#9C9082',

  // Warm editorial accents.
  accent: '#BE3B24', // deep terracotta / vermilion
  accentSoft: '#F1DDCF', // soft terracotta wash
  secondary: '#1E6F5C', // deep teal-green
  secondarySoft: '#D9E9E1',
  gold: '#B07A22', // ochre / brass
  goldSoft: '#F0E3C6',

  // Semantic (kept warm).
  success: '#2E7D5B',
  warning: '#B07A22',
  danger: '#B23A2E',

  // Per-kind tints for plan items (warm, editorial).
  event: '#7A4FA3', // plum
  restaurant: '#BE3B24', // terracotta
  bar: '#B07A22', // brass
  activity: '#1E6F5C', // teal
  bucket: '#2E7D5B', // green
  walk: '#9C9082', // faint
  break: '#B4A98F',

  // Ink used on top of colored/photo art.
  onArt: '#FBF7EC',
  onArtMuted: '#E8DCC6',

  // Misc.
  overlay: 'rgba(20,16,12,0.55)',
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
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const font = {
  // Fraunces serif display faces (loaded in app/_layout.tsx). Body/UI text uses
  // the system sans for contrast — that pairing is the editorial look.
  family: {
    display: 'Fraunces_700Bold',
    displayBlack: 'Fraunces_900Black',
    heading: 'Fraunces_600SemiBold',
    serif: 'Fraunces_400Regular',
    serifItalic: 'Fraunces_400Regular_Italic',
  },
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    display: 36,
    hero: 44,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

// ---- Illustrated NYC skyline — time-of-day palettes -------------------------

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** Pick a sky mood from an 'HH:MM' window start. */
export function timeOfDay(hhmm: string): TimeOfDay {
  const h = parseInt(hhmm.slice(0, 2), 10) || 0;
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 16) return 'afternoon';
  if (h >= 16 && h < 20) return 'evening';
  return 'night';
}

/** Gradient sky stops (top -> horizon) + building + accent tones per mood. */
export const sky: Record<
  TimeOfDay,
  { top: string; mid: string; horizon: string; building: string; buildingFar: string; sun: string; ink: string }
> = {
  morning: {
    top: '#8FB4D0',
    mid: '#CFD9D6',
    horizon: '#F3D9B0',
    building: '#3B3A42',
    buildingFar: '#6E7486',
    sun: '#F7E4A8',
    ink: '#FBF7EC',
  },
  afternoon: {
    top: '#6FA8D6',
    mid: '#AECBE0',
    horizon: '#EFE3BD',
    building: '#37404A',
    buildingFar: '#6C7E90',
    sun: '#FBEFC0',
    ink: '#FBF7EC',
  },
  evening: {
    top: '#4A356E',
    mid: '#B85A63',
    horizon: '#F0A85E',
    building: '#241C2B',
    buildingFar: '#5A3F63',
    sun: '#F6C877',
    ink: '#FBF7EC',
  },
  night: {
    top: '#0F1B34',
    mid: '#2A2447',
    horizon: '#7A3E58',
    building: '#0B1220',
    buildingFar: '#25203A',
    sun: '#EBD9A0',
    ink: '#FBF7EC',
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

export const theme = { colors, spacing, radius, font, sky } as const;
