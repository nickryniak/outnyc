// =============================================================================
// OutNYC — AsyncStorage-backed Repository (lib/storage/asyncStorageRepository.ts)
// =============================================================================
// On-device persistence behind the Repository interface. All reads parse
// defensively (try/catch around JSON.parse) and never throw on corrupt data —
// they return null/[] and let the caller surface an empty/error state.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_PREFIX } from '../constants';
import type {
  Availability,
  BucketItem,
  DayPrefs,
  Feedback,
  Plan,
  Profile,
} from '../types';
import type { Repository } from './repository';

/** Bump when a stored shape changes; add the upgrade step in migrate(). */
const SCHEMA_VERSION = 1;

const KEYS = {
  schemaVersion: `${STORAGE_PREFIX}schemaVersion`,
  profile: `${STORAGE_PREFIX}profile`,
  availability: `${STORAGE_PREFIX}availability`, // map: date -> Availability
  bucketList: `${STORAGE_PREFIX}bucketList`,
  plans: `${STORAGE_PREFIX}plans`, // map: date|start|end -> Plan
  locked: `${STORAGE_PREFIX}lockedPlanIds`, // array of plan ids with nudges
  feedback: `${STORAGE_PREFIX}feedback`, // array of Feedback
  dayPrefs: `${STORAGE_PREFIX}dayPrefs`, // map: date -> DayPrefs
  seen: `${STORAGE_PREFIX}seenByDate`, // map: date -> candidate ids already used
} as const;

/** Safe read of a JSON value; returns fallback on missing/corrupt data. */
async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    // Corrupt entry — log and fall back rather than crashing a screen.
    console.warn(`[storage] failed to read/parse ${key}:`, err);
    return fallback;
  }
}

async function writeJSON(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/**
 * All mutations that read-modify-write a stored map MUST run serialized.
 * Without this, two near-simultaneous saves (e.g. painting several calendar
 * cells in a burst) both read the same snapshot and the second write silently
 * drops the first one's data.
 */
let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = writeChain.then(work, work);
  // Keep the chain alive even if this work item rejects.
  writeChain = next.catch(() => undefined);
  return next;
}

function planKey(date: string, windowStart: string, windowEnd: string): string {
  return `${date}|${windowStart}|${windowEnd}`;
}

export class AsyncStorageRepository implements Repository {
  readonly name = 'AsyncStorage';

  constructor() {
    // Runs on the write chain so any future migration lands before the first
    // serialized mutation. The chain swallows rejections, so this can't leak
    // an unhandled promise.
    void serialized(() => this.ensureSchemaVersion());
  }

  private async ensureSchemaVersion(): Promise<void> {
    const stored = await readJSON<number | null>(KEYS.schemaVersion, null);
    // Missing key means fresh install or pre-versioning data — both are the
    // version-1 shape, so there is nothing to migrate from.
    const from = stored ?? SCHEMA_VERSION;
    if (from !== SCHEMA_VERSION) {
      await this.migrate(from);
    }
    if (stored !== SCHEMA_VERSION) {
      await writeJSON(KEYS.schemaVersion, SCHEMA_VERSION);
    }
  }

  /** Upgrade stored data from an older schema. No-op today (only v1 exists). */
  private async migrate(fromVersion: number): Promise<void> {
    switch (fromVersion) {
      // case 1: reshape v1 -> v2 here, then fall through to later steps.
      default:
        break;
    }
  }

  async getProfile(): Promise<Profile | null> {
    return readJSON<Profile | null>(KEYS.profile, null);
  }

  async saveProfile(profile: Profile): Promise<void> {
    await writeJSON(KEYS.profile, profile);
  }

  private async availabilityMap(): Promise<Record<string, Availability>> {
    return readJSON<Record<string, Availability>>(KEYS.availability, {});
  }

  async getAvailability(date: string): Promise<Availability | null> {
    const map = await this.availabilityMap();
    return map[date] ?? null;
  }

  async getAllAvailability(): Promise<Availability[]> {
    const map = await this.availabilityMap();
    return Object.values(map);
  }

  async saveAvailability(availability: Availability): Promise<void> {
    await serialized(async () => {
      const map = await this.availabilityMap();
      if (availability.windows.length === 0) {
        delete map[availability.date];
      } else {
        map[availability.date] = availability;
      }
      await writeJSON(KEYS.availability, map);
    });
  }

  async getBucketList(): Promise<BucketItem[]> {
    return readJSON<BucketItem[]>(KEYS.bucketList, []);
  }

  async saveBucketList(items: BucketItem[]): Promise<void> {
    await writeJSON(KEYS.bucketList, items);
  }

  private async plansMap(): Promise<Record<string, Plan>> {
    return readJSON<Record<string, Plan>>(KEYS.plans, {});
  }

  async getPlan(
    date: string,
    windowStart: string,
    windowEnd: string,
  ): Promise<Plan | null> {
    const map = await this.plansMap();
    return map[planKey(date, windowStart, windowEnd)] ?? null;
  }

  async getPlansForDate(date: string): Promise<Plan[]> {
    const map = await this.plansMap();
    return Object.values(map).filter((p) => p.date === date);
  }

  async getAllPlans(): Promise<Plan[]> {
    const map = await this.plansMap();
    return Object.values(map);
  }

  async getLockedPlanIds(): Promise<string[]> {
    return readJSON<string[]>(KEYS.locked, []);
  }

  async saveLockedPlanIds(ids: string[]): Promise<void> {
    // Whole-value write, but serialized so it can't interleave with other
    // writes on the chain (callers read-modify-write this list).
    await serialized(() => writeJSON(KEYS.locked, ids));
  }

  async getAllDayPrefs(): Promise<DayPrefs[]> {
    const map = await readJSON<Record<string, DayPrefs>>(KEYS.dayPrefs, {});
    return Object.values(map);
  }

  async saveDayPrefs(prefs: DayPrefs): Promise<void> {
    await serialized(async () => {
      const map = await readJSON<Record<string, DayPrefs>>(KEYS.dayPrefs, {});
      map[prefs.date] = prefs;
      await writeJSON(KEYS.dayPrefs, map);
    });
  }

  async getSeenMap(): Promise<Record<string, string[]>> {
    return readJSON<Record<string, string[]>>(KEYS.seen, {});
  }

  async saveSeenMap(map: Record<string, string[]>): Promise<void> {
    // Whole-value write, but serialized so it can't interleave with other
    // writes on the chain (callers read-modify-write this map).
    await serialized(() => writeJSON(KEYS.seen, map));
  }

  async savePlan(plan: Plan): Promise<void> {
    await serialized(async () => {
      const map = await this.plansMap();
      map[planKey(plan.date, plan.window.start, plan.window.end)] = plan;
      await writeJSON(KEYS.plans, map);
    });
  }

  async deletePlan(planId: string): Promise<void> {
    await serialized(async () => {
      const map = await this.plansMap();
      const entry = Object.entries(map).find(([, p]) => p.id === planId);
      if (entry) {
        delete map[entry[0]];
        await writeJSON(KEYS.plans, map);
      }
    });
  }

  async getFeedback(planId: string): Promise<Feedback[]> {
    const all = await readJSON<Feedback[]>(KEYS.feedback, []);
    return all.filter((f) => f.planId === planId);
  }

  async addFeedback(feedback: Feedback): Promise<void> {
    await serialized(async () => {
      const all = await readJSON<Feedback[]>(KEYS.feedback, []);
      all.push(feedback);
      await writeJSON(KEYS.feedback, all);
    });
  }

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove([
      KEYS.profile,
      KEYS.availability,
      KEYS.bucketList,
      KEYS.plans,
      KEYS.locked,
      KEYS.feedback,
      KEYS.dayPrefs,
      KEYS.seen,
    ]);
  }
}

/** The single Repository instance the app uses. Swap class here for Supabase. */
export const repository: Repository = new AsyncStorageRepository();
