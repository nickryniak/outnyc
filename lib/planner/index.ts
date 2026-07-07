// =============================================================================
// OutNYC: planner barrel (lib/planner/index.ts)
// =============================================================================
// The heuristic planner is the DEFAULT. Future Gemini/edge adapters would
// implement the same Planner interface and be selected here.
// =============================================================================
import { heuristicPlanner } from './heuristicPlanner';
import type { Planner } from './planner';

export type { Planner, PlanRequest } from './planner';
export { HeuristicPlanner, heuristicPlanner } from './heuristicPlanner';
export type { ScoringContext } from './scoring';
export { scoreCandidate } from './scoring';

/** The active default planner. */
export const defaultPlanner: Planner = heuristicPlanner;
