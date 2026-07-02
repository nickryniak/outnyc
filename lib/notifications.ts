// =============================================================================
// OutNYC — local notifications (lib/notifications.ts)
// =============================================================================
// LOCAL notifications only. We never register a remote push token (that path is
// unsupported in Expo Go on SDK 53+). On "lock-in", we schedule a local nudge a
// few minutes before each timed stop, using America/New_York-correct trigger
// times. All functions degrade gracefully if permissions are denied.
// =============================================================================

import * as Notifications from 'expo-notifications';

import { format12h, nyDateTimeToLocalDate } from './time';
import type { Plan, PlanItem } from './types';

// Minutes before a stop's start to fire the nudge.
const LEAD_MIN = 20;

let handlerConfigured = false;

function configureHandler(): void {
  if (handlerConfigured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  handlerConfigured = true;
}

/** Request permission to post local notifications. Returns true if granted. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    configureHandler();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch (err) {
    console.warn('[notifications] permission check failed:', err);
    return false;
  }
}

/** A tag we attach so we can cancel a plan's nudges on reshuffle/cancel. */
function planTag(planId: string): string {
  return `plan:${planId}`;
}

function shouldNotify(item: PlanItem): boolean {
  // Skip pure connectors.
  return item.kind !== 'walk' && item.kind !== 'break';
}

/**
 * Schedule local nudges for each timed stop in a plan. Returns the count
 * scheduled plus how many stops were skipped because they start within
 * LEAD_MIN (the nudge would land in the past). Never throws; logs and
 * returns what it managed to schedule.
 */
export async function schedulePlanNotifications(
  plan: Plan,
): Promise<{ scheduled: number; skipped: number }> {
  const granted = await ensureNotificationPermission();
  if (!granted) return { scheduled: 0, skipped: 0 };

  // Clear any prior nudges for this plan first (idempotent re-locking).
  await cancelPlanNotifications(plan.id);

  let scheduled = 0;
  let skipped = 0;
  const now = Date.now();

  for (const item of plan.items) {
    if (!shouldNotify(item)) continue;
    const start = nyDateTimeToLocalDate(plan.date, item.startTime);
    const fireAt = new Date(start.getTime() - LEAD_MIN * 60 * 1000);
    if (fireAt.getTime() <= now) {
      skipped += 1; // starts too soon — the nudge would fire in the past
      continue;
    }

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Up next: ${item.title}`,
          body: item.neighborhood
            ? `${format12h(item.startTime)} in ${item.neighborhood}`
            : `Starts at ${format12h(item.startTime)}`,
          data: { tag: planTag(plan.id), planItemId: item.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
        },
      });
      scheduled += 1;
    } catch (err) {
      console.warn('[notifications] failed to schedule for', item.id, err);
    }
  }
  return { scheduled, skipped };
}

/** Cancel all scheduled nudges for a plan. */
export async function cancelPlanNotifications(planId: string): Promise<void> {
  try {
    const tag = planTag(planId);
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .filter((n) => {
          const data = n.content.data as { tag?: string } | null;
          return data?.tag === tag;
        })
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch (err) {
    console.warn('[notifications] cancel failed:', err);
  }
}
