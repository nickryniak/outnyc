// =============================================================================
// OutNYC — places provider (lib/providers/placesProvider.ts)
// =============================================================================
// Returns restaurant/bar Candidates. With EXPO_PUBLIC_GOOGLE_PLACES_API_KEY
// present, hits the Google Places API (New, v1 searchText) per selected
// neighborhood and maps real ratings (rating/userRatingCount), websites, and
// editorial summaries into Candidates — so the app shows REAL review scores,
// never fabricated ones. Without a key, serves curated seed places STRICTLY
// narrowed to the selected neighborhoods (plus location-agnostic picks); there
// is no widening, so a venue in an unpicked neighborhood can never leak in.
// NEVER throws — any live failure falls back to the filtered seed.
//
// TODO(prod): route the Google Places key through a server/edge function rather
// than bundling EXPO_PUBLIC_GOOGLE_PLACES_API_KEY into the client.
// =============================================================================

import { env, providerFlags } from '../config';
import { SEED_PLACES } from '../constants';
import { NEIGHBORHOOD_CENTERS, nearestNeighborhood } from '../geo';
import { filterToNeighborhoods } from '../planner/slotUtils';
import type { Candidate, PriceTier, ProviderInfo } from '../types';
import type { ProviderResult } from './eventsProvider';
import { fetchJson } from './net';

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
// One searchText call per neighborhood; bounded so a many-neighborhood day
// can't fan out into unbounded quota usage.
const MAX_NEIGHBORHOOD_QUERIES = 4;
const RESULTS_PER_NEIGHBORHOOD = 12;
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.types',
  'places.primaryType',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.location',
  'places.formattedAddress',
  'places.websiteUri',
  'places.editorialSummary',
].join(',');

// Google Places "type" -> a plain cuisine label for the Italian/Coffee/etc.
// swap-intent chips. Checked in a fixed priority order (first match wins).
const CUISINE_TYPES: [string, string][] = [
  ['italian_restaurant', 'Italian'],
  ['pizza_restaurant', 'Pizza'],
  ['japanese_restaurant', 'Japanese'],
  ['sushi_restaurant', 'Sushi'],
  ['ramen_restaurant', 'Japanese'],
  ['chinese_restaurant', 'Chinese'],
  ['korean_restaurant', 'Korean'],
  ['thai_restaurant', 'Thai'],
  ['vietnamese_restaurant', 'Vietnamese'],
  ['indian_restaurant', 'Indian'],
  ['mexican_restaurant', 'Mexican'],
  ['french_restaurant', 'French'],
  ['greek_restaurant', 'Greek'],
  ['spanish_restaurant', 'Spanish'],
  ['mediterranean_restaurant', 'Mediterranean'],
  ['middle_eastern_restaurant', 'Middle Eastern'],
  ['seafood_restaurant', 'Seafood'],
  ['steak_house', 'Steakhouse'],
  ['vegan_restaurant', 'Vegan'],
  ['vegetarian_restaurant', 'Vegetarian'],
  ['american_restaurant', 'American'],
  ['bakery', 'Bakery'],
];

/** Best-match cuisine label from Google's type taxonomy, if any. */
function gpCuisine(types: string[], isCoffee: boolean): string | undefined {
  if (isCoffee) return 'Coffee';
  for (const [type, label] of CUISINE_TYPES) {
    if (types.includes(type)) return label;
  }
  return undefined;
}

/** Places API v1 price level -> the app's $..$$$$ tier. */
function gpPriceTier(level: string | undefined): PriceTier | undefined {
  switch (level) {
    case 'PRICE_LEVEL_FREE':
    case 'PRICE_LEVEL_INEXPENSIVE':
      return 1;
    case 'PRICE_LEVEL_MODERATE':
      return 2;
    case 'PRICE_LEVEL_EXPENSIVE':
      return 3;
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return 4;
    default:
      return undefined;
  }
}

/** Map one Places result into a Candidate with a coordinate-verified area. */
function gpToCandidate(p: any, queriedNeighborhood: string): Candidate | null {
  const name: string | undefined = p?.displayName?.text;
  if (!p?.id || !name) return null;
  const types: string[] = Array.isArray(p?.types) ? p.types : [];
  const isBar =
    (types.includes('bar') || types.includes('night_club')) && !types.includes('restaurant');
  const tags = isBar ? ['bar'] : ['food'];
  // Coffee-gate ONLY genuine coffee shops: Google attaches 'cafe' as a
  // secondary type to plenty of full-service restaurants, and the coffee tag
  // locks a venue out of dinner scheduling entirely.
  const primaryType: string | undefined =
    typeof p?.primaryType === 'string' ? p.primaryType : undefined;
  const isCoffee =
    primaryType === 'cafe' ||
    primaryType === 'coffee_shop' ||
    ((types.includes('cafe') || types.includes('coffee_shop')) && !types.includes('restaurant'));
  if (isCoffee) tags.push('coffee');
  if (types.includes('brunch_restaurant')) tags.push('brunch');
  // Text search is a bias, not a restriction: verify the area by COORDINATES
  // (mirroring the events provider) so a famous cross-town venue can't sneak
  // through the strict neighborhood filter mislabeled as the queried area.
  const lat: number | undefined =
    typeof p?.location?.latitude === 'number' ? p.location.latitude : undefined;
  const lng: number | undefined =
    typeof p?.location?.longitude === 'number' ? p.location.longitude : undefined;
  const neighborhood =
    lat != null && lng != null ? nearestNeighborhood(lat, lng) : queriedNeighborhood;
  return {
    id: `gp-${p.id}`,
    name,
    kind: isBar ? 'bar' : 'restaurant',
    neighborhood,
    priceTier: gpPriceTier(p?.priceLevel),
    durationMin: 75,
    lat,
    lng,
    address: p?.formattedAddress,
    bookingUrl: typeof p?.websiteUri === 'string' ? p.websiteUri : undefined,
    rating: typeof p?.rating === 'number' ? p.rating : undefined,
    ratingCount: typeof p?.userRatingCount === 'number' ? p.userRatingCount : undefined,
    description: p?.editorialSummary?.text ?? (isBar ? 'Bar.' : 'Restaurant.'),
    tags,
    cuisine: isBar ? undefined : gpCuisine(types, isCoffee),
  };
}

export const placesProvider = {
  info(): ProviderInfo {
    return providerFlags.places;
  },

  /**
   * Fetch places IN the given neighborhoods. Always resolves — never throws.
   * Live results carry real Google ratings and websites; seed fallback stays
   * strictly neighborhood-filtered.
   */
  async fetchPlaces(neighborhoods: string[]): Promise<ProviderResult> {
    const localSeed = filterToNeighborhoods(SEED_PLACES, neighborhoods);
    if (!providerFlags.places.isLive) {
      return { candidates: localSeed, live: false };
    }
    try {
      const targets = neighborhoods.slice(0, MAX_NEIGHBORHOOD_QUERIES);
      const seen = new Set<string>();
      const candidates: Candidate[] = [];
      for (const nb of targets) {
        // Anchor the search to the neighborhood's centroid; the text query
        // alone is only a bias and can rank cross-town results.
        const center = NEIGHBORHOOD_CENTERS[nb];
        const json = await fetchJson(
          PLACES_URL,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': env.googlePlacesKey,
              'X-Goog-FieldMask': FIELD_MASK,
            },
            body: JSON.stringify({
              textQuery: `best restaurants and bars in ${nb}, New York City`,
              pageSize: RESULTS_PER_NEIGHBORHOOD,
              ...(center
                ? {
                    locationBias: {
                      circle: {
                        center: { latitude: center.lat, longitude: center.lng },
                        radius: 1500,
                      },
                    },
                  }
                : {}),
            }),
          },
          8000,
        );
        for (const p of json?.places ?? []) {
          const c = gpToCandidate(p, nb);
          if (c && !seen.has(c.id)) {
            seen.add(c.id);
            candidates.push(c);
          }
        }
      }
      if (candidates.length === 0) {
        return { candidates: localSeed, live: false, error: 'no live places returned' };
      }
      // Neighborhoods beyond the query cap never got a live call; keep their
      // curated seed coverage so a 5th+ selected neighborhood isn't silently
      // left with zero food/bar candidates. Only seeds explicitly IN those
      // neighborhoods (location-agnostic seeds aren't re-admitted here).
      const unqueried = neighborhoods.slice(MAX_NEIGHBORHOOD_QUERIES);
      if (unqueried.length > 0) {
        const want = new Set(unqueried.map((n) => n.trim().toLowerCase()));
        for (const s of SEED_PLACES) {
          if (
            s.neighborhood &&
            want.has(s.neighborhood.trim().toLowerCase()) &&
            !seen.has(s.id)
          ) {
            seen.add(s.id);
            candidates.push(s);
          }
        }
      }
      return { candidates, live: true };
    } catch (err) {
      return {
        candidates: localSeed,
        live: false,
        error: err instanceof Error ? err.message : 'places fetch failed',
      };
    }
  },
};
