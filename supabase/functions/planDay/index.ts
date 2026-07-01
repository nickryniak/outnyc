// =============================================================================
// OutNYC — planDay Supabase Edge Function (Deno)
// =============================================================================
// FUTURE-SWAP / SECURE PATH. This is the recommended way to enable live LLM
// planning later: the Anthropic key lives ONLY as a function secret here, never
// in the app bundle. v1 ships a deterministic on-device heuristic planner and
// does not call this function at all.
//
// Contract (input body) — mirrors the on-device PlanRequest:
//   {
//     date:          string,            // 'YYYY-MM-DD' (America/New_York local)
//     window:        { start: string; end: string },   // 'HH:MM' 24h local
//     neighborhoods: string[],
//     price:         { min: number; max: number },      // 1..4 tiers ($..$$$$)
//     partySize:     number,
//     interests:     string[],
//     bucketList:    BucketCandidate[], // aspirational items to prioritize
//     events:        Candidate[],       // ONLY these venues may be used
//     places:        Candidate[],       // ONLY these venues may be used
//     modifier?:     string             // e.g. 'more-food' | 'cheaper' | 'surprise'
//   }
//
// Output (success): { ok: true, items: PlanItem[], generatedBy: 'llm' }
// Output (failure): { ok: false, error: string }   (HTTP 4xx/5xx)
//
// The model returns STRICT JSON: a bare PlanItem[] array, no prose, no fences.
// We parse defensively (strip fences, try/catch, validate) and do ONE stricter
// retry before giving up so the caller can fall back to the heuristic planner.
//
// Deploy + secrets: see ./README.md in this folder.
// =============================================================================

// NOTE: in the Deno deploy runtime these globals (Deno, fetch, Response) exist.
// deno-lint-ignore-file no-explicit-any

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Default to a valid, current Anthropic model id. Overridable via the
// ANTHROPIC_MODEL function secret so it can be bumped without a redeploy.
// @ts-ignore Deno global is available in the edge runtime.
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

// ---- Domain shapes (kept in sync with lib/types.ts) -------------------------

interface TimeWindow {
  start: string; // 'HH:MM'
  end: string;   // 'HH:MM'
}

interface PriceRange {
  min: number; // 1..4
  max: number; // 1..4
}

interface Candidate {
  id: string;
  name: string;
  kind?: string;        // 'event' | 'restaurant' | 'bar' | 'activity' | ...
  neighborhood?: string;
  priceTier?: number;   // 1..4
  startTime?: string;   // 'HH:MM' (events)
  endTime?: string;     // 'HH:MM' (events)
  lat?: number;
  lng?: number;
  address?: string;
  bookingUrl?: string;
  tags?: string[];
}

interface BucketCandidate {
  id: string;
  title: string;
  neighborhood?: string;
  priceTier?: number;
  tags?: string[];
}

interface PlanRequest {
  date: string;
  window: TimeWindow;
  neighborhoods: string[];
  price: PriceRange;
  partySize: number;
  interests: string[];
  bucketList: BucketCandidate[];
  events: Candidate[];
  places: Candidate[];
  modifier?: string;
}

// Mirrors PlanItem in lib/types.ts. The model MUST emit exactly this shape.
interface PlanItem {
  id: string;            // reuse the candidate/bucket id it came from
  order: number;         // 0-based position
  kind: string;          // 'event' | 'restaurant' | 'bar' | 'activity' | 'bucket' | 'walk' | 'break'
  title: string;
  neighborhood?: string;
  startTime: string;     // 'HH:MM'
  endTime: string;       // 'HH:MM'
  priceTier?: number;    // 1..4
  lat?: number;
  lng?: number;
  address?: string;
  bookingUrl?: string;
  sourceId?: string;     // upstream candidate id
  bucketItemId?: string; // set when this stop satisfies a bucket item
  note?: string;
}

const ALLOWED_KINDS = new Set([
  "event",
  "restaurant",
  "bar",
  "activity",
  "bucket",
  "walk",
  "break",
]);

// ---- CORS (so the app / a browser tool can call it) -------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---- System prompt (per product spec) ---------------------------------------

const SYSTEM_PROMPT = `You are a sharp, opinionated NYC local who builds tight day plans.

Build ONE ordered, walkable itinerary that fits entirely inside the given time window for the given date. Rules:
- WALKABLE: order stops to minimize back-and-forth; keep consecutive stops close, ideally in the same or adjacent neighborhoods. Insert a "walk" item between stops that are more than a few blocks apart.
- TIME: every stop's startTime/endTime must fall within the window and not overlap. Leave realistic transit/seating gaps. Do not exceed the window's end.
- PRICE: respect the price range (tiers 1..4 = $..$$$$). Do not exceed the max tier.
- PRIORITIZE THE BUCKET LIST: if a provided bucket item fits the window, neighborhoods, and price, weave it in and set its bucketItemId. Prefer including at least one when feasible.
- VARY THE DAY: mix kinds (food, drinks, activity, event) — do not stack three of the same kind in a row unless the user asked for it via the modifier.
- HONOR THE MODIFIER if present (e.g. "more-food", "more-active", "cheaper", "surprise") by biasing selection accordingly.
- NEVER INVENT VENUES. Use ONLY the candidates provided in events, places, and bucketList. Every "event"/"restaurant"/"bar"/"activity"/"bucket" item MUST reuse a provided candidate's id (as sourceId, and as bucketItemId for bucket items) and its real name/neighborhood/price/coordinates. The only items you may originate are "walk" and "break" connectors (give those a synthetic id like "walk-1").

OUTPUT FORMAT — CRITICAL:
Return ONLY a JSON array of PlanItem objects. No prose, no explanation, no markdown, no code fences.
Each PlanItem: { "id": string, "order": number, "kind": "event|restaurant|bar|activity|bucket|walk|break", "title": string, "neighborhood"?: string, "startTime": "HH:MM", "endTime": "HH:MM", "priceTier"?: number, "lat"?: number, "lng"?: number, "address"?: string, "bookingUrl"?: string, "sourceId"?: string, "bucketItemId"?: string, "note"?: string }
order is 0-based and strictly increasing. Times are 24h "HH:MM" America/New_York local.`;

function buildUserMessage(req: PlanRequest): string {
  // Hand the model a compact, explicit candidate set. Keep it as data, not prose,
  // so it is easy to copy ids/names from and hard to hallucinate around.
  return [
    `DATE: ${req.date} (America/New_York)`,
    `WINDOW: ${req.window.start}–${req.window.end}`,
    `NEIGHBORHOODS: ${req.neighborhoods.join(", ") || "(any)"}`,
    `PRICE RANGE (tiers): ${req.price.min}..${req.price.max}`,
    `PARTY SIZE: ${req.partySize}`,
    `INTERESTS: ${req.interests.join(", ") || "(none given)"}`,
    req.modifier ? `MODIFIER: ${req.modifier}` : `MODIFIER: (none)`,
    ``,
    `BUCKET LIST (prioritize when they fit):`,
    JSON.stringify(req.bucketList, null, 0),
    ``,
    `EVENT CANDIDATES (use ONLY these):`,
    JSON.stringify(req.events, null, 0),
    ``,
    `PLACE CANDIDATES (use ONLY these):`,
    JSON.stringify(req.places, null, 0),
    ``,
    `Return the PlanItem[] JSON array now.`,
  ].join("\n");
}

// ---- Defensive parsing ------------------------------------------------------

// Strip ```json fences / leading prose and isolate the outermost JSON array.
function extractJsonArray(raw: string): string {
  let s = raw.trim();
  // Remove fenced code blocks if the model wrapped output despite instructions.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Isolate from first '[' to last ']' to drop any stray prose.
  const first = s.indexOf("[");
  const last = s.lastIndexOf("]");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s.trim();
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

// Validate + normalize one raw object into a PlanItem, or return null if invalid.
function coercePlanItem(raw: any, fallbackOrder: number): PlanItem | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = String(raw.kind ?? "").trim();
  const title = String(raw.title ?? "").trim();
  const startTime = String(raw.startTime ?? "").trim();
  const endTime = String(raw.endTime ?? "").trim();
  if (!ALLOWED_KINDS.has(kind)) return null;
  if (!title) return null;
  if (!/^\d{2}:\d{2}$/.test(startTime)) return null;
  if (!/^\d{2}:\d{2}$/.test(endTime)) return null;

  const item: PlanItem = {
    id: String(raw.id ?? `${kind}-${fallbackOrder}`),
    order: isFiniteNumber(raw.order) ? raw.order : fallbackOrder,
    kind,
    title,
    startTime,
    endTime,
  };
  if (raw.neighborhood != null) item.neighborhood = String(raw.neighborhood);
  if (isFiniteNumber(raw.priceTier)) item.priceTier = raw.priceTier;
  if (isFiniteNumber(raw.lat)) item.lat = raw.lat;
  if (isFiniteNumber(raw.lng)) item.lng = raw.lng;
  if (raw.address != null) item.address = String(raw.address);
  if (raw.bookingUrl != null) item.bookingUrl = String(raw.bookingUrl);
  if (raw.sourceId != null) item.sourceId = String(raw.sourceId);
  if (raw.bucketItemId != null) item.bucketItemId = String(raw.bucketItemId);
  if (raw.note != null) item.note = String(raw.note);
  return item;
}

// Parse a model response body into a validated PlanItem[]; throws on failure.
function parsePlanItems(text: string): PlanItem[] {
  const jsonStr = extractJsonArray(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (_e) {
    throw new Error("model did not return valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("model JSON was not an array");
  }
  const items: PlanItem[] = [];
  parsed.forEach((raw, i) => {
    const item = coercePlanItem(raw, i);
    if (item) items.push(item);
  });
  if (items.length === 0) {
    throw new Error("no valid PlanItems in model output");
  }
  // Re-index order to be 0-based and contiguous after filtering.
  items.sort((a, b) => a.order - b.order);
  items.forEach((it, i) => (it.order = i));
  return items;
}

// ---- Anthropic call ---------------------------------------------------------

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data: any = await res.json();
  // Messages API returns content as an array of blocks; concatenate text blocks.
  const text: string = Array.isArray(data?.content)
    ? data.content
        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("")
    : "";
  if (!text) throw new Error("Anthropic returned no text content");
  return text;
}

// ---- Request validation -----------------------------------------------------

function validateRequest(body: any): { ok: true; req: PlanRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be a JSON object" };
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return { ok: false, error: "date must be 'YYYY-MM-DD'" };
  }
  const w = body.window;
  if (!w || typeof w.start !== "string" || typeof w.end !== "string") {
    return { ok: false, error: "window must be { start: 'HH:MM', end: 'HH:MM' }" };
  }
  const p = body.price;
  if (!p || !isFiniteNumber(p.min) || !isFiniteNumber(p.max)) {
    return { ok: false, error: "price must be { min: number, max: number }" };
  }
  const req: PlanRequest = {
    date: body.date,
    window: { start: w.start, end: w.end },
    neighborhoods: Array.isArray(body.neighborhoods) ? body.neighborhoods.map(String) : [],
    price: { min: p.min, max: p.max },
    partySize: isFiniteNumber(body.partySize) ? body.partySize : 1,
    interests: Array.isArray(body.interests) ? body.interests.map(String) : [],
    bucketList: Array.isArray(body.bucketList) ? body.bucketList : [],
    events: Array.isArray(body.events) ? body.events : [],
    places: Array.isArray(body.places) ? body.places : [],
    modifier: typeof body.modifier === "string" ? body.modifier : undefined,
  };
  if ((req.events.length + req.places.length + req.bucketList.length) === 0) {
    return { ok: false, error: "no candidates provided (events, places, bucketList all empty)" };
  }
  return { ok: true, req };
}

// ---- Handler ----------------------------------------------------------------

// @ts-ignore Deno global is available in the edge runtime.
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  // @ts-ignore Deno global.
  const apiKey: string | undefined = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ ok: false, error: "ANTHROPIC_API_KEY secret is not set" }, 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_e) {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  const validated = validateRequest(body);
  if (!validated.ok) {
    return json({ ok: false, error: validated.error }, 400);
  }
  const req = validated.req;

  const userMessage = buildUserMessage(req);

  // Attempt 1.
  try {
    const text = await callAnthropic(apiKey, SYSTEM_PROMPT, userMessage);
    const items = parsePlanItems(text);
    return json({ ok: true, items, generatedBy: "llm" });
  } catch (firstErr) {
    // Attempt 2 — one stricter retry that hammers on the format contract.
    const stricterSystem =
      SYSTEM_PROMPT +
      `\n\nIMPORTANT: Your previous reply was not parseable. Respond with ONLY a raw JSON array of PlanItem objects. The very first character of your reply MUST be "[" and the last MUST be "]". No prose. No markdown. No code fences. No trailing commentary.`;
    try {
      const text = await callAnthropic(apiKey, stricterSystem, userMessage);
      const items = parsePlanItems(text);
      return json({ ok: true, items, generatedBy: "llm" });
    } catch (secondErr) {
      const msg =
        secondErr instanceof Error ? secondErr.message : String(secondErr);
      const firstMsg =
        firstErr instanceof Error ? firstErr.message : String(firstErr);
      // Caller (app) should fall back to the on-device heuristic planner.
      return json(
        { ok: false, error: `LLM planning failed: ${msg} (first attempt: ${firstMsg})` },
        502,
      );
    }
  }
});
