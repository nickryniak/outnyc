// =============================================================================
// OutNYC — runtime config + provider flags (lib/config.ts)
// =============================================================================
// Reads EXPO_PUBLIC_* env vars (bundled at build time by Expo) and exposes
// detected/isLive flags the Settings screen renders. With no keys present,
// every flag is false and the app runs entirely on mock/seed data.
//
// SECURITY: EXPO_PUBLIC_* values are bundled into the app and are NOT secret.
// Accepted tradeoff for a personal v1. Prefer the Supabase edge function for
// the LLM planner instead of a client key.
// =============================================================================

import type { ProviderInfo } from './types';

/**
 * `process.env.EXPO_PUBLIC_*` is statically inlined by the Expo/Metro bundler,
 * so these must be referenced by their literal full names (no dynamic access).
 */
function readEnv(value: string | undefined): string {
  return (value ?? '').trim();
}

export const env = {
  ticketmasterKey: readEnv(process.env.EXPO_PUBLIC_TICKETMASTER_API_KEY),
  seatgeekClientId: readEnv(process.env.EXPO_PUBLIC_SEATGEEK_CLIENT_ID),
  geminiKey: readEnv(process.env.EXPO_PUBLIC_GEMINI_API_KEY),
  googlePlacesKey: readEnv(process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY),
  supabaseUrl: readEnv(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: readEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
} as const;

/** True when a non-empty key is present. */
function has(value: string): boolean {
  return value.length > 0;
}

/**
 * Provider flags surfaced in Settings. `isLive` is true only when the relevant
 * key (or key pair) is present; otherwise the provider serves mock data.
 */
export const providerFlags = {
  events: {
    name: 'Ticketmaster (events)',
    isLive: has(env.ticketmasterKey),
  },
  seatgeek: {
    name: 'SeatGeek (events)',
    isLive: has(env.seatgeekClientId),
  },
  places: {
    name: 'Google Places (restaurants)',
    isLive: has(env.googlePlacesKey),
  },
  // Public NYC Open Data feeds — no key required, so these are always on.
  nycOpenData: {
    name: 'NYC Permitted Events (civic)',
    isLive: true,
  },
  nycParks: {
    name: 'NYC Parks events',
    isLive: true,
  },
  geminiPlanner: {
    name: 'Gemini (LLM planning)',
    isLive: has(env.geminiKey),
  },
  edgePlanner: {
    name: 'Supabase edge function (secure LLM planning)',
    isLive: has(env.supabaseUrl) && has(env.supabaseAnonKey),
  },
} as const satisfies Record<string, ProviderInfo>;

export type ProviderFlagKey = keyof typeof providerFlags;

/** Ordered list for the Settings screen. */
export const PROVIDER_FLAG_LIST: ProviderInfo[] = [
  providerFlags.events,
  providerFlags.seatgeek,
  providerFlags.places,
  providerFlags.nycOpenData,
  providerFlags.nycParks,
  providerFlags.geminiPlanner,
  providerFlags.edgePlanner,
];

/** True when at least one live provider is configured. */
export const anyLive: boolean = PROVIDER_FLAG_LIST.some((p) => p.isLive);
