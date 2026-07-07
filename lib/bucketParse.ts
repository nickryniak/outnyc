// =============================================================================
// OutNYC: bucket-list text parsing (lib/bucketParse.ts)
// =============================================================================
// Turns pasted free text (numbered lists, bullets, one-per-line) into clean
// bucket-item inputs. Shared by the bucket screen's paste box and the store's
// bootstrap healing pass, which splits "mega-items" (a whole numbered list
// saved as ONE item before this parser existed) into real items.
// =============================================================================

/**
 * A pasted blob often begins with a label line like "Bucket list:", "My NYC
 * list", or "Things to do:": that is a HEADER, not an activity, and it must
 * never become an item. Matches known label phrasings, plus any short line
 * that ends in a colon (labels introduce; activities don't).
 */
export function isListHeader(line: string): boolean {
  const t = line.trim();
  if (/^(my\s+)?(nyc\s+)?(bucket|to.?do|wish)\s*list\s*:?$/i.test(t)) return true;
  if (/^things\s+to\s+do(\s+in\s+\w+)?\s*:?$/i.test(t)) return true;
  return /:$/.test(t) && t.split(/\s+/).length <= 4;
}

/** Split pasted text into item strings (handles "1." / "1)" / bullets / lines). */
export function parseList(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = /(^|\s)\d+[.)]\s+/.test(t)
    ? t.split(/\s*\d+[.)]\s+/)
    : t.split(/\r?\n|•|(?:^|\s)[-*]\s+/);
  return parts
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((s) => !isListHeader(s));
}

/** Split "Title - note" into a title + optional note. Pasted text may use a
 *  hyphen, en dash, or em dash as the separator (unicode escapes, since the
 *  app's own copy never contains em dashes). */
export function splitTitleNote(line: string): { title: string; note?: string } {
  const [first, ...rest] = line.split(/\s+[-\u2013\u2014]\s+/);
  if (first && rest.length > 0) return { title: first.trim(), note: rest.join('. ').trim() };
  return { title: line };
}

const TAG_RULES: [RegExp, string[]][] = [
  [/park|garden|beach|island|greenway|hudson|rockaway|red hook|governors|roosevelt|kayak|bike|walk|outdoor|golf/i, ['outdoors']],
  [/museum|\bmet\b|broadway|shakespeare|gallery|\bart\b/i, ['art']],
  [/jazz|live music|concert|vanguard/i, ['live music']],
  [/movie|film|snl|late night|fallon|show/i, ['film']],
  [/rooftop|\bbar\b|party|le bain|club|drinks|cocktail/i, ['bar']],
  [/pizza|ramen|food|eat|dinner|brunch|slice/i, ['food']],
  [/comedy|stand-?up/i, ['comedy']],
];

export function inferTags(text: string): string[] {
  const tags = new Set<string>();
  for (const [re, ts] of TAG_RULES) if (re.test(text)) ts.forEach((t) => tags.add(t));
  return [...tags];
}

/**
 * Best-effort neighborhood for well-known landmarks, so a pasted wish like
 * "MET" or "Empire State Building" lands near where it actually is instead of
 * floating into any day's plan as location-agnostic. Values must be exact
 * NEIGHBORHOODS strings (lib/constants.ts). Unknown wishes stay unlocated:
 * that is correct for genuinely go-anywhere items ("jazz club", "golf").
 */
const NEIGHBORHOOD_RULES: [RegExp, string][] = [
  [/central park|shakespeare in the park|delacorte/i, 'Upper West Side'],
  [/\bmet\b|metropolitan museum|guggenheim|frick/i, 'Upper East Side'],
  [/empire state|broadway|\bsnl\b|fallon|late night show|times square|rockefeller|moma\b/i, 'Midtown'],
  [/roosevelt island|tram\b/i, 'Upper East Side'],
  [/brooklyn museum|botanical garden|botanic garden|prospect park/i, 'Park Slope'],
  [/le bain|high line|chelsea/i, 'Chelsea'],
  [/brooklyn bridge|dumbo/i, 'DUMBO'],
  [/williamsburg|smorgasburg/i, 'Williamsburg'],
  [/othership|flatiron/i, 'Chelsea'],
  [/statue of liberty|battery park|wall st|stone street/i, 'Financial District'],
  [/harlem|apollo/i, 'Harlem'],
  [/astoria/i, 'Astoria'],
  [/long island city|\blic\b|ps1/i, 'Long Island City'],
];

export function inferNeighborhood(text: string): string | undefined {
  for (const [re, nb] of NEIGHBORHOOD_RULES) if (re.test(text)) return nb;
  return undefined;
}

export interface ParsedBucketInput {
  title: string;
  note?: string;
  neighborhood?: string;
  tags: string[];
}

/** Parse a pasted blob into ready-to-add bucket inputs. */
export function parseBucketText(text: string): ParsedBucketInput[] {
  return parseList(text).map((line) => {
    const { title, note } = splitTitleNote(line);
    return { title, note, neighborhood: inferNeighborhood(line), tags: inferTags(line) };
  });
}
