// =============================================================================
// OutNYC: design tokens (lib/theme.ts)
// =============================================================================
// "Subway wayfinding": modern-art simplicity with an industrial city edge:
// station-white canvas, black sign bars, MTA line-color roundels for stop
// kinds, one caution-yellow detail, and a Helvetica-grade grotesk (Inter,
// loaded in app/_layout.tsx) everywhere. Geometry is sharp: bars and perfect
// circles, hairline rules, minimal radius. No hardcoded hex in screens:
// import { colors, font, ... } and use these tokens.
// =============================================================================

export const colors = {
  // Station-white canvas.
  bg: '#FFFFFF',
  surface: '#FFFFFF', // cards read as bordered panels, not tinted slabs
  surfaceAlt: '#F2F2EF', // recessed panel / disabled fill
  border: '#E4E4E1', // hairline on white
  borderStrong: '#0B0B0B', // signage rule: emphasized outlines are black

  // Ink.
  text: '#0B0B0B', // sign black
  textMuted: '#5C5C58',
  textFaint: '#6E6E6A', // lightest ink that still passes WCAG AA on white

  // Wayfinding accents.
  accent: '#0039A6', // MTA blue: interactive: links, selected chips
  accentSoft: '#E7EDF8', // pale blue wash behind selected chips
  secondary: '#00933C', // MTA green
  secondarySoft: '#E2F3E8',
  gold: '#FCCC0A', // caution / N-Q-R yellow: the one decorative color
  goldSoft: '#FFF6D2',

  // Semantic.
  success: '#00733D',
  warning: '#946200',
  danger: '#C41E24',

  // Per-kind roundel colors (MTA line bullets).
  event: '#B933AD', // 7 line purple
  restaurant: '#EE352E', // 1-2-3 red
  bar: '#FF6319', // B-D-F-M orange
  activity: '#0039A6', // A-C-E blue
  bucket: '#00933C', // 4-5-6 green
  walk: '#A7A9AC', // L gray
  break: '#8D8F92',

  // Calendar blocks.
  free: '#00933C', // available time reads as go-green
  freeSoft: '#E2F3E8',
  planned: '#0E0E0E', // plan blocks are little black signs
  plannedPressed: '#2B2B2B',
  gridLine: '#EBEBE8',

  // Solid black sign bars (headers, heroes).
  sign: '#0B0B0B',

  // Ink used on top of black signs / colored roundels.
  onArt: '#FFFFFF',
  onArtMuted: '#C9C9C5',
  // Ink used on top of BRIGHT fills (MTA-blue buttons, green chips).
  onAccent: '#FFFFFF',

  // Misc.
  overlay: 'rgba(0,0,0,0.5)',
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

// Signage geometry: bars and circles. Corners stay near-sharp; the only true
// curve in the system is the pill/roundel.
export const radius = {
  sm: 2,
  md: 4,
  lg: 8,
  xl: 12,
  pill: 999,
} as const;

export const font = {
  // Inter: the Helvetica of screens (loaded in app/_layout.tsx). The token
  // KEYS keep their old names so no component changes: "serif" now simply
  // means body-regular, "display" means the heaviest signage weight.
  family: {
    display: 'Inter_800ExtraBold',
    displayBlack: 'Inter_900Black',
    heading: 'Inter_600SemiBold',
    serif: 'Inter_400Regular',
    serifItalic: 'Inter_500Medium',
  },
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    heroSm: 30, // plan hero titles
    display: 36,
    hero: 44,
    wordmark: 56, // welcome wordmark
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

/** A '#RRGGBB' token as an 'rgba(r, g, b, a)' string at the given opacity. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type KindColorKey =
  | 'event'
  | 'restaurant'
  | 'bar'
  | 'activity'
  | 'bucket'
  | 'walk'
  | 'break';

/** Roundel color for a plan-item kind. */
export function kindColor(kind: KindColorKey): string {
  return colors[kind];
}

export const theme = { colors, spacing, radius, font } as const;
