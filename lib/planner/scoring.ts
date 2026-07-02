// =============================================================================
// OutNYC — candidate scoring (lib/planner/scoring.ts)
// =============================================================================
// The per-candidate score behind the heuristic planner's ranking, extracted so
// other ranking sites (the store's slot-alternatives flow) can use the SAME
// brain. Pure and deterministic: the same candidate + context always yields
// the same score.
// =============================================================================

import type { Candidate, PlanItemKind, PlanModifier } from '../types';
import { hash } from './slotUtils';

// Score weights. Neighborhood is the strongest signal (a day set to Manhattan
// must not casually schedule Brooklyn), holidays outrank plain interests, and
// jitter is a small deterministic tie-break, not a real preference.
const NEIGHBORHOOD_MATCH = 6;
const NEIGHBORHOOD_MISS = -3;
const INTEREST_WEIGHT = 2;
const HOLIDAY_WEIGHT = 4;
const KIND_WEIGHT_SCALE = 3;
const CHEAPER_TIER_WEIGHT = 2;
// Jitter is a bucketed hash; how loudly it speaks depends on the mode.
const JITTER_BUCKETS = 7;
const JITTER_SURPRISE_WEIGHT = 2;
const JITTER_RESHUFFLE_WEIGHT = 1.3;
const JITTER_STABLE_WEIGHT = 0.1;

/** Tag-overlap count between a candidate's tags and a tag list. */
export function overlap(tags: string[], wanted: string[]): number {
  const set = new Set(wanted.map((t) => t.toLowerCase()));
  return tags.reduce((n, t) => (set.has(t.toLowerCase()) ? n + 1 : n), 0);
}

/** How a modifier weights different kinds (higher = preferred). */
function kindWeight(kind: PlanItemKind, modifier?: PlanModifier): number {
  switch (modifier) {
    case 'more-food':
      return kind === 'restaurant' ? 3 : kind === 'bar' ? 1 : 0;
    case 'more-active':
      return kind === 'activity' ? 3 : kind === 'event' ? 2 : 0;
    case 'cheaper':
      return 0; // price handled separately by the cheaper bias
    case 'surprise':
      return 0; // surprise relies on the jitter weight below
    default:
      return kind === 'event' ? 1 : 0;
  }
}

/**
 * Everything scoreCandidate needs beyond the candidate itself. Mirrors the
 * relevant slice of PlanRequest so callers outside the planner (the store's
 * slotCandidates) can build one without a full request.
 */
export interface ScoringContext {
  /** The day's selected neighborhoods, as picked (matched case-insensitively). */
  neighborhoods: string[];
  /** The user's interest tags; each overlapping candidate tag adds INTEREST_WEIGHT. */
  interests: string[];
  /** Holiday context for the date, when it lands on a notable NYC day. */
  holiday?: { name: string; boostTags: string[] } | null;
  /** Active plan modifier; drives kind weighting and the cheaper price bias. */
  modifier?: PlanModifier;
  /** Deterministic run seed — hash of `date:modifier:nonce` — mixed into the jitter. */
  seed: number;
  /** Reshuffle counter; nonzero loudens the jitter so reshuffles reorder picks. */
  nonce?: number;
}

/** Deterministic score for one candidate (higher = better). */
export function scoreCandidate(candidate: Candidate, ctx: ScoringContext): number {
  const nbset = new Set(ctx.neighborhoods.map((n) => n.toLowerCase()));
  let score = 0;
  // Neighborhood: a strong preference for a match, and a real penalty for a
  // stop in a neighborhood the user did NOT pick, so a day set to Manhattan
  // does not casually schedule a Brooklyn stop when local options exist.
  if (candidate.neighborhood) {
    score += nbset.has(candidate.neighborhood.toLowerCase())
      ? NEIGHBORHOOD_MATCH
      : NEIGHBORHOOD_MISS;
  }
  // Interest overlap.
  score += overlap(candidate.tags, ctx.interests) * INTEREST_WEIGHT;
  // Holiday context: lean into the day (e.g. rooftops on July 4th).
  if (ctx.holiday) {
    score += overlap(candidate.tags, ctx.holiday.boostTags) * HOLIDAY_WEIGHT;
  }
  // Modifier kind weighting.
  score += kindWeight(candidate.kind, ctx.modifier) * KIND_WEIGHT_SCALE;
  // "cheaper" prefers lower tiers.
  if (ctx.modifier === 'cheaper') {
    score += (5 - (candidate.priceTier ?? 4)) * CHEAPER_TIER_WEIGHT;
  }
  // Deterministic tie-break that varies by modifier+date so reshuffle
  // across modifiers reorders selection.
  const jitter = hash(candidate.id + ':' + ctx.seed) % JITTER_BUCKETS;
  // "surprise" leans heavily on jitter; an explicit reshuffle (nonce > 0)
  // also shuffles noticeably, while the first generation stays near-stable.
  const jitterWeight =
    ctx.modifier === 'surprise'
      ? JITTER_SURPRISE_WEIGHT
      : ctx.nonce
        ? JITTER_RESHUFFLE_WEIGHT
        : JITTER_STABLE_WEIGHT;
  score += jitter * jitterWeight;
  return score;
}
