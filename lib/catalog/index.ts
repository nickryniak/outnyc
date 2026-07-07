// =============================================================================
// OutNYC: curated venue catalog (lib/catalog/index.ts)
// =============================================================================
// The full curated NYC catalog: ~450 real venues and activities across all 20
// supported neighborhoods (plus floating citywide activities), generated per
// area and merged here. constants.ts folds these into SEED_PLACES /
// SEED_EVENTS so the whole app: planner, swaps, alternatives: draws from
// the same pool. Ids are prefixed per file (dt-/up-/bk-/qc-) so they can
// never collide with each other or with the original plc-/evt-/act- seeds.
// =============================================================================

import type { Candidate } from '../types';

import { BROOKLYN_EVENTS, BROOKLYN_PLACES } from './brooklyn';
import { DOWNTOWN_EVENTS, DOWNTOWN_PLACES } from './downtown';
import { QUEENS_CITYWIDE_EVENTS, QUEENS_PLACES } from './queensAndCitywide';
import { UPTOWN_EVENTS, UPTOWN_PLACES } from './uptown';

/** Gap fills: cuisines the swap chips offer that the area files missed. */
const GAP_FILL_PLACES: Candidate[] = [
  {
    id: 'gf-semma',
    name: 'Semma',
    kind: 'restaurant',
    neighborhood: 'West Village',
    priceTier: 3,
    durationMin: 90,
    lat: 40.7366,
    lng: -74.0003,
    address: '60 Greenwich Ave, New York, NY',
    cuisine: 'Indian',
    description: 'South Indian restaurant: Michelin-starred unapologetic home cooking; book way ahead.',
    tags: ['food'],
  },
  {
    id: 'gf-dhamaka',
    name: 'Dhamaka',
    kind: 'restaurant',
    neighborhood: 'Lower East Side',
    priceTier: 3,
    durationMin: 90,
    lat: 40.7183,
    lng: -73.9884,
    address: '119 Delancey St, New York, NY',
    cuisine: 'Indian',
    description: 'Indian restaurant: fiery regional dishes rarely seen on US menus, in Essex Market.',
    tags: ['food'],
  },
  {
    id: 'gf-masalawala',
    name: 'Masalawala & Sons',
    kind: 'restaurant',
    neighborhood: 'Park Slope',
    priceTier: 2,
    durationMin: 90,
    lat: 40.6734,
    lng: -73.9829,
    address: '365 5th Ave, Brooklyn, NY',
    cuisine: 'Indian',
    description: 'Bengali restaurant: homestyle Kolkata cooking from the Dhamaka team, on 5th Ave.',
    tags: ['food'],
  },
];

/** Restaurants + bars from every area file. */
export const CATALOG_PLACES: Candidate[] = [
  ...DOWNTOWN_PLACES,
  ...UPTOWN_PLACES,
  ...BROOKLYN_PLACES,
  ...QUEENS_PLACES,
  ...GAP_FILL_PLACES,
];

/** Activities + fixed-time events from every area file. */
export const CATALOG_EVENTS: Candidate[] = [
  ...DOWNTOWN_EVENTS,
  ...UPTOWN_EVENTS,
  ...BROOKLYN_EVENTS,
  ...QUEENS_CITYWIDE_EVENTS,
];
