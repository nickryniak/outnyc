// =============================================================================
// OutNYC — zustand store (lib/store.ts)
// =============================================================================
// The single app store. Wires the Repository, default Planner, providers, and
// local notifications together. Screens read state + call actions; they never
// touch the repository or planner directly.
// =============================================================================

import { create } from 'zustand';

import { BUCKET_SEED, SEED_PROFILE } from './constants';
import {
  cancelPlanNotifications,
  ensureNotificationPermission,
  schedulePlanNotifications,
} from './notifications';
import { defaultPlanner } from './planner';
import { eventsProvider, placesProvider } from './providers';
import { repository } from './storage';
import { isValidWindow } from './time';
import type {
  Availability,
  BucketItem,
  Plan,
  PlanModifier,
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

interface StoreState {
  // ---- bootstrap ----
  loadStatus: LoadStatus;
  loadError?: string;

  // ---- domain ----
  profile: Profile | null;
  availabilityByDate: Record<string, Availability>;
  bucketList: BucketItem[];
  plansByKey: Record<string, Plan>; // key: `${date}|${start}|${end}`

  // ---- transient ----
  planning: Record<string, PlanningState>; // keyed like plansByKey
  lockedPlanIds: Record<string, boolean>; // planId -> notifications scheduled

  // ---- actions ----
  bootstrap(): Promise<void>;
  resetApp(): Promise<void>;
  saveProfile(profile: Profile): Promise<void>;
  completeOnboarding(profile: Omit<Profile, 'onboarded'>): Promise<void>;

  setAvailability(date: string, windows: TimeWindow[]): Promise<void>;

  addBucketItem(input: { title: string; note?: string; neighborhood?: string }): Promise<void>;
  toggleBucketDone(id: string): Promise<void>;
  removeBucketItem(id: string): Promise<void>;

  generatePlan(date: string, window: TimeWindow, modifier?: PlanModifier): Promise<void>;
  reshufflePlan(date: string, window: TimeWindow, modifier: PlanModifier): Promise<void>;
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

type SetFn = (
  partial: Partial<StoreState> | ((s: StoreState) => Partial<StoreState>),
) => void;

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
  // day you planned/locked survives an app restart.
  const plans = await repository.getAllPlans();
  const plansByKey: Record<string, Plan> = {};
  for (const p of plans) plansByKey[planKey(p.date, p.window)] = p;

  const lockedIds = await repository.getLockedPlanIds();
  const lockedPlanIds: Record<string, boolean> = {};
  for (const id of lockedIds) lockedPlanIds[id] = true;

  set({
    profile,
    bucketList,
    availabilityByDate,
    plansByKey,
    lockedPlanIds,
    loadStatus: 'ready',
  });
}

export const useStore = create<StoreState>((set, get) => ({
  loadStatus: 'idle',
  profile: null,
  availabilityByDate: {},
  bucketList: [],
  plansByKey: {},
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

  async setAvailability(date, windows) {
    const valid = windows.filter(isValidWindow);
    const availability: Availability = { date, windows: valid };
    await repository.saveAvailability(availability);
    set((s) => {
      const next = { ...s.availabilityByDate };
      if (valid.length === 0) delete next[date];
      else next[date] = availability;
      return { availabilityByDate: next };
    });
  },

  async addBucketItem(input) {
    const items = get().bucketList;
    const maxOrder = items.reduce((m, b) => Math.max(m, b.sortOrder), -1);
    const item: BucketItem = {
      id: genId('bucket'),
      title: input.title.trim(),
      note: input.note?.trim() || undefined,
      neighborhood: input.neighborhood?.trim() || undefined,
      tags: [],
      done: false,
      sortOrder: maxOrder + 1,
    };
    const next = [...items, item];
    await repository.saveBucketList(next);
    set({ bucketList: next });
  },

  async toggleBucketDone(id) {
    const next = get().bucketList.map((b) =>
      b.id === id ? { ...b, done: !b.done } : b,
    );
    await repository.saveBucketList(next);
    set({ bucketList: next });
  },

  async removeBucketItem(id) {
    const next = get().bucketList.filter((b) => b.id !== id);
    await repository.saveBucketList(next);
    set({ bucketList: next });
  },

  async generatePlan(date, window, modifier) {
    return runPlan(set, get, date, window, modifier);
  },

  async reshufflePlan(date, window, modifier) {
    return runPlan(set, get, date, window, modifier);
  },

  async lockInPlan(planId): Promise<LockResult> {
    const plan = Object.values(get().plansByKey).find((p) => p.id === planId);
    if (!plan) return { scheduled: 0, reason: 'none-upcoming' };

    // Check permission up front so we can tell the user *why* nothing was
    // scheduled instead of falsely showing "Locked in".
    const granted = await ensureNotificationPermission();
    if (!granted) return { scheduled: 0, reason: 'permission-denied' };

    const count = await schedulePlanNotifications(plan);
    if (count === 0) return { scheduled: 0, reason: 'none-upcoming' };

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

/** Shared plan-generation routine for generate + reshuffle. */
async function runPlan(
  set: (
    partial:
      | Partial<StoreState>
      | ((s: StoreState) => Partial<StoreState>),
  ) => void,
  get: () => StoreState,
  date: string,
  window: TimeWindow,
  modifier: PlanModifier | undefined,
): Promise<void> {
  const key = planKey(date, window);
  const profile = get().profile;
  if (!profile) return;

  set((s) => ({ planning: { ...s.planning, [key]: { status: 'planning' } } }));

  try {
    const [eventsRes, placesRes] = await Promise.all([
      eventsProvider.fetchEvents(date),
      placesProvider.fetchPlaces(profile.defaultNeighborhoods),
    ]);

    const plan = await defaultPlanner.plan({
      date,
      window,
      neighborhoods: profile.defaultNeighborhoods,
      price: profile.priceRange,
      partySize: profile.partySize,
      interests: profile.interests,
      bucketList: get().bucketList.filter((b) => !b.done),
      events: eventsRes.candidates,
      places: placesRes.candidates,
      modifier,
    });

    await repository.savePlan(plan);

    // A reshuffle invalidates any previously locked-in notifications for the
    // prior plan at this window; cancel them so we don't leave stale nudges.
    const prior = get().plansByKey[key];
    const invalidatesPrior = !!prior && prior.id !== plan.id;
    if (invalidatesPrior) {
      await cancelPlanNotifications(prior!.id);
    }

    let nextLocked = get().lockedPlanIds;
    if (invalidatesPrior && nextLocked[prior!.id]) {
      nextLocked = omit(nextLocked, prior!.id);
      await persistLocked(nextLocked);
    }

    set((s) => ({
      plansByKey: { ...s.plansByKey, [key]: plan },
      planning: { ...s.planning, [key]: { status: 'idle' } },
      lockedPlanIds: nextLocked,
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
