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
  if (/^things\s+to\s+do(\s+in\s+[\w'’ .-]+)?\s*:?$/i.test(t)) return true;
  return /:$/.test(t) && t.split(/\s+/).length <= 8;
}

/**
 * Legacy "mega-items" hold a whole numbered list in ONE line ("1. A 2. B").
 * Split those on interior markers, but ONLY markers that continue the line's
 * own numbering (1, 2, 3, ...): years ("est. 1888."), section numbers
 * ("(Sec 102)"), and times ("free after 4)") never do, so they stay inside
 * their item instead of shredding it.
 */
function splitNumberedRun(line: string): string[] {
  const lead = line.match(/^\s*\(?(\d{1,3})[.)]/);
  if (!lead?.[1]) return [line];
  const marker = /\s\(?(\d{1,3})[.)](?=\s|[A-Za-z(])/g;
  let expected = parseInt(lead[1], 10) + 1;
  const cuts: number[] = [];
  for (let m = marker.exec(line); m; m = marker.exec(line)) {
    if (m[1] != null && parseInt(m[1], 10) === expected) {
      cuts.push(m.index);
      expected += 1;
    }
  }
  if (cuts.length === 0) return [line];
  const parts: string[] = [];
  let start = 0;
  for (const cut of cuts) {
    parts.push(line.slice(start, cut));
    start = cut;
  }
  parts.push(line.slice(start));
  return parts;
}

/** Split pasted text into item strings (handles "1." / "1)" / "(1)" / bullets / lines). */
export function parseList(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  // Newlines and "•" separate items everywhere; every other marker only
  // counts at the START of its line, so interior " - " (title-note), years,
  // and parentheticals never split an item apart.
  return t
    .split(/\r?\n|•/)
    .flatMap(splitNumberedRun)
    .map((s) => s.replace(/^\s*(?:\(?\d{1,3}[.)]\s*|[-*\u2013\u2014]\s+)/, ''))
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
  // "the Met" / "MET" (caps) mean the museum; a lowercase "met" is usually
  // just the verb ("where we met") and must not tag anything.
  [/museum|\bthe\s+met\b|\bmet\s+(opera|gala|roof|cloisters|breuer)\b|broadway|shakespeare|gallery|\bart\b/i, ['art']],
  [/\bMET\b/, ['art']],
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
  [/\bthe\s+met\b|\bmet\s+(museum|opera|roof|cloisters|breuer)\b|metropolitan museum|guggenheim|frick/i, 'Upper East Side'],
  [/\bMET\b/, 'Upper East Side'],
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
