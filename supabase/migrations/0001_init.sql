-- =============================================================================
-- OutNYC — initial schema (0001_init.sql)
-- =============================================================================
-- Pasteable into the Supabase SQL editor (Project -> SQL Editor -> New query).
--
-- This is a FUTURE-SWAP artifact. v1 of OutNYC runs entirely on-device against
-- AsyncStorage behind the Repository interface (lib/storage). Nothing here is
-- required to RUN v1. When you later add a Supabase-backed Repository, this
-- migration creates a schema that mirrors the on-device domain types so the
-- swap is a 1:1 mapping (no screen changes).
--
-- Single-user v1: every table carries a `user_id` that DEFAULTS to a fixed
-- sentinel ('00000000-0000-0000-0000-000000000000'). This lets v1 ignore auth
-- entirely while leaving the door open for real multi-user later — just start
-- populating user_id from auth.uid() and flip on the RLS policies at the bottom.
--
-- Domain mapping (keep in sync with lib/types.ts):
--   profile     <- Profile            (single row in v1)
--   availability<- Availability       (one row per date, window list as JSONB)
--   bucket_list <- BucketItem
--   plan        <- Plan               (the packed itinerary for a date+window)
--   plan_item   <- PlanItem           (ordered stops inside a plan)
--   feedback    <- Feedback           (thumbs / reshuffle signals per plan)
-- =============================================================================

-- Needed for gen_random_uuid().
create extension if not exists "pgcrypto";

-- Fixed single-user sentinel for v1. Swap the DEFAULTs to auth.uid() for multi-user.
-- (Declared as a comment-constant; referenced literally below.)

-- -----------------------------------------------------------------------------
-- profile : one row describing the single user's defaults.
--   Mirrors Profile { partySize, defaultNeighborhoods[], priceRange, interests[], homeBase? }
-- -----------------------------------------------------------------------------
create table if not exists public.profile (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default '00000000-0000-0000-0000-000000000000',
  display_name         text,
  -- party size for itineraries (1 = solo).
  party_size           integer not null default 1 check (party_size between 1 and 20),
  -- preferred NYC neighborhoods, e.g. {'West Village','Lower East Side'}.
  default_neighborhoods text[] not null default '{}',
  -- price range as a $..$$$$ tier (1..4), inclusive lo/hi.
  price_min            integer not null default 1 check (price_min between 1 and 4),
  price_max            integer not null default 4 check (price_max between 1 and 4),
  -- free-text interest tags used to bias the planner.
  interests            text[] not null default '{}',
  -- optional "home base" the planner can start/end walks from.
  home_base_label      text,
  home_base_lat        double precision,
  home_base_lng        double precision,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint profile_price_range_ck check (price_min <= price_max),
  -- one profile per user in v1.
  constraint profile_user_unique unique (user_id)
);

-- -----------------------------------------------------------------------------
-- availability : free-time windows the user marked for a given local date.
--   Mirrors Availability { date 'YYYY-MM-DD', windows: TimeWindow[] }
--   where TimeWindow = { start 'HH:MM', end 'HH:MM' }.
--   Stored as one row per date with the windows as a JSONB array, matching the
--   on-device shape exactly (a date maps to a list of windows).
-- -----------------------------------------------------------------------------
create table if not exists public.availability (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default '00000000-0000-0000-0000-000000000000',
  -- America/New_York local date as 'YYYY-MM-DD'.
  date        date not null,
  -- [{ "start": "HH:MM", "end": "HH:MM" }, ...] — 24h local times.
  windows     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- one availability row per (user, date).
  constraint availability_user_date_unique unique (user_id, date)
);

create index if not exists availability_user_date_idx
  on public.availability (user_id, date);

-- -----------------------------------------------------------------------------
-- bucket_list : aspirational items the planner tries to weave in.
--   Mirrors BucketItem { id, title, note?, neighborhood?, priceTier?, done }
-- -----------------------------------------------------------------------------
create table if not exists public.bucket_list (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default '00000000-0000-0000-0000-000000000000',
  title        text not null,
  note         text,
  neighborhood text,
  -- optional price tier 1..4 if the item has a known cost band.
  price_tier   integer check (price_tier between 1 and 4),
  -- optional tag bias so the planner can match interests.
  tags         text[] not null default '{}',
  done         boolean not null default false,
  -- user-controlled ordering / priority (lower = surfaced sooner).
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists bucket_list_user_idx
  on public.bucket_list (user_id, done, sort_order);

-- -----------------------------------------------------------------------------
-- plan : a packed itinerary for one (date, window).
--   Mirrors Plan { id, date, window, neighborhoods[], price, partySize,
--                  generatedBy, modifier?, items: PlanItem[] }
--   items live in plan_item (FK), not inline, so they can be reordered/queried.
-- -----------------------------------------------------------------------------
create table if not exists public.plan (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default '00000000-0000-0000-0000-000000000000',
  date          date not null,
  -- the window this plan fills, as 'HH:MM' local strings.
  window_start  text not null,
  window_end    text not null,
  -- snapshot of the inputs the plan was generated against.
  neighborhoods text[] not null default '{}',
  price_min     integer not null default 1 check (price_min between 1 and 4),
  price_max     integer not null default 4 check (price_max between 1 and 4),
  party_size    integer not null default 1 check (party_size between 1 and 20),
  -- which planner produced this: 'heuristic' (default v1) | 'llm' | 'manual'.
  generated_by  text not null default 'heuristic'
                  check (generated_by in ('heuristic', 'llm', 'manual')),
  -- optional reshuffle modifier, e.g. 'more-food' | 'more-active' | 'cheaper' | 'surprise'.
  modifier      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint plan_price_range_ck check (price_min <= price_max)
);

create index if not exists plan_user_date_idx
  on public.plan (user_id, date);

-- -----------------------------------------------------------------------------
-- plan_item : one ordered stop inside a plan.
--   Mirrors PlanItem {
--     id, order, kind, title, neighborhood?, startTime 'HH:MM', endTime 'HH:MM',
--     priceTier?, lat?, lng?, address?, bookingUrl?, sourceId?, bucketItemId?,
--     note?
--   }
--   `kind` matches the on-device union of stop types.
-- -----------------------------------------------------------------------------
create table if not exists public.plan_item (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default '00000000-0000-0000-0000-000000000000',
  plan_id        uuid not null references public.plan (id) on delete cascade,
  -- 0-based position within the plan.
  position       integer not null,
  -- stop type: 'event' | 'restaurant' | 'bar' | 'activity' | 'bucket' | 'walk' | 'break'.
  kind           text not null
                   check (kind in ('event','restaurant','bar','activity','bucket','walk','break')),
  title          text not null,
  neighborhood   text,
  -- 'HH:MM' local start/end for this stop.
  start_time     text not null,
  end_time       text not null,
  price_tier     integer check (price_tier between 1 and 4),
  lat            double precision,
  lng            double precision,
  address        text,
  -- deep-link out for "Book"/"Tickets" — the app only Linking-opens this, never auto-books.
  booking_url    text,
  -- id of the upstream candidate (event/place) this stop came from, if any.
  source_id      text,
  -- if this stop satisfies a bucket item, link it back.
  bucket_item_id uuid references public.bucket_list (id) on delete set null,
  note           text,
  created_at     timestamptz not null default now(),
  -- one item per position within a plan.
  constraint plan_item_plan_position_unique unique (plan_id, position)
);

create index if not exists plan_item_plan_idx
  on public.plan_item (plan_id, position);

-- -----------------------------------------------------------------------------
-- feedback : signals the user gives on a plan (thumbs / reshuffles).
--   Mirrors Feedback { id, planId, signal, planItemId?, note?, createdAt }
-- -----------------------------------------------------------------------------
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default '00000000-0000-0000-0000-000000000000',
  plan_id      uuid not null references public.plan (id) on delete cascade,
  -- optional: feedback aimed at a single stop rather than the whole plan.
  plan_item_id uuid references public.plan_item (id) on delete cascade,
  -- 'up' | 'down' | 'reshuffle' | 'completed' | 'skipped'.
  signal       text not null
                 check (signal in ('up','down','reshuffle','completed','skipped')),
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists feedback_plan_idx
  on public.feedback (plan_id);

-- -----------------------------------------------------------------------------
-- updated_at trigger (keeps updated_at fresh on UPDATE).
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['profile','availability','bucket_list','plan']
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at();', t, t);
  end loop;
end;
$$;

-- =============================================================================
-- SEED — mirrors the on-device seed in lib/constants.ts so a fresh Supabase
-- project matches a fresh install. Uses the v1 single-user sentinel.
-- Idempotent: safe to re-run (on conflict do nothing).
-- =============================================================================

-- Profile (single row).
insert into public.profile
  (user_id, display_name, party_size, default_neighborhoods, price_min, price_max, interests, home_base_label)
values
  ('00000000-0000-0000-0000-000000000000',
   'You',
   2,
   array['West Village','Lower East Side','Williamsburg'],
   1,
   3,
   array['live music','food','art','outdoors'],
   'West Village')
on conflict (user_id) do nothing;

-- Bucket list seed items (mirror lib/constants seed BUCKET_SEED).
insert into public.bucket_list
  (user_id, title, note, neighborhood, price_tier, tags, done, sort_order)
values
  ('00000000-0000-0000-0000-000000000000', 'Catch sunset on the High Line',          'Best near sunset; walk the whole stretch.', 'Chelsea',          1, array['outdoors','walk'],      false, 0),
  ('00000000-0000-0000-0000-000000000000', 'Jazz set at the Village Vanguard',        'Reserve ahead; iconic basement room.',      'West Village',     3, array['live music'],          false, 1),
  ('00000000-0000-0000-0000-000000000000', 'Slice crawl: 2 Bros, Stromboli, then Artichoke', 'Three East Village classics in one walkable night — St. Marks Pl to 14th St, one slice each.', 'East Village', 1, array['food'],       false, 2),
  ('00000000-0000-0000-0000-000000000000', 'Smorgasburg on a Saturday',               'Go hungry; cash + card.',                   'Williamsburg',     2, array['food','outdoors'],     false, 3),
  ('00000000-0000-0000-0000-000000000000', 'Late-night ramen at Ippudo',              'Rich pork-broth bowls on 4th Ave — the kitchen runs late for the after-show crowd.', 'East Village', 2, array['food','late-night'], false, 4),
  ('00000000-0000-0000-0000-000000000000', 'Rooftop drinks at Overstory',             'Sunset over the harbor from the 64th floor — reserve ahead.', 'Financial District', 3, array['bar','rooftop'],  false, 5),
  ('00000000-0000-0000-0000-000000000000', 'Brooklyn Bridge walk at golden hour',     'Start Manhattan side, end in DUMBO.',       'DUMBO',            1, array['outdoors','walk'],     false, 6),
  ('00000000-0000-0000-0000-000000000000', 'See a show at the Comedy Cellar',         'Standby line moves fast on weeknights.',    'West Village',     2, array['comedy'],              false, 7)
on conflict do nothing;

-- =============================================================================
-- ROW LEVEL SECURITY (commented out for v1).
-- v1 is single-user with no auth, so RLS stays OFF. When you add Supabase auth
-- for multi-user, (1) change every `user_id` DEFAULT to remove the sentinel and
-- set it from auth.uid() on insert, then (2) enable RLS and the policies below.
-- =============================================================================
-- alter table public.profile      enable row level security;
-- alter table public.availability enable row level security;
-- alter table public.bucket_list  enable row level security;
-- alter table public.plan         enable row level security;
-- alter table public.plan_item    enable row level security;
-- alter table public.feedback     enable row level security;
--
-- create policy "own rows" on public.profile      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- create policy "own rows" on public.availability for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- create policy "own rows" on public.bucket_list  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- create policy "own rows" on public.plan         for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- create policy "own rows" on public.plan_item    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- create policy "own rows" on public.feedback     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
