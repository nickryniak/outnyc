// =============================================================================
// OutNYC — human stop labels (lib/labels.ts)
// =============================================================================
// One shared answer to "what IS this stop?" — shown on the calendar block, the
// day panel, and the full plan view, so a user who has never heard of Buvette
// still reads "LUNCH · Buvette". Meal labels come from the stop's START time
// (the same meal windows the planner schedules with, via mealSlotAt); event and
// activity labels come from the candidate's tags.
// =============================================================================

import { mealSlotAt } from './planner/slotUtils';
import { toMinutes } from './time';
import type { PlanItemKind } from './types';

/** Title-case label for a stop, e.g. 'Lunch', 'Live music', 'From your list'. */
export function stopLabel(kind: PlanItemKind, startTime: string, tags?: string[]): string {
  const t = (tags ?? []).map((x) => x.toLowerCase());

  switch (kind) {
    case 'bucket':
      return 'From your list';
    case 'bar':
      return t.includes('rooftop') ? 'Rooftop drinks' : 'Drinks';
    case 'restaurant': {
      const slot = mealSlotAt(toMinutes(startTime));
      // Coffee shops stay "Coffee" across their whole schedulable range
      // (07:00-17:00 = coffee/breakfast/lunch slots) — a 12:30 espresso stop
      // is not "Lunch".
      if (t.includes('coffee') && (slot === 'coffee' || slot === 'breakfast' || slot === 'lunch')) {
        return 'Coffee';
      }
      switch (slot) {
        case 'breakfast':
          return t.includes('brunch') ? 'Brunch' : 'Breakfast';
        case 'lunch':
          return 'Lunch';
        case 'dinner':
          return 'Dinner';
        case 'late-night':
          return 'Late-night bite';
        case 'coffee':
          return 'Coffee & a bite';
        default:
          return 'Eat';
      }
    }
    case 'event': {
      if (t.includes('live music')) return 'Live music';
      if (t.includes('comedy')) return 'Comedy show';
      if (t.includes('film')) return 'Movie';
      return 'Show';
    }
    case 'activity': {
      if (t.includes('outdoors')) return 'Outdoors';
      if (t.includes('art')) return 'Art & sights';
      return 'Activity';
    }
    case 'walk':
      return 'Walk';
    case 'break':
      return 'Break';
    default:
      return kind;
  }
}
