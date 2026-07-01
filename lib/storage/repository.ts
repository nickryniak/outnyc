// =============================================================================
// OutNYC — Repository interface (lib/storage/repository.ts)
// =============================================================================
// The persistence contract. Screens and the store depend ONLY on this interface
// (never on a concrete impl), so a Supabase-backed Repository can be swapped in
// later without touching any screen. Mirrors the SQL tables 1:1.
// =============================================================================

import type {
  Availability,
  BucketItem,
  DayPrefs,
  Feedback,
  Plan,
  Profile,
} from '../types';

export interface Repository {
  // ---- profile (single row) ----
  getProfile(): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;

  // ---- availability (one row per date) ----
  getAvailability(date: string): Promise<Availability | null>;
  getAllAvailability(): Promise<Availability[]>;
  saveAvailability(availability: Availability): Promise<void>;

  // ---- bucket list ----
  getBucketList(): Promise<BucketItem[]>;
  saveBucketList(items: BucketItem[]): Promise<void>;

  // ---- plans (keyed by date+window) ----
  getPlan(date: string, windowStart: string, windowEnd: string): Promise<Plan | null>;
  getPlansForDate(date: string): Promise<Plan[]>;
  getAllPlans(): Promise<Plan[]>;
  savePlan(plan: Plan): Promise<void>;
  deletePlan(planId: string): Promise<void>;

  // ---- locked-in plans (ids with scheduled notifications) ----
  getLockedPlanIds(): Promise<string[]>;
  saveLockedPlanIds(ids: string[]): Promise<void>;

  // ---- per-day planner preferences (one row per date) ----
  getAllDayPrefs(): Promise<DayPrefs[]>;
  saveDayPrefs(prefs: DayPrefs): Promise<void>;

  // ---- never-repeat memory: candidate ids already suggested, per date ----
  getSeenMap(): Promise<Record<string, string[]>>;
  saveSeenMap(map: Record<string, string[]>): Promise<void>;

  // ---- feedback ----
  getFeedback(planId: string): Promise<Feedback[]>;
  addFeedback(feedback: Feedback): Promise<void>;

  // ---- maintenance ----
  /** Wipe all OutNYC data (used by "reset app" in Settings). */
  clearAll(): Promise<void>;
}
