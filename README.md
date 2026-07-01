# OutNYC

A single-user (no login) NYC plan-maker for your phone. Tell it when you're free,
which neighborhood you want to be in, and your price range — it pulls events and
restaurants and packs each free-time window into an **ordered, walkable
itinerary**, weaving in your bucket-list items, with local-notification nudges so
you actually go.

Built with **Expo (React Native) + TypeScript**. Runs in **Expo Go** on your
iPhone with **no native build step**.

> **Status:** v1 runs entirely on **mock/seed data** — onboarding, week view,
> setting availability, "Plan this day", reshuffle, bucket list, and settings all
> work with **zero API keys and no credit card**. Live data sources (events,
> places) light up progressively as you add keys; smarter LLM planning is an
> opt-in via a secure server-side function (see [Going live later](#going-live-later)).

---

## Run it

You need [Node](https://nodejs.org/) and the **Expo Go** app on your iPhone
(App Store). No Xcode, no native build.

```bash
npm install
npx expo install --fix     # aligns native deps to your Expo SDK
npx expo start
```

Then scan the QR code in the terminal with the **Camera app** (iOS) and open it
in **Expo Go**. That's it — the app boots straight into a fully working demo on
mock data. **No keys. No cards. No accounts.**

---

## What you can do on mock data (zero keys)

- **Onboarding** — set party size, neighborhoods, price range, interests.
- **Week view** — see your next 7 days (America/New_York local).
- **Set availability** — add free-time windows per day (`HH:MM`–`HH:MM`).
- **Plan this day** — the deterministic heuristic planner packs each window into
  an ordered, walkable itinerary from seed events + restaurants.
- **Reshuffle** — re-pack a day with a modifier (more food / more active /
  cheaper / surprise me).
- **Bucket list** — manage aspirational items; the planner prioritizes weaving
  them in when they fit.
- **Settings** — view your defaults, enable local notifications, and see which
  data sources are detected as **Live** vs **Mock** (going live is opt-in via a
  local `.env` — Settings shows the status, it doesn't store keys).

Everything persists on-device via AsyncStorage (behind a `Repository`
interface, so a Supabase backend can be added later without touching screens).

---

## What's mocked vs live

| Capability        | Mock (default, zero-key)                     | Live (opt-in)                                       | Needs a card? |
| ----------------- | -------------------------------------------- | --------------------------------------------------- | ------------- |
| Events            | Curated NYC seed events                      | **Ticketmaster Discovery API** ¹                    | No            |
| Restaurants/places| Curated NYC seed places                      | **Google Places API** ¹                             | **Yes**       |
| Day planning      | **Deterministic on-device heuristic**        | Anthropic via secure Supabase **edge function** ²   | No ³          |
| Persistence       | On-device AsyncStorage                       | Supabase (future swap)                              | No (free tier)|
| Notifications     | Local notifications (Expo)                   | same — always local                                 | No            |
| Booking/Tickets   | "Book"/"Tickets" deep-link out via `Linking` | same — **never auto-books**                         | No            |

¹ The events/places adapters expose `{ name, isLive }` and flip to a live branch
when their key is present, falling back to seed data on any error. In **this v1
the live branch is a stub that still returns seed data** (each adapter carries a
`TODO(prod)` to drop in the real API call) — so the wiring, flags, and Settings
badges are real, but turning on a key won't change the data until the stub is
filled in.

² The on-device heuristic planner is **always the planner the app uses today**.
The only live-LLM path that is actually built is the server-side
[`supabase/functions/planDay`](supabase/functions/planDay/) edge function
(Anthropic). It is a deploy-it-yourself artifact, not auto-wired into a screen —
you add it behind the `Planner` interface as an optional adapter (the README in
that folder shows how). A client-side **Gemini** planner is scaffolded as a
config flag only (see below) and is **not yet implemented**.

³ No card to use the edge function itself; the Anthropic Messages API it calls is
paid usage.

The heuristic planner is always the **default**. Providers and planners each
expose `{ name, isLive }`; a missing key/flag means that source serves mock data
(or returns an empty result with a clear flag), so a missing key never crashes a
screen.

---

## Going live later

All of these are **opt-in**. Add the relevant key to a local `.env` (copy
`.env.example`), restart `npx expo start`, and its **Live** badge appears in
Settings → Data sources. Leave them out and the app stays on mock data.

| Provider              | Cost                                  | Card? | Get a key                                                                 |
| --------------------- | ------------------------------------- | :---: | ------------------------------------------------------------------------- |
| **Ticketmaster** (events)      | Free, instant                | No    | https://developer.ticketmaster.com/                                       |
| **Gemini** (planning) | Free tier, no card                    |  No   | https://aistudio.google.com/app/apikey                                    |
| **Google Places** (restaurants)| Free per-SKU monthly credit, then pay | **Yes** | https://console.cloud.google.com/google/maps-apis              |
| **Anthropic** (planning, secure) | Pay-as-you-go              |  No*  | https://console.anthropic.com/  (used via the Supabase edge function)     |

\* No card to get an Anthropic key, but the Messages API is paid usage. The
recommended way to use it is the **secure edge-function path** (below), not a
client key.

**What each key does today:**

- **Ticketmaster** / **Google Places** — recognized by `lib/config.ts`, flip the
  provider's `isLive` flag, and show a **Live** badge. The live fetch itself is
  still a seed-returning stub in v1 (see note ¹ above).
- **Gemini** — recognized and shown as a **Live** flag in Settings, but there is
  **no client Gemini planner adapter yet**, so adding this key does not change
  how days are planned. It's reserved for a future adapter; the heuristic planner
  stays in use. For live LLM planning today, deploy the edge function below.
- **Anthropic** — not an `EXPO_PUBLIC_*` key at all. It lives **only** as a
  secret inside the Supabase edge function (never in the app bundle). This is the
  one live-LLM path that actually works.

### Env vars

Copy the template and fill in only what you want live:

```bash
cp .env.example .env
```

```dotenv
# All optional. Absent = that feature stays on mock data.
EXPO_PUBLIC_TICKETMASTER_API_KEY=
EXPO_PUBLIC_GEMINI_API_KEY=
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=
# Supabase (future swap; optional)
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

---

## Key security note

For this **personal v1**, live provider modules call third-party APIs directly
from the client using `EXPO_PUBLIC_*` env vars. **Be aware:** any `EXPO_PUBLIC_*`
value is bundled into the app and is therefore visible to anyone with the build —
it is **not secret**. This is an accepted tradeoff for a single-user personal app.
Each live adapter carries a `TODO` noting that production should route the key
through a server/edge function instead.

For the LLM planner specifically, prefer the **secure edge-function path** over
embedding a key: see [`supabase/functions/planDay`](supabase/functions/planDay/).
The Anthropic key lives there as a **function secret** and never ships in the
bundle.

---

## Supabase future-swap note

v1 is fully on-device. The repo ships **future-swap artifacts** so a Supabase
backend can be added later **without touching any screen** (just add a new
implementation behind the existing `Repository` / `Planner` interfaces):

- **`supabase/migrations/0001_init.sql`** — schema for `profile`, `availability`,
  `bucket_list`, `plan`, `plan_item`, and `feedback`, mirroring the on-device
  domain types. Single-user v1, with a `user_id` column defaulted to a sentinel
  so multi-user + RLS can be switched on later (commented policies included).
  Includes a seed (profile + bucket items) that mirrors the on-device seed.
  Pasteable into the Supabase SQL editor.
- **`supabase/functions/planDay/`** — a Deno edge function that runs the LLM
  planner securely server-side (Anthropic, key as a function secret). The model
  defaults to `claude-sonnet-4-6` and is overridable via the `ANTHROPIC_MODEL`
  secret. See its [README](supabase/functions/planDay/README.md) for deploy +
  secret steps. This is the secure path for live LLM planning.

When you swap in Supabase: run the migration, deploy the function, set the
secrets, add a `SupabaseRepository` and (optionally) an edge-function `Planner`
adapter — screens stay untouched because they only depend on the interfaces.

---

## Project layout

```
app/                     # expo-router screens (file-based routing)
  _layout.tsx            #   root Stack + store bootstrap
  index.tsx              #   entry gate -> onboarding or week
  onboarding.tsx         #   party size / neighborhoods / price / interests
  (tabs)/                #   bottom tabs: week, bucket, settings
  day/[date].tsx         #   set availability windows for a day
  plan/[date].tsx        #   "Plan this day", reshuffle, lock-in
components/              # themed UI primitives + PlanItemCard
lib/
  types.ts               # domain types (Profile, Availability, BucketItem, Plan, PlanItem, Feedback)
  config.ts              # env + provider flags ({ name, isLive })
  constants.ts           # NYC seed data: events, places, bucket-list seed
  theme.ts               # design tokens (no hardcoded hex in screens)
  time.ts                # America/New_York date + 'HH:MM' helpers
  store.ts               # zustand store (wires repo + planner + providers + notifications)
  notifications.ts       # local-only expo-notifications scheduling
  storage/               # Repository interface + AsyncStorage implementation
  planner/               # Planner interface + deterministic heuristic (default)
  providers/             # events/places providers (degrade to seed data)
supabase/
  migrations/0001_init.sql
  functions/planDay/     # secure LLM-planning edge function (future)
.env.example
```

> Time handling: all "today"/date/window logic is **America/New_York** local.
> Dates are `'YYYY-MM-DD'` strings; window times are `'HH:MM'` 24h strings.
