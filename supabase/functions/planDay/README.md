# `planDay` Edge Function

The secure, server-side path for **live LLM planning** in OutNYC. It calls the
Anthropic Messages API using a function secret: the API key never touches the
app bundle. The model defaults to `claude-sonnet-4-6` and can be overridden
without a redeploy via the optional `ANTHROPIC_MODEL` secret (see Deploy below).

> v1 of OutNYC does **not** need this. The app ships a deterministic on-device
> heuristic planner and runs fully offline with zero keys. Deploy this only when
> you want to opt into smarter, LLM-generated itineraries.

## What it does

`POST` a `PlanRequest` and get back a validated `PlanItem[]`:

```jsonc
// Request body
{
  "date": "2026-07-04",
  "window": { "start": "18:00", "end": "23:00" },
  "neighborhoods": ["West Village", "East Village"],
  "price": { "min": 1, "max": 3 },
  "partySize": 2,
  "interests": ["live music", "food"],
  "bucketList": [ { "id": "b1", "title": "Jazz at the Village Vanguard", "neighborhood": "West Village", "priceTier": 3 } ],
  "events":     [ { "id": "e1", "name": "...", "kind": "event", "neighborhood": "...", "startTime": "20:00", "endTime": "22:00" } ],
  "places":     [ { "id": "p1", "name": "...", "kind": "restaurant", "neighborhood": "...", "priceTier": 2 } ],
  "modifier":   "more-food"
}
```

```jsonc
// Success response
{ "ok": true, "generatedBy": "llm", "items": [ /* PlanItem[] */ ] }

// Failure response (caller should fall back to the on-device heuristic planner)
{ "ok": false, "error": "LLM planning failed: ..." }
```

The model is instructed to use **only** the provided candidates (never invent
venues), keep stops inside the window, respect price, prioritize bucket-list
items, and return **strict JSON** (a bare `PlanItem[]`, no prose/fences). The
function parses defensively (strips fences, validates each item) and does one
stricter retry before returning a failure.

## Deploy

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# 1. Link the repo to your project (once).
supabase link --project-ref <YOUR_PROJECT_REF>

# 2. Set the function secret (the Anthropic key lives ONLY here, server-side).
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# 2b. (optional) Override the model without editing code / redeploying.
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-6

# 3. Deploy the function.
supabase functions deploy planDay
```

Get an Anthropic key at https://console.anthropic.com/ (Settings → API Keys).

## Call it from the app

```ts
const res = await fetch(
  `https://<YOUR_PROJECT_REF>.functions.supabase.co/planDay`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(planRequest),
  },
);
const data = await res.json();
if (!data.ok) {
  // fall back to the on-device heuristic planner
}
```

Wire this behind the `Planner` interface as an optional adapter; the heuristic
planner stays the default.

## Local test

```bash
supabase functions serve planDay --env-file ./supabase/.env.local
# then POST a PlanRequest to http://localhost:54321/functions/v1/planDay
```

Put `ANTHROPIC_API_KEY=sk-ant-...` in `./supabase/.env.local` for local runs
(that file is gitignored: never commit a key).

## Security note

This is the **recommended secure path**: the key is a function secret and is
never shipped to the client. Prefer this over the `EXPO_PUBLIC_*` direct-from-
client adapters for anything LLM-related.
