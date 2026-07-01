// =============================================================================
// OutNYC — zustand store (lib/store.ts)
// =============================================================================
// The single app store. Wires the Repository, default Planner, providers, and
// local notifications together. Screens read state + call actions; they never
// touch the repository or planner directly.
//
// v2 planning rules implemented here:
//   - Per-day preferences (neighborhoods/price/party/interests) override the
//     profile defaults for that day only.
//   - Never-repeat: every candidate a day has already been shown lands in
//     seenByDate; reshuffles and swaps exclude those ids (the planner widens
//     its filters before ever repeating).
//   - One reshuffle verb at each scope: week (planWeek), day (reshuffleDay),
//     single block (swapPlanItem / alternativesForItem).
// =============================================================================

import { create } from 'zustand';

import { BUCKET_SEED, SEED_PROFILE } from './constants';
import { holidayFor } from './holidays';
import {
  cancelPlanNotifications,
  ensureNotificationPermission,
  schedulePlanNotifications,
} from './notifications';
import { defaultPlanner } from './planner';
import {
  allowedStart,
  candidateDuration,
  hash,
  rebuildConnectors,
  sameCategory,
} from './planner/slotUtils';
import { eventsProvider, placesProvider } from './providers';
import { repository } from './storage';
import { fromMinutes, isValidWindow, todayNY, toMinutes } from './time';
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

/** Outcome of locking in a plan, so the UI can give honest feedback. */
export interface LockResult {
  scheduled: number;
  reason: 'ok' | 'permission-denied' | 'none-upcoming';
}

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
  lockedPlanIds: Record<string, boolean>; // planId -> notifications scheduled

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

  addBucketItem(input: { title: string; note?: string; neighborhood?: string }): Promise<void>;
  /** Bulk-add many items at once (from a pasted list). */
  addBucketItems(
    inputs: { title: string; note?: string; neighborhood?: string; tags?: string[] }[],
  ): Promise<number>;
  toggleBucketDone(id: string): Promise<void>;
  removeBucketItem(id: string): Promise<void>;

  generatePlan(date: string, window: TimeWindow, modifier?: PlanModifier): Promise<void>;
  reshufflePlan(date: string, window: TimeWindow, modifier?: PlanModifier): Promise<void>;
  /** The single week-scope reshuffle: (re)plans every window on the dates. */
  planWeek(dates: string[]): Promise<void>;
  /** The single day-scope reshuffle: (re)plans every window on one date. */
  reshuffleDay(date: string): Promise<void>;
  /**
   * Swap one block for a fresh candidate in the same category + time slot.
   * Pass `replacementId` to swap to a specific candidate (from alternatives).
   */
  swapPlanItem(
    date: string,
    window: TimeWindow,
    itemId: string,
    replacementId?: string,
  ): Promise<boolean>;
  /** Everything that could replace a block right now (same category + slot). */
  alternativesForItem(date: string, window: TimeWindow, itemId: string): Promise<Candidate[]>;

  lockInPlan(planId: string): Promise<LockResult>;
  unlockPlan(planId: string): Promise<void>;
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
 * Per-date plan-generation queue. Sibling windows on one date must generate
 * SEQUENTIALLY so the second sees the first's never-repeat entries (two
 * windows mounting at once would otherwise both pick the same top candidate).
 */
const planQueueByDate: Record<string, Promise<void>> = {};
function enqueuePlan(date: string, work: () => Promise<void>): Promise<void> {
  const prev = planQueueByDate[date] ?? Promise.resolve();
  const next = prev.then(work, work);
  planQueueByDate[date] = next.catch(() => undefined);
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

/** Candidate ids used by a plan's stops (the never-repeat memory entries). */
function planCandidateIds(plan: Plan): string[] {
  return plan.items
    .filter((i) => i.kind !== 'walk' && i.kind !== 'break')
    .map((i) => i.sourceId ?? i.bucketItemId ?? i.id);
}

/**
 * Load everything from the repository into the store, seeding profile + bucket
 * list on first run. Shared by bootstrap() and resetApp().
 */
async function loadAllInto(set: SetFn): Promise<void> {
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
  }

  const availabilityList = await repository.getAllAvailability();
  const availabilityByDate: Record<string, Availability> = {};
  for (const a of availabilityList) availabilityByDate[a.date] = a;

  // Restore previously generated plans + which of them are locked-in, so a
  // day you planned/locked survives an app restart. Plans whose window no
  // longer matches the day's availability (blocks resized/removed since) are
  // healed away so no stale block floats outside a green window.
  const plans = await repository.getAllPlans();
  const plansByKey: Record<string, Plan> = {};
  for (const p of plans) {
    const windows = availabilityByDate[p.date]?.windows ?? [];
    const stillValid = windows.some((w) => planKey(p.date, w) === planKey(p.date, p.window));
    if (stillValid) {
      plansByKey[planKey(p.date, p.window)] = p;
    } else {
      // Healed-away plan: also silence any reminders it had scheduled.
      await cancelPlanNotifications(p.id);
      await repository.deletePlan(p.id);
    }
  }

  // Locked ids must reference a plan that still exists.
  const keptPlanIds = new Set(Object.values(plansByKey).map((p) => p.id));
  const lockedIds = await repository.getLockedPlanIds();
  const keptLocked = lockedIds.filter((id) => keptPlanIds.has(id));
  if (keptLocked.length !== lockedIds.length) {
    await repository.saveLockedPlanIds(keptLocked);
  }
  const lockedPlanIds: Record<string, boolean> = {};
  for (const id of keptLocked) lockedPlanIds[id] = true;

  const dayPrefsList = await repository.getAllDayPrefs();
  const dayPrefsByDate: Record<string, DayPrefs> = {};
  for (const p of dayPrefsList) dayPrefsByDate[p.date] = p;

  // Never-repeat memory only matters for today and the future; prune the past
  // so it cannot grow without bound.
  const seenByDate = await repository.getSeenMap();
  const today = todayNY();
  let seenPruned = false;
  for (const date of Object.keys(seenByDate)) {
    if (date < today) {
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
    lockedPlanIds,
    dayPrefsByDate,
    seenByDate,
    loadStatus: 'ready',
  });
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
  lockedPlanIds: {},

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
    // Cancel any scheduled nudges, wipe disk, then reload (which re-seeds).
    for (const id of Object.keys(get().lockedPlanIds)) {
      await cancelPlanNotifications(id);
    }
    await repository.clearAll();
    set({
      profile: null,
      availabilityByDate: {},
      bucketList: [],
      plansByKey: {},
      dayPrefsByDate: {},
      seenByDate: {},
      planning: {},
      lockedPlanIds: {},
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
  },

  async completeOnboarding(input) {
    const profile: Profile = { ...input, onboarded: true };
    await repository.saveProfile(profile);
    set({ profile });
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
    // the calendar) always read the freshest availability, then persist.
    set((s) => {
      const next = { ...s.availabilityByDate };
      if (valid.length === 0) delete next[date];
      else next[date] = availability;
      return { availabilityByDate: next };
    });
    await repository.saveAvailability(availability);

    // Prune plans whose window no longer exists (resized/removed blocks), so
    // stale plan blocks never float outside the green windows on the grid.
    const validKeys = new Set(valid.map((w) => planKey(date, w)));
    const orphans = Object.entries(get().plansByKey).filter(
      ([key, p]) => p.date === date && !validKeys.has(key),
    );
    for (const [key, plan] of orphans) {
      await cancelPlanNotifications(plan.id);
      await repository.deletePlan(plan.id);
      set((s) => ({
        plansByKey: omit(s.plansByKey, key),
        lockedPlanIds: omit(s.lockedPlanIds, plan.id),
      }));
    }
    if (orphans.length > 0) await persistLocked(get().lockedPlanIds);
  },

  async setDayPrefs(date, prefs) {
    const merged: DayPrefs = { ...get().dayPrefsByDate[date], ...prefs, date };
    set((s) => ({ dayPrefsByDate: { ...s.dayPrefsByDate, [date]: merged } }));
    await repository.saveDayPrefs(merged);
  },

  async clearDayPrefs(date) {
    const cleared: DayPrefs = { date };
    set((s) => ({ dayPrefsByDate: { ...s.dayPrefsByDate, [date]: cleared } }));
    await repository.saveDayPrefs(cleared);
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
    return enqueuePlan(date, () => runPlan(set, get, date, window, modifier));
  },

  async reshufflePlan(date, window, modifier) {
    return enqueuePlan(date, async () => {
      const key = planKey(date, window);
      await retirePlanCandidates(set, get, date, get().plansByKey[key]);
      nonceByKey[key] = (nonceByKey[key] ?? 0) + 1;
      await runPlan(set, get, date, window, modifier);
    });
  },

  async planWeek(dates) {
    for (const date of dates) {
      await get().reshuffleDay(date);
    }
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

  async swapPlanItem(date, window, itemId, replacementId) {
    const key = planKey(date, window);
    const plan = get().plansByKey[key];
    const item = plan?.items.find((i) => i.id === itemId);
    if (!plan || !item) return false;

    const options = await slotCandidates(get, date, window, item);
    const pick = replacementId
      ? options.find((c) => c.id === replacementId)
      : options[0];
    if (!pick) return false;

    // The provider fetch above awaited: re-validate that the plan was not
    // reshuffled away in the meantime, so we never resurrect a stale plan.
    const fresh = get().plansByKey[key];
    if (!fresh || fresh.id !== plan.id || !fresh.items.some((i) => i.id === itemId)) {
      return false;
    }

    const slotStart = toMinutes(item.startTime);
    const slotEnd = toMinutes(item.endTime);
    // Fixed-time picks (a show with a real start) keep their true time, clamped
    // to the slot; flexible picks start when the slot starts.
    let newStart = slotStart;
    let newEnd = slotStart + Math.min(candidateDuration(pick), slotEnd - slotStart);
    if (pick.startTime && pick.endTime) {
      newStart = Math.max(slotStart, toMinutes(pick.startTime));
      newEnd = Math.min(slotEnd, toMinutes(pick.endTime));
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
      description: pick.description,
      note: 'Swapped in by you.',
      sourceId: pick.kind === 'bucket' ? undefined : pick.id,
      bucketItemId: pick.kind === 'bucket' ? pick.id : undefined,
    };

    // Retire BOTH sides into the day's never-repeat memory: the outgoing stop
    // (so it never comes back) and the incoming pick (so a sibling window
    // cannot serve the same venue again today).
    const outgoingId = item.sourceId ?? item.bucketItemId ?? item.id;
    await addSeen(set, get, date, [outgoingId, pick.id]);

    const stops = fresh.items
      .filter((i) => i.kind !== 'walk' && i.kind !== 'break')
      .map((i) => (i.id === itemId ? replacement : i));
    const nextPlan: Plan = { ...fresh, items: rebuildConnectors(stops) };
    set((s) => ({ plansByKey: { ...s.plansByKey, [key]: nextPlan } }));
    await repository.savePlan(nextPlan);

    // A locked-in plan has per-stop reminders with the old venue baked in.
    // Re-issue them so the reminder matches the new stop; if nothing is left
    // to remind about, drop the lock so the UI stays honest.
    if (get().lockedPlanIds[nextPlan.id]) {
      const count = await schedulePlanNotifications(nextPlan);
      if (count === 0) {
        const cleared = omit(get().lockedPlanIds, nextPlan.id);
        set({ lockedPlanIds: cleared });
        await persistLocked(cleared);
      }
    }
    return true;
  },

  async alternativesForItem(date, window, itemId) {
    const key = planKey(date, window);
    const plan = get().plansByKey[key];
    const item = plan?.items.find((i) => i.id === itemId);
    if (!plan || !item) return [];
    return slotCandidates(get, date, window, item);
  },

  async lockInPlan(planId): Promise<LockResult> {
    const plan = Object.values(get().plansByKey).find((p) => p.id === planId);
    if (!plan) return { scheduled: 0, reason: 'none-upcoming' };

    // Check permission up front so we can tell the user *why* nothing was
    // scheduled instead of falsely showing "Locked in".
    const granted = await ensureNotificationPermission();
    if (!granted) return { scheduled: 0, reason: 'permission-denied' };

    const count = await schedulePlanNotifications(plan);
    if (count === 0) {
      // schedulePlanNotifications already cancelled any prior nudges for this
      // plan. If it was flagged locked (e.g. a re-lock where every stop is now
      // in the past), clear that stale flag so state matches reality.
      if (get().lockedPlanIds[planId]) {
        const cleared = omit(get().lockedPlanIds, planId);
        set({ lockedPlanIds: cleared });
        await persistLocked(cleared);
      }
      return { scheduled: 0, reason: 'none-upcoming' };
    }

    const nextLocked = { ...get().lockedPlanIds, [planId]: true };
    set({ lockedPlanIds: nextLocked });
    await persistLocked(nextLocked);
    return { scheduled: count, reason: 'ok' };
  },

  async unlockPlan(planId) {
    await cancelPlanNotifications(planId);
    const next = { ...get().lockedPlanIds };
    delete next[planId];
    set({ lockedPlanIds: next });
    await persistLocked(next);
  },
}));

/** Persist the set of locked-in plan ids (only the truthy ones). */
async function persistLocked(map: Record<string, boolean>): Promise<void> {
  await repository.saveLockedPlanIds(Object.keys(map).filter((id) => map[id]));
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

/** Retire every candidate of an outgoing plan into the seen memory. */
async function retirePlanCandidates(
  set: SetFn,
  get: () => StoreState,
  date: string,
  plan: Plan | undefined,
): Promise<void> {
  if (!plan) return;
  await addSeen(set, get, date, planCandidateIds(plan));
}

/**
 * Candidates that could fill an existing block's slot: same category, allowed
 * at that hour, fits the slot, not already used today, never-repeat honored.
 * Price-filtered first; if that starves the list, the price filter is dropped
 * rather than returning nothing.
 */
async function slotCandidates(
  get: () => StoreState,
  date: string,
  window: TimeWindow,
  item: PlanItem,
): Promise<Candidate[]> {
  const profile = get().profile;
  if (!profile) return [];
  const prefs = resolvePrefs(profile, get().dayPrefsByDate[date]);

  const [eventsRes, placesRes] = await Promise.all([
    eventsProvider.fetchEvents(date),
    placesProvider.fetchPlaces(prefs.neighborhoods),
  ]);
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
    (plan?.items ?? []).map((i) => i.sourceId ?? i.bucketItemId ?? i.id),
  );
  const seen = new Set(get().seenByDate[date] ?? []);

  const pool = [...eventsRes.candidates, ...placesRes.candidates, ...buckets].filter((c) => {
    if (inPlan.has(c.id) || seen.has(c.id)) return false;
    if (!sameCategory(c.kind, item.kind)) return false;
    if (!allowedStart(c, slotStart)) return false;
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

  const priced = pool.filter(
    (c) => c.priceTier == null || (c.priceTier >= prefs.price.min && c.priceTier <= prefs.price.max),
  );
  const usable = priced.length > 0 ? priced : pool;

  const nbset = new Set(prefs.neighborhoods.map((n) => n.toLowerCase()));
  const seenCount = (get().seenByDate[date] ?? []).length;
  return usable
    .map((c) => {
      let score = 0;
      if (c.neighborhood && nbset.has(c.neighborhood.toLowerCase())) score += 5;
      score += c.tags.filter((t) =>
        prefs.interests.some((i) => i.toLowerCase() === t.toLowerCase()),
      ).length * 2;
      score += (hash(`${c.id}:${date}:${seenCount}`) % 7) * 1.3;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score || hash(a.c.id) - hash(b.c.id))
    .map((s) => s.c)
    .slice(0, 12);
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
  const profile = get().profile;
  if (!profile) return;
  const prefs = resolvePrefs(profile, get().dayPrefsByDate[date]);

  set((s) => ({ planning: { ...s.planning, [key]: { status: 'planning' } } }));

  try {
    const [eventsRes, placesRes] = await Promise.all([
      eventsProvider.fetchEvents(date),
      placesProvider.fetchPlaces(prefs.neighborhoods),
    ]);

    const plan = await defaultPlanner.plan({
      date,
      window,
      neighborhoods: prefs.neighborhoods,
      price: prefs.price,
      partySize: prefs.partySize,
      interests: prefs.interests,
      bucketList: get().bucketList.filter((b) => !b.done),
      events: eventsRes.candidates,
      places: placesRes.candidates,
      modifier,
      nonce: nonceByKey[key] ?? 0,
      excludeIds: get().seenByDate[date] ?? [],
      holiday: holidayFor(date),
    });

    // The planner awaited: if the user removed or resized this window while
    // it ran, drop the result instead of resurrecting a plan for a window
    // that no longer exists.
    const windowStillExists = (get().availabilityByDate[date]?.windows ?? []).some(
      (w) => planKey(date, w) === key,
    );
    if (!windowStillExists) {
      set((s) => ({ planning: { ...s.planning, [key]: { status: 'idle' } } }));
      return;
    }

    await repository.savePlan(plan);

    // Everything just suggested joins the day's never-repeat memory right away,
    // so a sibling window generated in the same pass (or any later reshuffle)
    // cannot serve the same stop twice on one day.
    await addSeen(set, get, date, planCandidateIds(plan));

    // A reshuffle invalidates any previously locked-in notifications for the
    // prior plan at this window; cancel them so we don't leave stale nudges.
    const prior = get().plansByKey[key];
    const invalidatesPrior = !!prior && prior.id !== plan.id;
    if (invalidatesPrior) {
      await cancelPlanNotifications(prior!.id);
    }

    // Derive lockedPlanIds from the FRESHEST state inside the updater so a
    // concurrent lock/unlock (which may have run during the awaits above) is
    // not clobbered by a stale snapshot.
    set((s) => ({
      plansByKey: { ...s.plansByKey, [key]: plan },
      planning: { ...s.planning, [key]: { status: 'idle' } },
      lockedPlanIds:
        invalidatesPrior && s.lockedPlanIds[prior!.id]
          ? omit(s.lockedPlanIds, prior!.id)
          : s.lockedPlanIds,
    }));
    if (invalidatesPrior) {
      await persistLocked(get().lockedPlanIds);
    }
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
