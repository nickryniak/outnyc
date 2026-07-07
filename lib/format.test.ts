// =============================================================================
// OutNYC: tests for lib/format.ts
// =============================================================================

import { priceLabel, ratingText } from './format';

describe('priceLabel', () => {
  it('renders one dollar sign per tier', () => {
    expect(priceLabel(1)).toBe('$');
    expect(priceLabel(2)).toBe('$$');
    expect(priceLabel(3)).toBe('$$$');
    expect(priceLabel(4)).toBe('$$$$');
  });

  it('renders nothing when the tier is unknown', () => {
    expect(priceLabel(undefined)).toBe('');
    expect(priceLabel()).toBe('');
  });
});

describe('ratingText', () => {
  it('renders a star, the score to one decimal, and a raw count', () => {
    expect(ratingText(4.6, 231)).toBe('★ 4.6 (231)');
    expect(ratingText(5, 3)).toBe('★ 5.0 (3)');
  });

  it('abbreviates counts of 1000+ with one decimal and a k suffix', () => {
    expect(ratingText(4.6, 1234)).toBe('★ 4.6 (1.2k)');
    expect(ratingText(4.1, 1000)).toBe('★ 4.1 (1.0k)');
    expect(ratingText(4.8, 25400)).toBe('★ 4.8 (25.4k)');
  });

  it('omits the count segment when no count exists', () => {
    expect(ratingText(4.25)).toBe('★ 4.3');
  });

  it('renders nothing when there is no rating (curated seed data)', () => {
    expect(ratingText(undefined)).toBe('');
    expect(ratingText(undefined, 500)).toBe('');
  });
});
