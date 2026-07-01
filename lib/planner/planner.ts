// =============================================================================
// OutNYC — Planner interface (lib/planner/planner.ts)
// =============================================================================
// The planning contract. The deterministic heuristic is the DEFAULT impl.
// Gemini/edge-function adapters can implement this later without screen changes.
// =============================================================================

import type {
  BucketItem,
  Candidate,
  Plan,
  PlanModifier,
  PriceRange,
  TimeWindow,
} from '../types';

/** Everything the planner needs to pack one window. */
export interface PlanRequest {
  date: string; // 'YYYY-MM-DD'
  window: TimeWindow;
  neighborhoods: string[];
  price: PriceRange;
  partySize: number;
  interests: string[];
  /** OPEN bucket items the planner should try to weave in. */
  bucketList: BucketItem[];
  events: Candidate[];
  places: Candidate[];
  modifier?: PlanModifier;
}

export interface Planner {
  readonly name: string;
  readonly isLive: boolean;
  /** Produce a packed, ordered, walkable plan for the request. */
  plan(req: PlanRequest): Promise<Plan>;
}
