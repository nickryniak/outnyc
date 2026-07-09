// =============================================================================
// OutNYC: zustand store (lib/store.ts)
// =============================================================================
// The single app store. Wires the Repository, default Planner, and providers
// together. Screens read state + call actions; they never touch the repository
// or planner directly.
//
// Planning rules implemented here:
//   - AUTO-PLANNING: setting or moving a free-time window plans it immediately
//     (no "Plan this day" button); moving a window releases its old plan's
//     venues so the re-plan can keep them.
//   - Per-day preferences (neighborhoods/price/party/interests) override the
//     profile defaults for that day only.
//   - Never-repeat: every candidate a day has been shown lands in seenByDate;
//     planning, reshuffles, and swaps exclude everything seen ANYWHERE in the
//     same Mon-Sun week. If that leaves a window with NOTHING, the exclusion
//     falls back to this date only (same-day repeats stay impossible): a
//     venue from earlier in the week beats a dead window.
//   - Reshuffle verbs: day (reshuffleDay) and single block (swapPlanItem /
//     alternativesForItem, with optional intent).
// =============================================================================

import { create } from 'zustand';

import { isListHeader, parseBucketText } from './bucketParse';
import { BUCKET_SEED, NEIGHBORHOODS, SEED_PROFILE, STORAGE_PREFIX } from './constants';
import { holidayFor } from './holidays';
import { defaultPlanner } from './planner';
import { scoreCandidate, type ScoringContext } from './planner/scoring';
import {
  allowedStart,
  candidateDuration,
  filterToNeighborhoods,
  hash,
  matchesNeighborhoods,
  rebuildConnectors,
  sameCategory,
  venueKey,
} from './planner/slotUtils';
import { eventsProvider, placesProvider } from './providers';
import { onPersistenceError, repository } from './storage';
import { addDays, fromMinutes, isValidWindow, mondayOf, todayNY, toMinutes, weekDates } from './time';
import type {
  Availability,
  BucketItem,
  Candidate,
  DayPrefs,
  Plan,
  PlanItem,
  PlanModifier,
  PriceRange,
  Profile,
  TimeWindow,
} from './types';

/** Status for the one-time bootstrap load. */
type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Status of an in-flight plan generation for a specific window key. */
export interface PlanningState {
  status: 'idle' | 'planning' | 'error';
  error?: string;
}

/**
 * How a per-stop swap should choose its replacement:
 *   cheaper/pricier  : best-ranked candidate below/above this stop's price,
 *                       within the SAME category as today (a dinner stays a
 *                       dinner, just pricier)
 *   surprise         : uniformly random among everything that fits the slot,
 *                       same category as today
 *   indoor           : excludes candidates tagged 'outdoors', same category
 *   everything else  : an explicit CATEGORY override: "I just want a coffee
 *                       shop" / "a park" should work no matter what's
 *                       currently scheduled here, so these search the WHOLE
 *                       slot (any kind), not just this stop's category. See
 *                       CROSS_CATEGORY_INTENTS below.
 * No intent = the top-ranked candidate, same category (the old default).
 */
export type SwapIntent = 'cheaper' | 'pricier' | 'surprise' | 'indoor' | CuisineIntent | TagIntent;

/** Intents that name a tag: pick the top-ranked option carrying this exact tag. */
type TagIntent = 'coffee' | 'rooftop' | 'live-music' | 'comedy' | 'art' | 'outdoors' | 'film';
const TAG_INTENTS: Record<TagIntent, string> = {
  coffee: 'coffee',
  rooftop: 'rooftop',
  'live-music': 'live music',
  comedy: 'comedy',
  art: 'art',
  outdoors: 'outdoors',
  film: 'film',
};

/**
 * Intents that name a cuisine: pick the top-ranked option with this exact
 * cuisine. Values are the exact labels placesProvider emits (its CUISINE_TYPES
 * mapping for live results; lib/constants seed data uses the same labels).
 */
type CuisineIntent =
  | 'italian'
  | 'pizza'
  | 'japanese'
  | 'french'
  | 'southern'
  | 'greek'
  | 'deli'
  | 'mediterranean'
  | 'peruvian'
  | 'bakery'
  | 'thai'
  | 'chinese'
  | 'korean'
  | 'indian'
  | 'mexican'
  | 'sushi'
  | 'seafood'
  | 'steakhouse'
  | 'vegan';
const CUISINE_INTENTS: Record<CuisineIntent, string> = {
  italian: 'Italian',
  pizza: 'Pizza',
  japanese: 'Japanese',
  french: 'French',
  southern: 'Southern',
  greek: 'Greek',
  deli: 'Deli',
  mediterranean: 'Mediterranean',
  peruvian: 'Peruvian',
  bakery: 'Bakery',
  thai: 'Thai',
  chinese: 'Chinese',
  korean: 'Korean',
  indian: 'Indian',
  mexican: 'Mexican',
  sushi: 'Sushi',
  seafood: 'Seafood',
  steakhouse: 'Steakhouse',
  vegan: 'Vegan',
};

function isCuisineIntent(intent: SwapIntent): intent is CuisineIntent {
  return intent in CUISINE_INTENTS;
}

function isTagIntent(intent: SwapIntent): intent is TagIntent {
  return intent in TAG_INTENTS;
}

/**
 * Intents that name an explicit category (a cuisine or a tag) rather than a
 * relative adjustment. These search every kind of candidate for the slot:
 * "Coffee" or "Outdoors" should surface a coffee shop / a park even when the
 * stop you're swapping is currently a dinner or a show.
 */
export const CROSS_CATEGORY_INTENTS = new Set<SwapIntent>([
  ...(Object.keys(TAG_INTENTS) as SwapIntent[]),
  ...(Object.keys(CUISINE_INTENTS) as SwapIntent[]),
]);

/** The preferences the planner actually uses for a date (day prefs + defaults). */
export interface ResolvedPrefs {
  neighborhoods: string[];
  price: PriceRange;
  partySize: number;
  interests: string[];
}

interface StoreState {
  // ---- bootstrap ----
  loadStatus: LoadStatus;
  loadError?: string;

  // ---- domain ----
  profile: Profile | null;
  availabilityByDate: Record<string, Availability>;
  bucketList: BucketItem[];
  plansByKey: Record<string, Plan>; // key: `${date}|${start}|${end}`
  dayPrefsByDate: Record<string, DayPrefs>;
  seenByDate: Record<string, string[]>; // never-repeat memory per date

  // ---- transient ----
  planning: Record<string, PlanningState>; // keyed like plansByKey
  /**
   * True once any storage write has failed (quota exceeded, storage blocked):
   * in-memory state is still correct, but changes will NOT survive a reload,
   * so the UI warns instead of letting the user find out tomorrow.
   */
  persistenceBroken: boolean;
  /**
   * Per-date note from the events provider's last fetch for that date:
   * 'live-no-area-matches' means the ticketed live sources answered fine but
   * had zero in-area events, so curated seed events were substituted: the UI
   * shows this so "nothing nearby" is distinguishable from "live broken".
   */
  eventsNoteByDate: Record<string, 'live-no-area-matches'>;

  // ---- actions ----
  bootstrap(): Promise<void>;
  resetApp(): Promise<void>;
  saveProfile(profile: Profile): Promise<void>;
  completeOnboarding(profile: Omit<Profile, 'onboarded'>): Promise<void>;
  /** Mark the welcome screen as seen so the app opens straight to the calendar. */
  markEntered(): Promise<void>;

  setAvailability(date: string, windows: TimeWindow[]): Promise<void>;
  setDayPrefs(date: string, prefs: Partial<Omit<DayPrefs, 'date'>>): Promise<void>;
  clearDayPrefs(date: string): Promise<void>;
  /** Clear everything chosen for ONE day: its free time, its plans, and any day-only prefs. */
  clearDay(date: string): Promise<void>;
  /** Clear every day in the given range at once (the visible week). */
  clearWeek(dates: string[]): Promise<void>;

  addBucketItem(input: { title: string; note?: string; neighborhood?: string }): Promise<void>;
  /** Bulk-add many items at once (from a pasted list). */
  addBucketItems(
    inputs: { title: string; note?: string; neighborhood?: string; tags?: string[] }[],
  ): Promise<number>;
  toggleBucketDone(id: string): Promise<void>;
  removeBucketItem(id: string): Promise<void>;

  generatePlan(date: string, window: TimeWindow, modifier?: PlanModifier): Promise<void>;
  reshufflePlan(date: string, window: TimeWindow, modifier?: PlanModifier): Promise<void>;
  /** The single day-scope reshuffle: (re)plans every window on one date. */
  reshuffleDay(date: string): Promise<void>;
  /**
   * Swap one block for a fresh candidate in the same category + time slot.
   * Pass `replacementId` to swap to a specific candidate (from alternatives),
   * or an `intent` to steer the pick (cheaper/pricier/surprise/indoor).
   */
  swapPlanItem(
    date: string,
    window: TimeWindow,
    itemId: string,
    replacementId?: string,
    intent?: SwapIntent,
  ): Promise<boolean>;
  /** Everything that could replace a block right now (same category + slot). */
  alternativesForItem(date: string, window: TimeWindow, itemId: string): Promise<Candidate[]>;
}

export function planKey(date: string, window: TimeWindow): string {
  return `${date}|${window.start}|${window.end}`;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Re-entrancy guard so concurrent bootstrap callers don't double-seed. */
let booting = false;

/** Per-window reshuffle counter, mixed into the planner seed for fresh variety. */
const nonceByKey: Record<string, number> = {};

/**
 * GLOBAL plan-mutation queue: one chain for ALL dates. Plan generation reads
 * week-wide never-repeat state (weekSeenIds) and then commits its picks; two
 * dates planning concurrently (e.g. "Plan my whole week" fanning out over
 * seven days) could both read the same snapshot and pick the same venue
 * before either committed. One queue makes each read-check-commit atomic;
 * within a date it also preserves the sibling-window ordering the old
 * per-date queue existed for.
 */
let planQueue: Promise<void> = Promise.resolve();

/**
 * Epoch stamp for queued plan work. resetApp bumps it, which makes every
 * already-queued (or in-flight) plan task a no-op at its commit points:
 * without this, work chained onto the OLD planQueue promise would still run
 * after the wipe and write pre-reset windows/plans back to disk.
 */
let storeEpoch = 0;

function enqueuePlan(_date: string, work: () => Promise<void>): Promise<void> {
  const epoch = storeEpoch;
  const run = () => (epoch === storeEpoch ? work() : Promise.resolve());
  const next = planQueue.then(run, run);
  planQueue = next.catch(() => undefined);
  return next;
}

type SetFn = (
  partial: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>),
) => void;

/** Day prefs merged over profile defaults. */
export function resolvePrefs(
  profile: Profile,
  dayPrefs: DayPrefs | undefined,
): ResolvedPrefs {
  return {
    neighborhoods:
      dayPrefs?.neighborhoods && dayPrefs.neighborhoods.length > 0
        ? dayPrefs.neighborhoods
        : profile.defaultNeighborhoods,
    price: dayPrefs?.price ?? profile.priceRange,
    partySize: dayPrefs?.partySize ?? profile.partySize,
    interests:
      dayPrefs?.interests && dayPrefs.interests.length > 0
        ? dayPrefs.interests
        : profile.interests,
  };
}

/**
 * Never-repeat memory entries for a plan's stops: both the raw candidate id
 * AND a venue-identity key derived from the title. The venue key is what
 * catches a bucket wish ("Jazz set at the Village Vanguard") and a curated/
 * live listing for the SAME real place ("Live Jazz at the Village Vanguard")
 * as one venue, even though they carry different ids: otherwise both could
 * get scheduled as if they were two fresh, different picks.
 */
function planCandidateKeys(plan: Plan): string[] {
  const keys: string[] = [];
  for (const i of plan.items) {
    if (i.kind === 'walk' || i.kind === 'break') continue;
    keys.push(i.sourceId ?? i.bucketItemId ?? i.id);
    keys.push(venueKey(i.title));
  }
  return keys;
}

/**
 * Load everything from the repository into the store, seeding profile + bucket
 * list on first run. Shared by bootstrap() and resetApp().
 */
async function loadAllInto(set: SetFn): Promise<void> {
  // Bound storage growth FIRST: retire per-date rows older than last week so
  // years of use can never fill web localStorage (~5MB) and break every
  // write. Last week is kept so recently passed days remain inspectable.
  const weekStart = mondayOf(todayNY());
  await repository.pruneBefore(addDays(weekStart, -7));

  let profile = await repository.getProfile();
  let bucketList = await repository.getBucketList();

  // First run: seed profile + bucket list so the app is usable immediately.
  if (!profile) {
    profile = { ...SEED_PROFILE };
    await repository.saveProfile(profile);
  }
  if (bucketList.length === 0) {
    bucketList = BUCKET_SEED.map((b) => ({ ...b }));
    await repository.saveBucketList(bucketList);
  } else {
    // Healing pass for lists saved by older builds: split "mega-items" (a
    // whole pasted numbered list stored as ONE item) and refresh stale seed
    // copy, keeping the user's done/ordering.
    const healed = healBucketList(bucketList);
    if (healed) {
      bucketList = healed;
      await repository.saveBucketList(bucketList);
    }
  }

  const availabilityList = await repository.getAllAvailability();
  const availabilityByDate: Record<string, Availability> = {};
  for (const a of availabilityList) availabilityByDate[a.date] = a;

  // Restore previously generated plans, so a day you planned survives an app
  // restart. Plans whose window no longer matches the day's availability
  // (blocks resized/removed since) are healed away so no stale block floats
  // outside a green window.
  const plans = await repository.getAllPlans();
  const plansByKey: Record<string, Plan> = {};
  // An EMPTY availability read can mean "corrupt/lost key" as easily as "no
  // windows anywhere"; treating every plan as an orphan on that signal would
  // erase the user's entire itinerary history from disk. Only heal orphans
  // away when some availability positively read back; unmatched plans are
  // invisible anyway, and pruneBefore retires them once their date passes.
  const canHealOrphans = availabilityList.length > 0;
  for (const p of plans) {
    const windows = availabilityByDate[p.date]?.windows ?? [];
    const stillValid = windows.some((w) => planKey(p.date, w) === planKey(p.date, p.window));
    if (stillValid) {
      plansByKey[planKey(p.date, p.window)] = p;
    } else if (canHealOrphans) {
      await repository.deletePlan(p.id);
    }
  }

  const dayPrefsList = await repository.getAllDayPrefs();
  const dayPrefsByDate: Record<string, DayPrefs> = {};
  for (const p of dayPrefsList) dayPrefsByDate[p.date] = p;

  // Never-repeat memory is week-scoped (no venue repeats within a Mon-Sun
  // week), so keep the CURRENT week's history: including days already past:
  // and prune anything from previous weeks so it cannot grow without bound.
  const seenByDate = await repository.getSeenMap();
  // Far-future entries with no matching windows can only be typo'd/garbage
  // dates; without a forward bound they would survive the past-week prune
  // forever. Dates that still hold real availability (a trip planned 9+
  // weeks out) keep their never-repeat memory no matter how far ahead.
  const futureLimit = addDays(weekStart, 8 * 7);
  let seenPruned = false;
  for (const date of Object.keys(seenByDate)) {
    if (date < weekStart || (date > futureLimit && !availabilityByDate[date])) {
      delete seenByDate[date];
      seenPruned = true;
    }
  }
  if (seenPruned) await repository.saveSeenMap(seenByDate);

  set({
    profile,
    bucketList,
    availabilityByDate,
    plansByKey,
    dayPrefsByDate,
    seenByDate,
    loadStatus: 'ready',
  });
}

/**
 * Repair a stored bucket list in place:
 *   - an item whose text is itself a whole pasted list (numbered/bulleted)
 *     splits into individual items, each with inferred tags + neighborhood
 *   - a seed item whose copy has since been improved (e.g. the old vague
 *     "Slice crawl" without named spots) picks up the fresh seed copy,
 *     keeping the user's done state and position
 * Returns the healed list, or null when nothing needed fixing.
 */
function healBucketList(items: BucketItem[]): BucketItem[] | null {
  let changed = false;
  const seedById = new Map(BUCKET_SEED.map((b) => [b.id, b]));
  const out: BucketItem[] = [];
  // The repository already drops non-conforming rows, but this pass is the
  // last line before `.sort()` and `.title.match()` touch stored data: an
  // array is guaranteed here, and every survivor has a string title.
  const safe = Array.isArray(items) ? items.filter((i) => typeof i?.title === 'string') : [];
  for (const item of [...safe].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const seed = seedById.get(item.id);
    if (seed && (seed.title !== item.title || seed.note !== item.note)) {
      out.push({ ...seed, done: item.done, sortOrder: out.length });
      changed = true;
      continue;
    }
    // A saved item that is really a LIST HEADER ("Bucket list:") from an old
    // paste is noise, not an activity: drop it outright.
    if (!item.note && isListHeader(item.title)) {
      changed = true;
      continue;
    }
    // Only treat an item as a pasted "mega-item" when the structure is
    // unambiguous: no note (the paste box never produces a note on a
    // multi-item blob) AND either a real newline or at least two numbered
    // markers. Anything looser re-splits normal titles on every launch:
    // "Dinner at Lilia walk-in at 5. bar seats" or a title with " - " in it
    // must never be shredded by the healer.
    const looksMega =
      !item.note &&
      (/\r?\n/.test(item.title) ||
        (item.title.match(/(^|\s)\d+[.)]\s+/g)?.length ?? 0) >= 2);
    const parts = looksMega ? parseBucketText(item.title) : [];
    if (parts.length > 1) {
      changed = true;
      for (const p of parts) {
        out.push({
          id: genId('bucket'),
          title: p.title,
          note: p.note,
          neighborhood: p.neighborhood,
          tags: p.tags,
          done: item.done,
          sortOrder: out.length,
        });
      }
      continue;
    }
    out.push(changed ? { ...item, sortOrder: out.length } : item);
  }
  return changed ? out.map((b, i) => ({ ...b, sortOrder: i })) : null;
}

export const useStore = create<StoreState>((set, get) => ({
  loadStatus: 'idle',
  profile: null,
  availabilityByDate: {},
  bucketList: [],
  plansByKey: {},
  dayPrefsByDate: {},
  seenByDate: {},
  planning: {},
  persistenceBroken: false,
  eventsNoteByDate: {},

  async bootstrap() {
    if (get().loadStatus === 'loading' || get().loadStatus === 'ready') return;
    // Guard against two near-simultaneous callers both passing the check above
    // (index gate + root layout) and double-seeding.
    if (booting) return;
    booting = true;
    set({ loadStatus: 'loading', loadError: undefined });
    try {
      await loadAllInto(set);
    } catch (err) {
      set({
        loadStatus: 'error',
        loadError: err instanceof Error ? err.message : 'Failed to load data',
      });
    } finally {
      booting = false;
    }
  },

  async resetApp() {
    // Invalidate every queued/in-flight plan task FIRST: work already chained
    // onto the old planQueue would otherwise run after the wipe and write the
    // just-erased windows and plans straight back to disk.
    storeEpoch += 1;
    // Wipe disk, then reload (which re-seeds).
    await repository.clearAll();
    // Module-level mutable state resets too, or a "fresh" app would inherit
    // old reshuffle nonces (non-deterministic first plans) and a stale queue
    // tail from the life it just wiped.
    for (const k of Object.keys(nonceByKey)) delete nonceByKey[k];
    planQueue = Promise.resolve();
    set({
      profile: null,
      availabilityByDate: {},
      bucketList: [],
      plansByKey: {},
      dayPrefsByDate: {},
      seenByDate: {},
      planning: {},
      persistenceBroken: false,
      eventsNoteByDate: {},
      loadStatus: 'loading',
      loadError: undefined,
    });
    booting = true;
    try {
      await loadAllInto(set);
    } catch (err) {
      set({
        loadStatus: 'error',
        loadError: err instanceof Error ? err.message : 'Failed to reset',
      });
    } finally {
      booting = false;
    }
  },

  async saveProfile(profile) {
    await repository.saveProfile(profile);
    set({ profile });
    await replanAllOutOfArea(set, get);
  },

  async completeOnboarding(input) {
    const profile: Profile = { ...input, onboarded: true };
    await repository.saveProfile(profile);
    set({ profile });
    // New default neighborhoods apply to every day without a day-level
    // override: enforce the invariant across all planned days.
    await replanAllOutOfArea(set, get);
  },

  async markEntered() {
    const profile = get().profile;
    if (!profile || profile.onboarded) return;
    const next = { ...profile, onboarded: true };
    await repository.saveProfile(next);
    set({ profile: next });
  },

  async setAvailability(date, windows) {
    const valid = windows.filter(isValidWindow);
    const availability: Availability = { date, windows: valid };
    // Update state optimistically first so rapid successive edits (e.g. painting
    // the calendar) always read the freshest availability. The persistence and
    // plan pruning serialize through the per-date queue so a direct call from
    // the grid can't interleave with an in-flight runPlan/clearDay for the day.
    set((s) => {
      const next = { ...s.availabilityByDate };
      if (valid.length === 0) delete next[date];
      else next[date] = availability;
      return { availabilityByDate: next };
    });
    return enqueuePlan(date, () => applyAvailability(set, get, availability));
  },

  async setDayPrefs(date, prefs) {
    const existing = get().dayPrefsByDate[date];
    // Fresh day prefs anchor to the profile's home base (when it names a real
    // neighborhood): a day you start customizing plans near home by default.
    // An explicit `prefs.neighborhoods` still overrides via the spread below.
    const homeBase = get().profile?.homeBase;
    const base: DayPrefs =
      existing ??
      (homeBase && (NEIGHBORHOODS as readonly string[]).includes(homeBase)
        ? { date, neighborhoods: [homeBase] }
        : { date });
    const merged: DayPrefs = { ...base, ...prefs, date };
    set((s) => ({ dayPrefsByDate: { ...s.dayPrefsByDate, [date]: merged } }));
    await repository.saveDayPrefs(merged);
    // The neighborhood filter is an INVARIANT over the day's plans: narrowing
    // it re-plans any window now holding an out-of-area stop, immediately.
    // (Widening never violates, so this no-ops and existing plans survive.)
    await enqueuePlan(date, () => replanOutOfAreaWindows(set, get, date));
  },

  async clearDayPrefs(date) {
    const cleared: DayPrefs = { date };
    set((s) => ({ dayPrefsByDate: { ...s.dayPrefsByDate, [date]: cleared } }));
    await repository.saveDayPrefs(cleared);
    // Back to the profile defaults: same invariant as setDayPrefs.
    await enqueuePlan(date, () => replanOutOfAreaWindows(set, get, date));
  },

  async clearDay(date) {
    // Route through the per-date plan queue so a clear can't interleave with an
    // in-flight runPlan for the same day: otherwise that plan could commit
    // AFTER the clear and resurrect the day. Remove free time (which also
    // prunes the day's plans), reset any day-only
    // prefs, and wipe the day's never-repeat memory. The availability change is
    // inlined (not via setAvailability, which now enqueues its own work:
    // calling it from inside this queued task would deadlock the date's queue).
    // The in-memory delete happens NOW, at call time: the same optimistic
    // contract as setAvailability: so a later setAvailability (e.g. an "Add
    // free time" preset tapped while this clear is still queued) is never
    // clobbered at dequeue time, which would leave memory and disk divergent
    // (ghost windows reappearing on restart).
    set((s) => {
      const next = { ...s.availabilityByDate };
      delete next[date];
      return { availabilityByDate: next };
    });
    return enqueuePlan(date, async () => {
      await applyAvailability(set, get, { date, windows: [] });
      // Prefs reset is INLINED (clearDayPrefs now enqueues a replan pass of
      // its own: calling it from inside this queued task would deadlock).
      // No replan is needed here anyway: the day's windows are gone.
      const cleared: DayPrefs = { date };
      set((s) => ({ dayPrefsByDate: { ...s.dayPrefsByDate, [date]: cleared } }));
      await repository.saveDayPrefs(cleared);
      if (get().seenByDate[date]) {
        set((s) => ({ seenByDate: omit(s.seenByDate, date) }));
        await repository.saveSeenMap(get().seenByDate);
      }
    });
  },

  async clearWeek(dates) {
    for (const d of dates) await get().clearDay(d);
  },

  // All bucket mutations update state FIRST via a functional updater (so
  // overlapping calls compose instead of clobbering), then persist the
  // freshest list.
  async addBucketItem(input) {
    set((s) => {
      const maxOrder = s.bucketList.reduce((m, b) => Math.max(m, b.sortOrder), -1);
      const item: BucketItem = {
        id: genId('bucket'),
        title: input.title.trim(),
        note: input.note?.trim() || undefined,
        neighborhood: input.neighborhood?.trim() || undefined,
        tags: [],
        done: false,
        sortOrder: maxOrder + 1,
      };
      return { bucketList: [...s.bucketList, item] };
    });
    await repository.saveBucketList(get().bucketList);
  },

  async addBucketItems(inputs) {
    const cleaned = inputs
      .map((inp) => ({
        title: inp.title.trim(),
        note: inp.note?.trim() || undefined,
        neighborhood: inp.neighborhood?.trim() || undefined,
        tags: inp.tags ?? [],
      }))
      .filter((x) => x.title.length > 0);
    if (cleaned.length === 0) return 0;
    set((s) => {
      let order = s.bucketList.reduce((m, b) => Math.max(m, b.sortOrder), -1);
      const additions: BucketItem[] = cleaned.map((x) => ({
        id: genId('bucket'),
        ...x,
        done: false,
        sortOrder: (order += 1),
      }));
      return { bucketList: [...s.bucketList, ...additions] };
    });
    await repository.saveBucketList(get().bucketList);
    return cleaned.length;
  },

  async toggleBucketDone(id) {
    set((s) => ({
      bucketList: s.bucketList.map((b) => (b.id === id ? { ...b, done: !b.done } : b)),
    }));
    await repository.saveBucketList(get().bucketList);
  },

  async removeBucketItem(id) {
    set((s) => ({ bucketList: s.bucketList.filter((b) => b.id !== id) }));
    await repository.saveBucketList(get().bucketList);
  },

  async generatePlan(date, window, modifier) {
    // "Ensure planned", not "regenerate": auto-planning (applyAvailability)
    // usually got here first, and a UI ensure-effect may have queued behind
    // it: if the window already has a plan by the time this dequeues, keep
    // it. Reshuffles go through reshufflePlan/reshuffleDay instead.
    return enqueuePlan(date, async () => {
      const key = planKey(date, window);
      if (get().plansByKey[key]) {
        // A plan already exists; clear any stale error status so the UI shows
        // the itinerary again instead of a dead error state.
        if (get().planning[key]?.status === 'error') {
          set((s) => ({ planning: { ...s.planning, [key]: { status: 'idle' } } }));
        }
        return;
      }
      await runPlan(set, get, date, window, modifier);
    });
  },

  async reshufflePlan(date, window, modifier) {
    return enqueuePlan(date, async () => {
      const key = planKey(date, window);
      await retirePlanCandidates(set, get, date, get().plansByKey[key]);
      nonceByKey[key] = (nonceByKey[key] ?? 0) + 1;
      await runPlan(set, get, date, window, modifier);
    });
  },

  async reshuffleDay(date) {
    return enqueuePlan(date, async () => {
      // Re-read the windows on every pass so a block removed mid-run is
      // never planned; runPlan re-validates again right before committing.
      for (const w of [...(get().availabilityByDate[date]?.windows ?? [])]) {
        const key = planKey(date, w);
        const existing = get().plansByKey[key];
        if (existing) {
          await retirePlanCandidates(set, get, date, existing);
          nonceByKey[key] = (nonceByKey[key] ?? 0) + 1;
        }
        await runPlan(set, get, date, w, existing?.modifier);
      }
    });
  },

  async swapPlanItem(date, window, itemId, replacementId, intent) {
    const key = planKey(date, window);
    const plan = get().plansByKey[key];
    const item = plan?.items.find((i) => i.id === itemId);
    if (!plan || !item) return false;

    const options = await slotCandidates(get, date, window, item, intent);
    const pick = pickByIntent(options, item, replacementId, intent);
    if (!pick) return false;

    // Commit INSIDE the per-date plan queue: every other plan mutation
    // (generate/reshuffle/clear) serializes through it, so a queued reshuffle
    // can never land between our re-validation below and the commit: a swap
    // that committed outside the queue could overwrite a freshly reshuffled
    // plan with one built from a stale snapshot.
    let committed = false;
    await enqueuePlan(date, async () => {
      // The provider fetch above awaited: re-validate that the target window
      // still exists (the user may have removed/resized the block) and that the
      // plan was not reshuffled away in the meantime, so we never resurrect a
      // stale plan or commit into a window that is gone.
      const windowStillExists = (get().availabilityByDate[date]?.windows ?? []).some(
        (w) => planKey(date, w) === key,
      );
      const fresh = get().plansByKey[key];
      if (
        !windowStillExists ||
        !fresh ||
        fresh.id !== plan.id ||
        !fresh.items.some((i) => i.id === itemId)
      ) {
        return;
      }

      // The pick itself was chosen from a PRE-queue snapshot: a concurrent
      // swap on a sibling stop/window (or an in-flight re-plan) may have
      // consumed this exact venue while our provider fetch ran. Re-check it
      // against the FRESH day state: day-scoped, not week-scoped, so an
      // intentional week-repeat fallback pick still passes, but a same-day
      // duplicate never commits.
      const freshDaySeen = new Set([
        ...(get().seenByDate[date] ?? []),
        ...Object.values(get().plansByKey)
          .filter((p) => p.date === date)
          .flatMap((p) => planCandidateKeys(p)),
      ]);
      if (freshDaySeen.has(pick.id) || freshDaySeen.has(venueKey(pick.name))) {
        return; // consumed mid-flight; the UI offers a refreshed list
      }

      const slotStart = toMinutes(item.startTime);
      const slotEnd = toMinutes(item.endTime);
      // Fixed-time picks (a show with a real start) keep their true time, clamped
      // to the slot; flexible picks start when the slot starts.
      let newStart = slotStart;
      let newEnd = slotStart + Math.min(candidateDuration(pick), slotEnd - slotStart);
      if (pick.startTime && pick.endTime) {
        const clampedStart = Math.max(slotStart, toMinutes(pick.startTime));
        const clampedEnd = Math.min(slotEnd, toMinutes(pick.endTime));
        // A candidate only had to cover slotStart+30 to qualify, so on a short
        // (sub-30-min) slot its real start can land past slotEnd and invert the
        // window. Only adopt the fixed times when they yield a positive duration;
        // otherwise keep the flexible placement above (always positive).
        if (clampedEnd > clampedStart) {
          newStart = clampedStart;
          newEnd = clampedEnd;
        }
      }

      const replacement: PlanItem = {
        id: pick.id,
        order: item.order,
        kind: pick.kind,
        title: pick.name,
        neighborhood: pick.neighborhood,
        startTime: fromMinutes(newStart),
        endTime: fromMinutes(newEnd),
        priceTier: pick.priceTier,
        lat: pick.lat,
        lng: pick.lng,
        address: pick.address,
        bookingUrl: pick.bookingUrl,
        rating: pick.rating,
        ratingCount: pick.ratingCount,
        description: pick.description,
        note: 'Swapped in by you.',
        tags: pick.tags,
        cuisine: pick.cuisine,
        sourceId: pick.kind === 'bucket' ? undefined : pick.id,
        bucketItemId: pick.kind === 'bucket' ? pick.id : undefined,
      };

      // Retire BOTH sides into the day's never-repeat memory: the outgoing stop
      // (so it never comes back) and the incoming pick (so a sibling window
      // cannot serve the same venue again today). Venue keys alongside the raw
      // ids so a same-place-different-id echo (bucket wish vs. curated listing)
      // is caught too. Safe to await before the commit: this whole closure runs
      // inside the date's plan queue, so no other plan mutation can interleave.
      const outgoingId = item.sourceId ?? item.bucketItemId ?? item.id;
      await addSeen(set, get, date, [
        outgoingId,
        venueKey(item.title),
        pick.id,
        venueKey(pick.name),
      ]);

      const stops = fresh.items
        .filter((i) => i.kind !== 'walk' && i.kind !== 'break')
        .map((i) => (i.id === itemId ? replacement : i));
      const nextPlan: Plan = { ...fresh, items: rebuildConnectors(stops) };
      set((s) => ({ plansByKey: { ...s.plansByKey, [key]: nextPlan } }));
      await repository.savePlan(nextPlan);
      committed = true;
    });
    return committed;
  },

  async alternativesForItem(date, window, itemId) {
    const key = planKey(date, window);
    const plan = get().plansByKey[key];
    const item = plan?.items.find((i) => i.id === itemId);
    if (!plan || !item) return [];
    // Display cap lives HERE (the sheet shows a shortlist); the underlying
    // pool stays uncapped so swap intents can search all of it.
    return (await slotCandidates(get, date, window, item)).slice(0, 12);
  },

}));

// A failed WRITE (storage full, storage blocked in Safari) leaves memory and
// disk divergent: the app looks fine until the next launch, when the user's
// evening is gone. Flip a flag the screens surface as a banner instead.
onPersistenceError(() => {
  if (!useStore.getState().persistenceBroken) {
    useStore.setState({ persistenceBroken: true });
  }
});

/**
 * Web only: AsyncStorage is localStorage, which every tab of the app shares.
 * The `storage` event fires in the OTHER tabs when one of them writes, so a
 * second tab re-reads instead of continuing from a snapshot it took at load
 * and later overwriting the first tab's bucket list or never-repeat memory
 * with its own stale copy. Coalesced: a burst of writes triggers one reload.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  let queued = false;
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key != null && !event.key.startsWith(STORAGE_PREFIX)) return;
    if (queued || useStore.getState().loadStatus !== 'ready') return;
    queued = true;
    setTimeout(() => {
      queued = false;
      // Reload behind the plan queue so an in-flight plan commit is not
      // interleaved with a whole-state replacement.
      void enqueuePlan('*', async () => {
        try {
          await loadAllInto(useStore.setState);
        } catch {
          // A failed refresh leaves this tab on its (still usable) snapshot.
        }
      });
    }, 250);
  });
}

/**
 * Persist an availability change, prune plans whose window no longer exists
 * (resized/removed blocks), and AUTO-PLAN every window that has no plan yet:
 * painting free time IS planning it, and moving a window re-plans it in place.
 * Runs INSIDE the per-date plan queue (the in-memory window update happens
 * optimistically before enqueueing): only call this from already-queued work.
 */
async function applyAvailability(
  set: SetFn,
  get: () => StoreState,
  availability: Availability,
): Promise<void> {
  const { date } = availability;
  await repository.saveAvailability(availability);

  const validKeys = new Set(availability.windows.map((w) => planKey(date, w)));
  const orphans = Object.entries(get().plansByKey).filter(
    ([key, p]) => p.date === date && !validKeys.has(key),
  );
  for (const [key, plan] of orphans) {
    await repository.deletePlan(plan.id);
    set((s) => ({ plansByKey: omit(s.plansByKey, key) }));
    // Release the orphan's venues from the day's never-repeat memory: the
    // window merely moved/resized, so its re-plan should be free to keep the
    // same stops. Venues still scheduled in OTHER windows stay excluded via
    // the live-plans scan in weekSeenIds.
    await removeSeen(set, get, date, planCandidateKeys(plan));
  }

  // Auto-plan: every window without a plan gets one right away. Runs inside
  // the per-date queue, so sibling windows still generate sequentially and
  // see each other's never-repeat entries.
  for (const w of availability.windows) {
    if (!get().plansByKey[planKey(date, w)]) {
      await runPlan(set, get, date, w, undefined);
    }
  }
}

/** Append candidate ids to a date's never-repeat memory and persist. */
async function addSeen(
  set: SetFn,
  get: () => StoreState,
  date: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  set((s) => {
    const merged = Array.from(new Set([...(s.seenByDate[date] ?? []), ...ids]));
    return { seenByDate: { ...s.seenByDate, [date]: merged } };
  });
  await repository.saveSeenMap(get().seenByDate);
}

/**
 * Enforce the neighborhood invariant for one date: any window whose plan now
 * holds a stop OUTSIDE the day's (freshly resolved) neighborhoods is re-planned
 * on the spot. The outgoing plan's venues are released first (same contract as
 * a moved window) so in-area stops are free to survive the re-plan. Windows
 * whose plans already fit are left untouched: adding neighborhoods never
 * churns a valid plan. Location-agnostic stops (no neighborhood, e.g. the
 * user's own bucket wishes) always fit. Runs INSIDE the plan queue.
 */
async function replanOutOfAreaWindows(
  set: SetFn,
  get: () => StoreState,
  date: string,
): Promise<void> {
  const profile = get().profile;
  if (!profile) return;
  const prefs = resolvePrefs(profile, get().dayPrefsByDate[date]);
  for (const w of [...(get().availabilityByDate[date]?.windows ?? [])]) {
    const key = planKey(date, w);
    const plan = get().plansByKey[key];
    if (!plan) continue;
    const violates = plan.items.some(
      (i) =>
        i.kind !== 'walk' &&
        i.kind !== 'break' &&
        !matchesNeighborhoods(i.neighborhood, prefs.neighborhoods),
    );
    if (!violates) continue;
    await removeSeen(set, get, date, planCandidateKeys(plan));
    await runPlan(set, get, date, w, plan.modifier);
  }
}

/** Enforce the neighborhood invariant on EVERY date with free time (profile
 *  default change). Each date's pass runs through the plan queue. */
async function replanAllOutOfArea(set: SetFn, get: () => StoreState): Promise<void> {
  const dates = Object.keys(get().availabilityByDate);
  await Promise.all(
    dates.map((date) => enqueuePlan(date, () => replanOutOfAreaWindows(set, get, date))),
  );
}

/** Remove candidate ids from a date's never-repeat memory and persist. */
async function removeSeen(
  set: SetFn,
  get: () => StoreState,
  date: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const cur = get().seenByDate[date];
  if (!cur || cur.length === 0) return;
  const drop = new Set(ids);
  const next = cur.filter((id) => !drop.has(id));
  if (next.length === cur.length) return;
  set((s) => ({ seenByDate: { ...s.seenByDate, [date]: next } }));
  await repository.saveSeenMap(get().seenByDate);
}

/** Retire every candidate of an outgoing plan into the seen memory. */
async function retirePlanCandidates(
  set: SetFn,
  get: () => StoreState,
  date: string,
  plan: Plan | undefined,
): Promise<void> {
  if (!plan) return;
  await addSeen(set, get, date, planCandidateKeys(plan));
}

/**
 * Every candidate id/venue-key already used ANYWHERE in `date`'s Mon-Sun week:
 * the week's never-repeat memory plus everything scheduled in the week's
 * current plans. This is the exclusion set for planning, reshuffles, and
 * swaps: a venue suggested on Monday (by any candidate id) cannot come back
 * on Thursday under a different id for the same real place.
 */
function weekSeenIds(s: StoreState, date: string): Set<string> {
  const days = weekDates(mondayOf(date));
  const out = new Set<string>();
  for (const d of days) {
    for (const id of s.seenByDate[d] ?? []) out.add(id);
  }
  for (const p of Object.values(s.plansByKey)) {
    if (days.includes(p.date)) {
      for (const key of planCandidateKeys(p)) out.add(key);
    }
  }
  return out;
}

/** Choose a swap replacement from the ranked options, honoring the intent. */
function pickByIntent(
  options: Candidate[],
  item: PlanItem,
  replacementId?: string,
  intent?: SwapIntent,
): Candidate | undefined {
  if (replacementId) return options.find((c) => c.id === replacementId);
  if (options.length === 0) return undefined;
  if (intent == null) return options[0];
  if (isCuisineIntent(intent)) {
    const want = CUISINE_INTENTS[intent].toLowerCase();
    return options.find((c) => (c.cuisine ?? '').toLowerCase() === want);
  }
  if (isTagIntent(intent)) {
    const want = TAG_INTENTS[intent];
    return options.find((c) => c.tags.some((t) => t.toLowerCase() === want));
  }
  switch (intent) {
    case 'surprise':
      return options[Math.floor(Math.random() * options.length)];
    case 'indoor':
      return options.find((c) => !c.tags.some((t) => t.toLowerCase() === 'outdoors'));
    case 'cheaper':
    case 'pricier': {
      const cur = item.priceTier ?? 2;
      const eligible = options.filter(
        (c) =>
          c.priceTier != null && (intent === 'cheaper' ? c.priceTier < cur : c.priceTier > cur),
      );
      // Closest price tier first; rank order breaks ties (sort is stable).
      eligible.sort(
        (a, b) => Math.abs((a.priceTier ?? cur) - cur) - Math.abs((b.priceTier ?? cur) - cur),
      );
      return eligible[0];
    }
    default: {
      // Exhaustiveness check: a new SwapIntent member must be handled above
      // (a case here, or a CUISINE_INTENTS/TAG_INTENTS entry): growing the
      // union is a compile error, never a silent top-pick fallthrough.
      const unhandled: never = intent;
      return unhandled;
    }
  }
}

/**
 * Candidates that could fill an existing block's slot: same category (unless
 * an explicit category-override intent is given: see CROSS_CATEGORY_INTENTS),
 * allowed at that hour, fits the slot, and not already used this week: with
 * a this-date-only fallback when the week-wide filter empties the pool, so a
 * venue from another day can return rather than a dead end (never a same-day
 * repeat). Price-filtered first; if that starves the list, the price filter
 * is dropped rather than returning nothing.
 */
async function slotCandidates(
  get: () => StoreState,
  date: string,
  window: TimeWindow,
  item: PlanItem,
  intent?: SwapIntent,
): Promise<Candidate[]> {
  const profile = get().profile;
  if (!profile) return [];
  const prefs = resolvePrefs(profile, get().dayPrefsByDate[date]);

  // Providers are contractually non-throwing, but the swap/alternatives sheet
  // must never crash on a violation (runPlan is equally defensive); an empty
  // candidate list is the honest fallback.
  let fetched: Candidate[];
  try {
    const [eventsRes, placesRes] = await Promise.all([
      eventsProvider.fetchEvents(date),
      placesProvider.fetchPlaces(prefs.neighborhoods, date),
    ]);
    fetched = [...eventsRes.candidates, ...placesRes.candidates];
  } catch {
    return [];
  }
  const buckets: Candidate[] = get()
    .bucketList.filter((b) => !b.done)
    .map((b) => ({
      id: b.id,
      name: b.title,
      kind: 'bucket' as const,
      neighborhood: b.neighborhood,
      priceTier: b.priceTier,
      durationMin: 75,
      description: b.note,
      tags: b.tags,
    }));

  const slotStart = toMinutes(item.startTime);
  const slotEnd = toMinutes(item.endTime);
  const slotLen = slotEnd - slotStart;

  const plan = get().plansByKey[planKey(date, window)];
  const inPlan = new Set(
    (plan?.items ?? [])
      .filter((i) => i.kind !== 'walk' && i.kind !== 'break')
      .flatMap((i) => [i.sourceId ?? i.bucketItemId ?? i.id, venueKey(i.title)]),
  );
  // The no-repeat rule: everything already used anywhere this week is out:
  // with a fallback (below) to this-date-only exclusion when the week filter
  // empties the pool entirely, so alternatives never hit a dead wall while
  // the city still has venues to offer.
  const weekSeen = weekSeenIds(get(), date);

  // An explicit category ask ("Coffee", "Outdoors", "Italian"...) overrides
  // this stop's current kind entirely: you should be able to turn a dinner
  // into a park visit, or an activity into a coffee stop, by naming what you
  // actually want. Cheaper/pricier/surprise/indoor stay within today's kind
  // (a "cheaper dinner" should still be dinner).
  const crossCategory = intent != null && CROSS_CATEGORY_INTENTS.has(intent);

  const buildPool = (seen: Set<string>) =>
    [...fetched, ...buckets].filter((c) => {
      if (inPlan.has(c.id) || seen.has(c.id)) return false;
      if (inPlan.has(venueKey(c.name)) || seen.has(venueKey(c.name))) return false;
      if (!crossCategory && !sameCategory(c.kind, item.kind)) return false;
      // Same deliberate-override reasoning as the category bypass above: tapping
      // "Coffee" on a dinner stop is the user choosing that venue type AT that
      // time on purpose, so the normal meal/drink-hour rhythm (which exists to
      // keep the ORIGINAL schedule sensible) shouldn't silently block it too.
      if (!crossCategory && !allowedStart(c, slotStart)) return false;
      // Fixed-time candidates must actually cover this slot.
      if (c.startTime && c.endTime) {
        if (toMinutes(c.startTime) > slotStart + 30) return false;
        if (toMinutes(c.endTime) < slotStart + 30) return false;
      } else if (candidateDuration(c) > slotLen + 30) {
        // Flexible candidates can run a little long but not absurdly so.
        return false;
      }
      return true;
    });

  // Week-wide no-repeat first; when that leaves nothing that can satisfy the
  // ask, fall back to excluding only this date's own history: a venue from
  // earlier in the week beats a dead "nothing fits" wall, and an explicit
  // cuisine/vibe tap ("Thai") should surface the area's Thai spot even if it
  // appeared on another day. Same-day repeats stay impossible.
  const satisfiesIntent = (c: Candidate): boolean => {
    if (intent == null) return true;
    if (isCuisineIntent(intent)) {
      return (c.cuisine ?? '').toLowerCase() === CUISINE_INTENTS[intent].toLowerCase();
    }
    if (isTagIntent(intent)) {
      const want = TAG_INTENTS[intent];
      return c.tags.some((t) => t.toLowerCase() === want);
    }
    // Mirror pickByIntent's real predicates for the constrained relative
    // intents, so "the week pool can't satisfy this ask" actually triggers
    // the day-only fallback instead of returning an unusable pool.
    if (intent === 'indoor') {
      return !c.tags.some((t) => t.toLowerCase() === 'outdoors');
    }
    if (intent === 'cheaper' || intent === 'pricier') {
      const cur = item.priceTier ?? 2;
      return (
        c.priceTier != null && (intent === 'cheaper' ? c.priceTier < cur : c.priceTier > cur)
      );
    }
    return true; // 'surprise' fits any pool
  };
  let pool = buildPool(weekSeen);
  if (!pool.some(satisfiesIntent)) {
    pool = buildPool(new Set(get().seenByDate[date] ?? []));
  }

  // Keep "Other options" STRICTLY in the day's neighborhoods (location-agnostic
  // picks with no set area always qualify). This is a hard filter with NO
  // full-pool fallback: an empty result is intentional and honest ("nothing
  // local fits this slot") rather than leaking a venue across town. Only the
  // PRICE filter below widens (priced -> geoPool); neighborhood never does.
  const geoPool = filterToNeighborhoods(pool, prefs.neighborhoods);

  const priced = geoPool.filter(
    (c) => c.priceTier == null || (c.priceTier >= prefs.price.min && c.priceTier <= prefs.price.max),
  );
  // An explicit Cheaper/Pricier tap is a deliberate step OUTSIDE the day's
  // price band (a stop already at the band edge would otherwise have nothing
  // to move to); price is the one filter allowed to widen. Geo strictness and
  // the week's no-repeat rule always hold.
  const usable =
    intent === 'cheaper' || intent === 'pricier'
      ? geoPool
      : priced.length > 0
        ? priced
        : geoPool;

  // Rank with the SAME brain as the planner (lib/planner/scoring.ts), built
  // from the same inputs, so swaps/alternatives inherit holiday awareness and
  // modifier bias instead of drifting on a private ad-hoc score. seenCount
  // keys the jitter (seed + nonce) so alternatives keep reshuffling as items
  // are seen, mirroring the old seenCount-keyed hash.
  const seenCount = (get().seenByDate[date] ?? []).length;
  const ctx: ScoringContext = {
    neighborhoods: prefs.neighborhoods,
    interests: prefs.interests,
    holiday: holidayFor(date),
    modifier: plan?.modifier,
    seed: hash(`${date}:${plan?.modifier ?? 'default'}:${seenCount}`),
    nonce: seenCount,
  };
  return usable
    .map((c) => ({ c, score: scoreCandidate(c, ctx) }))
    .sort((a, b) => b.score - a.score || hash(a.c.id) - hash(b.c.id))
    .map((s) => s.c);
  // NOTE: intentionally uncapped: swap intents filter this list (cheaper/
  // pricier/indoor), so truncating here would falsely report exhaustion.
  // The display-only "Other options" list caps in alternativesForItem.
}

/** Shared plan-generation routine for generate + reshuffle. */
async function runPlan(
  set: SetFn,
  get: () => StoreState,
  date: string,
  window: TimeWindow,
  modifier: PlanModifier | undefined,
): Promise<void> {
  const key = planKey(date, window);
  const epoch = storeEpoch;
  const profile = get().profile;
  if (!profile) return;
  const prefs = resolvePrefs(profile, get().dayPrefsByDate[date]);

  set((s) => ({ planning: { ...s.planning, [key]: { status: 'planning' } } }));

  try {
    const [eventsRes, placesRes] = await Promise.all([
      eventsProvider.fetchEvents(date),
      placesProvider.fetchPlaces(prefs.neighborhoods, date),
    ]);

    // Record (or clear) the provider's "live answered, nothing in-area" note
    // so the day panel can say curated picks substituted: distinguishing
    // that from a live failure instead of rendering the two identically.
    set((s) => {
      if (eventsRes.note) {
        return { eventsNoteByDate: { ...s.eventsNoteByDate, [date]: eventsRes.note } };
      }
      return s.eventsNoteByDate[date]
        ? { eventsNoteByDate: omit(s.eventsNoteByDate, date) }
        : {};
    });

    const baseReq = {
      date,
      window,
      neighborhoods: prefs.neighborhoods,
      price: prefs.price,
      partySize: prefs.partySize,
      interests: prefs.interests,
      bucketList: get().bucketList.filter((b) => !b.done),
      // Pass the raw pools; the planner strictly filters every pool to the day's
      // neighborhoods (and never widens that filter), so the plan can't include
      // a stop in a neighborhood you didn't pick.
      events: eventsRes.candidates,
      places: placesRes.candidates,
      modifier,
      nonce: nonceByKey[key] ?? 0,
      holiday: holidayFor(date),
    };
    // Exclude everything used anywhere this Mon-Sun week, not just this date,
    // so the same venue never shows up on two days of one week.
    let plan = await defaultPlanner.plan({
      ...baseReq,
      excludeIds: [...weekSeenIds(get(), date)],
    });

    // NYC never runs dry: if the week-wide no-repeat rule left this window
    // with NOTHING (catalog exhausted for these neighborhoods), retry
    // excluding only THIS DATE's history: a venue from earlier in the week
    // beats a dead window. Same-day repeats stay impossible.
    const hasStops = (p: Plan) =>
      p.items.some((i) => i.kind !== 'walk' && i.kind !== 'break');
    if (!hasStops(plan)) {
      const daySeen = new Set([
        ...(get().seenByDate[date] ?? []),
        ...Object.values(get().plansByKey)
          .filter((p) => p.date === date)
          .flatMap((p) => planCandidateKeys(p)),
      ]);
      const retry = await defaultPlanner.plan({ ...baseReq, excludeIds: [...daySeen] });
      if (hasStops(retry)) plan = retry;
    }

    // The planner awaited: if the user removed or resized this window while
    // it ran (or reset the whole app: the epoch check), drop the result
    // instead of resurrecting a plan for a window that no longer exists.
    const windowStillExists = (get().availabilityByDate[date]?.windows ?? []).some(
      (w) => planKey(date, w) === key,
    );
    if (!windowStillExists || epoch !== storeEpoch) {
      set((s) => ({ planning: { ...s.planning, [key]: { status: 'idle' } } }));
      return;
    }

    await repository.savePlan(plan);

    // Everything just suggested joins the day's never-repeat memory right away,
    // so a sibling window generated in the same pass (or any later reshuffle)
    // cannot serve the same stop twice on one day.
    await addSeen(set, get, date, planCandidateKeys(plan));

    set((s) => ({
      plansByKey: { ...s.plansByKey, [key]: plan },
      planning: { ...s.planning, [key]: { status: 'idle' } },
    }));
  } catch (err) {
    set((s) => ({
      planning: {
        ...s.planning,
        [key]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Planning failed',
        },
      },
    }));
  }
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const next = { ...rec };
  delete next[key];
  return next;
}
