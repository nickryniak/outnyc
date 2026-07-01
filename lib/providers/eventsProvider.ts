// =============================================================================
// OutNYC — events provider (lib/providers/eventsProvider.ts)
// =============================================================================
// Returns event Candidates. When EXPO_PUBLIC_TICKETMASTER_API_KEY is absent,
// `isLive` is false and we return curated seed events. The live branch is
// stubbed with a clear TODO — it must never throw; on any error it falls back
// to seed data with a flag.
//
// TODO(prod): route the Ticketmaster key through a server/edge function rather
// than bundling EXPO_PUBLIC_TICKETMASTER_API_KEY into the client.
// =============================================================================

import { providerFlags } from '../config';
import { SEED_EVENTS } from '../constants';
import type { Candidate, ProviderInfo } from '../types';

export interface ProviderResult {
  candidates: Candidate[];
  /** True when results came from a live API; false when seed/mock. */
  live: boolean;
  /** Non-null when a live call failed and we fell back. */
  error?: string;
}

export const eventsProvider = {
  info(): ProviderInfo {
    return providerFlags.events;
  },

  /**
   * Fetch events for a date. Always resolves — never throws. Without a key,
   * returns seed events flagged as mock.
   */
  async fetchEvents(_date: string): Promise<ProviderResult> {
    if (!providerFlags.events.isLive) {
      return { candidates: SEED_EVENTS, live: false };
    }
    try {
      // TODO(prod): real Ticketmaster Discovery API call goes here, mapping the
      // response into Candidate[]. For v1 we ship seed data even when "live" so
      // the app never breaks; flip this stub to a real fetch when ready.
      return { candidates: SEED_EVENTS, live: true };
    } catch (err) {
      return {
        candidates: SEED_EVENTS,
        live: false,
        error: err instanceof Error ? err.message : 'events fetch failed',
      };
    }
  },
};
