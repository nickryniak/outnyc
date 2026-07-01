// =============================================================================
// OutNYC — canonical domain model (lib/types.ts)
// =============================================================================
// This is the SINGLE SOURCE OF TRUTH for the on-device domain shapes. It is
// kept in sync with:
//   - supabase/migrations/0001_init.sql  (the future-swap schema)
//   - supabase/functions/planDay/index.ts  (the optional LLM planner)
//
// Conventions:
//   - Dates are 'YYYY-MM-DD' strings (America/New_York local).
//   - Window times are 'HH:MM' 24h strings (America/New_York local).
//   - Price is a tier 1..4 mapping to $..$$$$.
// =============================================================================

/** A price tier: 1 = $, 2 = $$, 3 = $$$, 4 = $$$$. */
export type PriceTier = 1 | 2 | 3 | 4;

/** Inclusive price range, both ends are tiers (min <= max). */
export interface PriceRange {
  min: PriceTier;
  max: PriceTier;
}

/** A free-time window on a given day. 'HH:MM' 24h local strings. */
export interface TimeWindow {
  start: string; // 'HH:MM'
  end: string; // 'HH:MM'
}

/** The single user's defaults. Mirrors public.profile. */
export interface Profile {
  displayName: string;
  /** Party size for itineraries (1 = solo). */
  partySize: number;
  /** Preferred NYC neighborhoods. */
  defaultNeighborhoods: string[];
  /** Price range as $..$$$$ tiers. */
  priceRange: PriceRange;
  /** Free-text interest tags used to bias the planner. */
  interests: string[];
  /** Optional "home base" the planner can start/end walks from. */
  homeBase?: string;
  /** Whether onboarding has been completed. */
  onboarded: boolean;
}

/** Free-time windows the user marked for one local date. Mirrors public.availability. */
export interface Availability {
  /** America/New_York local date as 'YYYY-MM-DD'. */
  date: string;
  windows: TimeWindow[];
}

/** An aspirational item the planner tries to weave in. Mirrors public.bucket_list. */
export interface BucketItem {
  id: string;
  title: string;
  note?: string;
  neighborhood?: string;
  priceTier?: PriceTier;
  /** Interest/tag bias so the planner can match interests. */
  tags: string[];
  /** OPEN items are candidates for the planner; done items are skipped. */
  done: boolean;
  /** User-controlled ordering (lower = surfaced sooner). */
  sortOrder: number;
}

/** The kind of a stop inside a plan. Matches plan_item.kind in the SQL. */
export type PlanItemKind =
  | 'event'
  | 'restaurant'
  | 'bar'
  | 'activity'
  | 'bucket'
  | 'walk'
  | 'break';

/** Which planner produced a plan. Matches plan.generated_by in the SQL. */
export type GeneratedBy = 'heuristic' | 'llm' | 'manual';

/** A reshuffle modifier. */
export type PlanModifier = 'more-food' | 'more-active' | 'cheaper' | 'surprise';

/** One ordered stop inside a plan. Mirrors public.plan_item. */
export interface PlanItem {
  id: string;
  /** 0-based position within the plan. */
  order: number;
  kind: PlanItemKind;
  title: string;
  neighborhood?: string;
  /** 'HH:MM' local start/end for this stop. */
  startTime: string;
  endTime: string;
  priceTier?: PriceTier;
  lat?: number;
  lng?: number;
  address?: string;
  /** Deep-link out for "Book"/"Tickets" — the app only Linking-opens this. */
  bookingUrl?: string;
  /** Id of the upstream candidate (event/place) this stop came from, if any. */
  sourceId?: string;
  /** If this stop satisfies a bucket item, link it back. */
  bucketItemId?: string;
  note?: string;
}

/** A packed itinerary for one (date, window). Mirrors public.plan. */
export interface Plan {
  id: string;
  date: string; // 'YYYY-MM-DD'
  window: TimeWindow;
  neighborhoods: string[];
  price: PriceRange;
  partySize: number;
  generatedBy: GeneratedBy;
  modifier?: PlanModifier;
  items: PlanItem[];
  createdAt: string; // ISO timestamp
}

/** A signal the user gives on a plan. Mirrors public.feedback. */
export type FeedbackSignal = 'up' | 'down' | 'reshuffle' | 'completed' | 'skipped';

export interface Feedback {
  id: string;
  planId: string;
  signal: FeedbackSignal;
  planItemId?: string;
  note?: string;
  createdAt: string; // ISO timestamp
}

// ---- Provider candidate shapes (events + places) ----------------------------

/** A candidate venue from an events or places provider. */
export interface Candidate {
  id: string;
  name: string;
  kind: PlanItemKind;
  neighborhood?: string;
  priceTier?: PriceTier;
  /** 'HH:MM' (events have fixed times; places do not). */
  startTime?: string;
  endTime?: string;
  /** Typical visit duration in minutes (for places without fixed times). */
  durationMin?: number;
  lat?: number;
  lng?: number;
  address?: string;
  bookingUrl?: string;
  tags: string[];
}

/** Every provider exposes this descriptor. */
export interface ProviderInfo {
  name: string;
  isLive: boolean;
}
