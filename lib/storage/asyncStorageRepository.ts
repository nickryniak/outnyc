// =============================================================================
// OutNYC: AsyncStorage-backed Repository (lib/storage/asyncStorageRepository.ts)
// =============================================================================
// On-device persistence behind the Repository interface. Reads are doubly
// defensive: try/catch around JSON.parse AND shape validation on what parsed,
// so a corrupt or wrong-version value can never crash bootstrap: it degrades
// to a missing row instead. Writes report failures (storage full, storage
// blocked) through onPersistenceError so the UI can warn instead of silently
// losing everything on the next reload.
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
  locked: `${STORAGE_PREFIX}lockedPlanIds`, // legacy (reminders removed): still wiped by clearAll
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
    // Corrupt entry: log and fall back rather than crashing a screen.
    console.warn(`[storage] failed to read/parse ${key}:`, err);
    return fallback;
  }
}

/**
 * Called (at most once per failure) when a storage WRITE fails: quota
 * exceeded, storage blocked, disk full. The store registers a handler that
 * flips a "your changes are not being saved" banner. Writes never throw:
 * in-memory state is already updated by the time we persist, and a throw here
 * would brick bootstrap's healing writes.
 */
let persistenceErrorHandler: ((err: unknown) => void) | null = null;
export function onPersistenceError(handler: (err: unknown) => void): void {
  persistenceErrorHandler = handler;
}

async function writeJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[storage] failed to write ${key}:`, err);
    persistenceErrorHandler?.(err);
  }
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

// ---- shape validation -------------------------------------------------------
// Stored values can be truncated mid-write, hand-edited, or written by a
// different app version. Everything read from disk passes one of these guards
// before the store sees it; invalid entries are dropped, never thrown on.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v != null && !Array.isArray(v);
}

function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function isAvailability(v: unknown): v is Availability {
  return (
    isRecord(v) &&
    typeof v.date === 'string' &&
    DATE_RE.test(v.date) &&
    Array.isArray(v.windows) &&
    v.windows.every(
      (w) => isRecord(w) && typeof w.start === 'string' && typeof w.end === 'string',
    )
  );
}

function isPlan(v: unknown): v is Plan {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.date === 'string' &&
    DATE_RE.test(v.date) &&
    isRecord(v.window) &&
    typeof v.window.start === 'string' &&
    typeof v.window.end === 'string' &&
    Array.isArray(v.items) &&
    v.items.every((i) => isRecord(i) && typeof i.title === 'string' && typeof i.id === 'string')
  );
}

function isDayPrefs(v: unknown): v is DayPrefs {
  return isRecord(v) && typeof v.date === 'string' && DATE_RE.test(v.date);
}

function isBucketItem(v: unknown): v is BucketItem {
  return isRecord(v) && typeof v.id === 'string' && typeof v.title === 'string';
}

function isProfile(v: unknown): v is Profile {
  return (
    isRecord(v) &&
    typeof v.partySize === 'number' &&
    Array.isArray(v.defaultNeighborhoods) &&
    Array.isArray(v.interests) &&
    isRecord(v.priceRange) &&
    typeof v.priceRange.min === 'number' &&
    typeof v.priceRange.max === 'number' &&
    typeof v.onboarded === 'boolean'
  );
}

/** Read a per-date map, dropping entries that fail the guard. */
async function readMap<T>(key: string, guard: (v: unknown) => v is T): Promise<Record<string, T>> {
  const raw = asRecord(await readJSON<unknown>(key, {}));
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (guard(v)) out[k] = v;
  }
  return out;
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
    // Data stamped by NEWER code (a stale cached bundle running against a
    // migrated store): leave it completely alone. Re-stamping the older
    // version here would make the next up-to-date launch re-run migrations
    // against already-migrated data.
    if (typeof stored === 'number' && stored > SCHEMA_VERSION) return;
    // Missing key means fresh install or pre-versioning data: both are the
    // version-1 shape, so there is nothing to migrate from.
    const from = typeof stored === 'number' ? stored : SCHEMA_VERSION;
    if (from < SCHEMA_VERSION) {
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
    const raw = await readJSON<unknown>(KEYS.profile, null);
    return isProfile(raw) ? raw : null;
  }

  async saveProfile(profile: Profile): Promise<void> {
    await writeJSON(KEYS.profile, profile);
  }

  private async availabilityMap(): Promise<Record<string, Availability>> {
    return readMap(KEYS.availability, isAvailability);
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
    const raw = await readJSON<unknown>(KEYS.bucketList, []);
    if (!Array.isArray(raw)) return [];
    // Normalize optional fields so one missing property (partial corruption,
    // older app version) degrades to defaults instead of crashing the healer.
    return raw.filter(isBucketItem).map((item, i) => ({
      ...item,
      tags: Array.isArray(item.tags) ? item.tags : [],
      done: item.done === true,
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : i,
    }));
  }

  async saveBucketList(items: BucketItem[]): Promise<void> {
    // Serialized: a whole-value write racing a concurrent read-modify-write
    // on the chain could interleave halves of two saves.
    await serialized(() => writeJSON(KEYS.bucketList, items));
  }

  private async plansMap(): Promise<Record<string, Plan>> {
    return readMap(KEYS.plans, isPlan);
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

  async getAllDayPrefs(): Promise<DayPrefs[]> {
    const map = await readMap(KEYS.dayPrefs, isDayPrefs);
    return Object.values(map);
  }

  async saveDayPrefs(prefs: DayPrefs): Promise<void> {
    await serialized(async () => {
      const map = await readMap(KEYS.dayPrefs, isDayPrefs);
      map[prefs.date] = prefs;
      await writeJSON(KEYS.dayPrefs, map);
    });
  }

  async getSeenMap(): Promise<Record<string, string[]>> {
    const raw = asRecord(await readJSON<unknown>(KEYS.seen, {}));
    const out: Record<string, string[]> = {};
    for (const [date, ids] of Object.entries(raw)) {
      if (!DATE_RE.test(date) || !Array.isArray(ids)) continue;
      out[date] = ids.filter((id): id is string => typeof id === 'string');
    }
    return out;
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
    const all = await readJSON<unknown>(KEYS.feedback, []);
    if (!Array.isArray(all)) return [];
    return all.filter(
      (f): f is Feedback => isRecord(f) && f.planId === planId,
    );
  }

  async addFeedback(feedback: Feedback): Promise<void> {
    await serialized(async () => {
      const all = await readJSON<unknown>(KEYS.feedback, []);
      const list = Array.isArray(all) ? all : [];
      list.push(feedback);
      await writeJSON(KEYS.feedback, list);
    });
  }

  async pruneBefore(cutoffDate: string): Promise<void> {
    await serialized(async () => {
      const avail = await this.availabilityMap();
      let changed = false;
      for (const date of Object.keys(avail)) {
        if (date < cutoffDate) {
          delete avail[date];
          changed = true;
        }
      }
      if (changed) await writeJSON(KEYS.availability, avail);

      const plans = await this.plansMap();
      changed = false;
      for (const [key, p] of Object.entries(plans)) {
        if (p.date < cutoffDate) {
          delete plans[key];
          changed = true;
        }
      }
      if (changed) await writeJSON(KEYS.plans, plans);

      const prefs = await readMap(KEYS.dayPrefs, isDayPrefs);
      changed = false;
      for (const date of Object.keys(prefs)) {
        if (date < cutoffDate) {
          delete prefs[date];
          changed = true;
        }
      }
      if (changed) await writeJSON(KEYS.dayPrefs, prefs);

      // Feedback rows only mean anything while their plan exists.
      const rawFeedback = await readJSON<unknown>(KEYS.feedback, []);
      if (Array.isArray(rawFeedback) && rawFeedback.length > 0) {
        const planIds = new Set(Object.values(plans).map((p) => p.id));
        const kept = rawFeedback.filter((f) => isRecord(f) && planIds.has(f.planId as string));
        if (kept.length !== rawFeedback.length) await writeJSON(KEYS.feedback, kept);
      }
    });
  }

  async clearAll(): Promise<void> {
    // Serialized so a queued earlier write can't land AFTER the wipe and
    // resurrect pre-reset data.
    await serialized(() =>
      AsyncStorage.multiRemove([
        KEYS.profile,
        KEYS.availability,
        KEYS.bucketList,
        KEYS.plans,
        KEYS.locked,
        KEYS.feedback,
        KEYS.dayPrefs,
        KEYS.seen,
      ]),
    );
  }
}

/** The single Repository instance the app uses. Swap class here for Supabase. */
export const repository: Repository = new AsyncStorageRepository();
