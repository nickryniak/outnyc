// =============================================================================
// OutNYC: bucket-parse tests (lib/bucketParse.test.ts)
// =============================================================================
// Regression suite from the decade-proofing audit: pasted lists in every
// real-world shape must produce exactly one clean item per intended entry.
// =============================================================================

import {
  inferNeighborhood,
  inferTags,
  isListHeader,
  parseBucketText,
  parseList,
} from './bucketParse';

describe('parseList', () => {
  it('splits plain one-per-line pastes on newlines', () => {
    expect(parseList('Coney Island Cyclone\nKatz’s Deli\nGovernors Island')).toEqual([
      'Coney Island Cyclone',
      'Katz’s Deli',
      'Governors Island',
    ]);
  });

  it('does not flip into numbered mode on a mid-sentence year or number', () => {
    expect(
      parseList("Coney Island Cyclone\nKatz's Deli est. 1888. get pastrami\nGovernors Island")
    ).toEqual(["Coney Island Cyclone", "Katz's Deli est. 1888. get pastrami", 'Governors Island']);
    expect(
      parseList("Grimaldi's (since 1990) pizza under the bridge\nWalk the Brooklyn Bridge")
    ).toEqual(["Grimaldi's (since 1990) pizza under the bridge", 'Walk the Brooklyn Bridge']);
  });

  it('keeps interior " - " inside a line so title-note splitting still works', () => {
    expect(parseList("Katz's Deli - get the pastrami\nCentral Park picnic")).toEqual([
      "Katz's Deli - get the pastrami",
      'Central Park picnic',
    ]);
    const parsed = parseBucketText("Katz's Deli - get the pastrami");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Katz's Deli");
    expect(parsed[0]?.note).toBe('get the pastrami');
  });

  it('strips per-line numbered markers without splitting on interior numbers', () => {
    expect(
      parseList('1. MoMA (free Fri after 4) then walk the High Line\n2. Katz’s Deli')
    ).toEqual(['MoMA (free Fri after 4) then walk the High Line', 'Katz’s Deli']);
    expect(parseList('1. Hamilton (Sec 102) orchestra seats\n2. Sleep No More')).toEqual([
      'Hamilton (Sec 102) orchestra seats',
      'Sleep No More',
    ]);
  });

  it('splits legacy single-line mega-items on their own sequential numbering only', () => {
    expect(parseList('1. Central Park 2. Katz’s Deli 3. Governors Island')).toEqual([
      'Central Park',
      'Katz’s Deli',
      'Governors Island',
    ]);
    // "(free Fri after 4)" is not the next number in the run, so it stays put.
    expect(parseList('1. MoMA (free Fri after 4) then the High Line 2. Katz’s Deli')).toEqual([
      'MoMA (free Fri after 4) then the High Line',
      'Katz’s Deli',
    ]);
  });

  it('recognizes "(1) item" and "1.item" marker styles', () => {
    expect(parseList('(1) Central Park\n(2) Katz’s Deli')).toEqual([
      'Central Park',
      'Katz’s Deli',
    ]);
    expect(parseList('1.Central Park\n2.Katz’s Deli')).toEqual([
      'Central Park',
      'Katz’s Deli',
    ]);
  });

  it('strips leading bullet markers but leaves hyphenated words alone', () => {
    expect(parseList('- Comedy Cellar\n* Blue Note\n• Village Vanguard')).toEqual([
      'Comedy Cellar',
      'Blue Note',
      'Village Vanguard',
    ]);
    expect(parseList('Stand-up at the Cellar')).toEqual(['Stand-up at the Cellar']);
  });

  it('drops header lines including multi-word places', () => {
    expect(parseList('Things to do in New York:\n1. Central Park\n2. Katz’s')).toEqual([
      'Central Park',
      'Katz’s',
    ]);
    expect(parseList('My NYC bucket list:\nComedy Cellar')).toEqual(['Comedy Cellar']);
  });

  it('handles CRLF, blank lines, and whitespace-only input', () => {
    expect(parseList('A\r\n\r\nB\r\n')).toEqual(['A', 'B']);
    expect(parseList('   \n  \n')).toEqual([]);
    expect(parseList('')).toEqual([]);
  });
});

describe('isListHeader', () => {
  it('accepts known label phrasings and short colon lines', () => {
    expect(isListHeader('Bucket list:')).toBe(true);
    expect(isListHeader('Things to do in New York:')).toBe(true);
    expect(isListHeader('Things to do')).toBe(true);
    expect(isListHeader('Weekend ideas:')).toBe(true);
  });

  it('keeps real activities', () => {
    expect(isListHeader('Walk the Brooklyn Bridge')).toBe(false);
    expect(isListHeader('Katz’s Deli - get the pastrami')).toBe(false);
  });
});

describe('Met disambiguation', () => {
  it('does not place or tag ordinary uses of the word "met"', () => {
    const line = 'Go back to the rooftop bar where we met - anniversary drinks';
    expect(inferNeighborhood(line)).toBeUndefined();
    expect(inferTags(line)).not.toContain('art');
  });

  it('still recognizes the museum in its real phrasings', () => {
    for (const line of ['the Met', 'MET', 'Met Museum rooftop', 'Metropolitan Museum of Art']) {
      expect(inferNeighborhood(line)).toBe('Upper East Side');
    }
    expect(inferTags('The Met on a rainy day')).toContain('art');
  });
});
