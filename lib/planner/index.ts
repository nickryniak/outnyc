// =============================================================================
// OutNYC — planner barrel (lib/planner/index.ts)
// =============================================================================
// The heuristic planner is the DEFAULT. Future Gemini/edge adapters would
// implement the same Planner interface and be selected here.
// =============================================================================
export type { Planner, PlanRequest } from './planner';
export { HeuristicPlanner, heuristicPlanner } from './heuristicPlanner';

import { heuristicPlanner } from './heuristicPlanner';
import type { Planner } from './planner';

/** The active default planner. */
export const defaultPlanner: Planner = heuristicPlanner;
