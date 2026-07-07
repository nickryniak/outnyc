// =============================================================================
// OutNYC: shared display formatters (lib/format.ts)
// =============================================================================
// Tiny label helpers used anywhere a candidate or plan item is rendered, so
// price and rating read identically across the calendar, day panel, and cards.
// =============================================================================

import type { PriceTier } from './types';

export function priceLabel(tier?: PriceTier): string {
  return tier ? '$'.repeat(tier) : '';
}

/** "★ 4.6 (1.2k)" when a review score exists, else '' (curated seed has none). */
export function ratingText(rating?: number, count?: number): string {
  if (rating == null) return '';
  const c =
    count != null
      ? ` (${count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count})`
      : '';
  return `★ ${rating.toFixed(1)}${c}`;
}
