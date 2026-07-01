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
  Feedback,
  Plan,
  Profile,
} from '../types';
import type { Repository } from './repository';

const KEYS = {
  profile: `${STORAGE_PREFIX}profile`,
  availability: `${STORAGE_PREFIX}availability`, // map: date -> Availability
  bucketList: `${STORAGE_PREFIX}bucketList`,
  plans: `${STORAGE_PREFIX}plans`, // map: date|start|end -> Plan
  locked: `${STORAGE_PREFIX}lockedPlanIds`, // array of plan ids with nudges
  feedback: `${STORAGE_PREFIX}feedback`, // array of Feedback
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

function planKey(date: string, windowStart: string, windowEnd: string): string {
  return `${date}|${windowStart}|${windowEnd}`;
}

export class AsyncStorageRepository implements Repository {
  readonly name = 'AsyncStorage';

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
    const map = await this.availabilityMap();
    if (availability.windows.length === 0) {
      delete map[availability.date];
    } else {
      map[availability.date] = availability;
    }
    await writeJSON(KEYS.availability, map);
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
    await writeJSON(KEYS.locked, ids);
  }

  async savePlan(plan: Plan): Promise<void> {
    const map = await this.plansMap();
    map[planKey(plan.date, plan.window.start, plan.window.end)] = plan;
    await writeJSON(KEYS.plans, map);
  }

  async deletePlan(planId: string): Promise<void> {
    const map = await this.plansMap();
    const entry = Object.entries(map).find(([, p]) => p.id === planId);
    if (entry) {
      delete map[entry[0]];
      await writeJSON(KEYS.plans, map);
    }
  }

  async getFeedback(planId: string): Promise<Feedback[]> {
    const all = await readJSON<Feedback[]>(KEYS.feedback, []);
    return all.filter((f) => f.planId === planId);
  }

  async addFeedback(feedback: Feedback): Promise<void> {
    const all = await readJSON<Feedback[]>(KEYS.feedback, []);
    all.push(feedback);
    await writeJSON(KEYS.feedback, all);
  }

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove([
      KEYS.profile,
      KEYS.availability,
      KEYS.bucketList,
      KEYS.plans,
      KEYS.locked,
      KEYS.feedback,
    ]);
  }
}

/** The single Repository instance the app uses. Swap class here for Supabase. */
export const repository: Repository = new AsyncStorageRepository();
