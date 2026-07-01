// =============================================================================
// OutNYC — places provider (lib/providers/placesProvider.ts)
// =============================================================================
// Returns restaurant/bar Candidates. When EXPO_PUBLIC_GOOGLE_PLACES_API_KEY is
// absent, `isLive` is false and we return curated seed places. Never throws.
//
// TODO(prod): route the Google Places key through a server/edge function rather
// than bundling EXPO_PUBLIC_GOOGLE_PLACES_API_KEY into the client.
// =============================================================================

import { providerFlags } from '../config';
import { SEED_PLACES } from '../constants';
import type { ProviderInfo } from '../types';
import type { ProviderResult } from './eventsProvider';

export const placesProvider = {
  info(): ProviderInfo {
    return providerFlags.places;
  },

  /**
   * Fetch places near the given neighborhoods. Always resolves — never throws.
   * Without a key, returns seed places flagged as mock.
   */
  async fetchPlaces(_neighborhoods: string[]): Promise<ProviderResult> {
    if (!providerFlags.places.isLive) {
      return { candidates: SEED_PLACES, live: false };
    }
    try {
      // TODO(prod): real Google Places API call goes here, mapping the
      // response into Candidate[]. v1 ships seed data; flip this stub when ready.
      return { candidates: SEED_PLACES, live: true };
    } catch (err) {
      return {
        candidates: SEED_PLACES,
        live: false,
        error: err instanceof Error ? err.message : 'places fetch failed',
      };
    }
  },
};
