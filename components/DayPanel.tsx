// =============================================================================
// OutNYC: expanded day panel (components/DayPanel.tsx)
// =============================================================================
// Renders in place below the calendar when a day is selected. Shows:
//   - the day header with holiday context and the single day-scope Reshuffle
//   - per-day preferences (neighborhoods, price, party size, interests) that
//     override the defaults for this day only
//   - the itinerary with a description, a real link (or an explicit "No
//     website listed"), Directions, a per-block Swap, and a "Choose a
//     replacement" list of everything else happening in that slot
// =============================================================================

import { useRouter } from 'expo-router';
import { CalendarRange, ChevronDown, ChevronUp, ExternalLink, RefreshCw, X } from 'lucide-react-native';
import { memo, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { confirmDestructive } from '../lib/confirm';
import { INTEREST_TAGS, NEIGHBORHOODS, PRICE_TIERS } from '../lib/constants';
import { priceLabel, ratingText } from '../lib/format';
import { holidayFor } from '../lib/holidays';
import { stopLabel } from '../lib/labels';
import { openExternal } from '../lib/linking';
import { mapsUrl } from '../lib/maps';
import { CROSS_CATEGORY_INTENTS, planKey, resolvePrefs, useStore, type SwapIntent } from '../lib/store';
import { colors, font, kindColor, radius, spacing, withAlpha } from '../lib/theme';
import { format12h, monthDayLabel, weekdayLabel } from '../lib/time';
import type { Candidate, PlanItem, PlanItemKind, PriceTier, TimeWindow } from '../lib/types';

/** Human label for a swap intent, used for both the chip and failure copy. */
const INTENT_LABEL: Record<SwapIntent, string> = {
  cheaper: 'Cheaper',
  pricier: 'Pricier',
  surprise: 'Surprise me',
  indoor: 'Indoors',
  italian: 'Italian',
  pizza: 'Pizza',
  japanese: 'Japanese',
  sushi: 'Sushi',
  thai: 'Thai',
  chinese: 'Chinese',
  korean: 'Korean',
  indian: 'Indian',
  mexican: 'Mexican',
  french: 'French',
  southern: 'Southern',
  greek: 'Greek',
  deli: 'Deli',
  mediterranean: 'Mediterranean',
  peruvian: 'Peruvian',
  seafood: 'Seafood',
  steakhouse: 'Steakhouse',
  vegan: 'Vegan',
  bakery: 'Bakery',
  coffee: 'Coffee',
  rooftop: 'Rooftop',
  'live-music': 'Live music',
  comedy: 'Comedy',
  art: 'Art',
  outdoors: 'Outdoors',
  film: 'Film',
};

/**
 * Every swap-intent chip, shown on EVERY stop regardless of its current kind.
 * Groups are MECE: each option belongs to exactly one dimension:
 *   Price  : relative cost moves (stay within today's stop kind)
 *   Setting: where it happens (Indoors stays within kind; Outdoors is a
 *             category override that can swap in a park)
 *   Cuisine: food/drink venue types (explicit category overrides)
 *   Vibe   : entertainment/mood types (explicit category overrides)
 * "Surprise me" is its own standalone chip (random pick, same kind).
 * Category overrides are store.ts's CROSS_CATEGORY_INTENTS: "Coffee" or
 * "Outdoors" swaps in a coffee shop or a park no matter what's scheduled here.
 */
const SWAP_INTENT_GROUPS: { label: string; intents: SwapIntent[] }[] = [
  { label: 'Price', intents: ['cheaper', 'pricier'] },
  { label: 'Setting', intents: ['indoor', 'outdoors'] },
  {
    label: 'Cuisine',
    intents: [
      'italian',
      'pizza',
      'japanese',
      'sushi',
      'thai',
      'chinese',
      'korean',
      'indian',
      'mexican',
      'french',
      'southern',
      'greek',
      'deli',
      'mediterranean',
      'peruvian',
      'seafood',
      'steakhouse',
      'vegan',
      'bakery',
      'coffee',
    ],
  },
  { label: 'Vibe', intents: ['rooftop', 'live-music', 'comedy', 'art', 'film'] },
];

/** Which swap group opens by default, keyed off what's scheduled here now. */
function defaultSwapGroup(kind: PlanItemKind): string {
  if (kind === 'restaurant') return 'Cuisine';
  if (kind === 'bar' || kind === 'event') return 'Vibe';
  return 'Setting';
}

/**
 * The one canonical "nothing fits this slot" message. With the full catalog
 * plus the week-repeat fallback this should be rare: when it does appear it
 * means the slot itself is the constraint (hour, length, or neighborhoods).
 */
const NOTHING_NEW_COPY =
  'Nothing else fits this slot: try a longer window or different neighborhoods for this day.';

const PRESETS: { label: string; start: string; end: string }[] = [
  { label: 'Morning', start: '09:00', end: '12:00' },
  { label: 'Afternoon', start: '12:00', end: '17:00' },
  { label: 'Evening', start: '18:00', end: '23:00' },
  { label: 'All day', start: '10:00', end: '23:00' },
];

export function DayPanel({ date, onClose }: { date: string; onClose: () => void }) {
  const router = useRouter();
  const profile = useStore((s) => s.profile);
  // Select the availability RECORD (a stable reference), then derive the array
  // in render: returning `?? []` straight from the selector makes a new array
  // every call and sends zustand's snapshot check into an infinite loop.
  const availability = useStore((s) => s.availabilityByDate[date]);
  const windows = availability?.windows ?? [];
  const dayPrefs = useStore((s) => s.dayPrefsByDate[date]);
  const eventsNote = useStore((s) => s.eventsNoteByDate[date]);
  const reshuffleDay = useStore((s) => s.reshuffleDay);
  const setAvailability = useStore((s) => s.setAvailability);
  const clearDay = useStore((s) => s.clearDay);
  const holiday = holidayFor(date);

  const [busy, setBusy] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  if (!profile) {
    // Still hydrating: hold the panel's place instead of blinking it away.
    return (
      <View style={styles.panel}>
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, { width: '55%' }]} />
      </View>
    );
  }
  const prefs = resolvePrefs(profile, dayPrefs);
  // A real day override carries more than just its `date` key (a cleared one is
  // just `{date}`), so the day is clearable even with no free time yet.
  const hasDayPrefs = !!dayPrefs && Object.keys(dayPrefs).length > 1;

  async function onReshuffle() {
    setBusy(true);
    try {
      await reshuffleDay(date);
    } finally {
      setBusy(false);
    }
  }

  function onClearDay() {
    confirmDestructive(
      'Clear this day?',
      `Removes the free time, plan, and neighborhood picks for ${weekdayLabel(date)}. Your bucket list is kept.`,
      'Clear day',
      () => {
        clearDay(date);
        onClose();
      },
    );
  }

  return (
    <View style={styles.panel}>
      {/* Header */}
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headDate}>
            {weekdayLabel(date)}, {monthDayLabel(date)}
          </Text>
          {holiday ? (
            // Soft same-hue wash behind the colored name keeps it readable on
            // cream no matter which accent the holiday carries.
            <View style={[styles.holidayChip, { backgroundColor: withAlpha(holiday.color, 0.15) }]}>
              <Text style={[styles.holidayLabel, { color: holiday.color }]}>{holiday.name}</Text>
            </View>
          ) : null}
        </View>
        {windows.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reshuffle this day"
            disabled={busy}
            onPress={() => void onReshuffle()}
            style={[styles.reshuffleBtn, busy && { opacity: 0.6 }]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <RefreshCw size={13} color={colors.onAccent} strokeWidth={2.2} />
            )}
            <Text style={styles.reshuffleText}>Reshuffle</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close day panel"
          // 16px icon + 4px padding = 24px visible; +12 a side clears 40px.
          hitSlop={12}
          onPress={onClose}
          style={styles.closeBtn}
        >
          <X size={16} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      </View>

      {/* Per-day preferences */}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Shows neighborhoods, price, and party size for this day. Double tap to edit."
        accessibilityState={{ expanded: prefsOpen }}
        onPress={() => setPrefsOpen((o) => !o)}
        style={({ pressed }) => [styles.prefsToggle, pressed && styles.prefsTogglePressed]}
      >
        <Text style={styles.prefsToggleText} numberOfLines={2} ellipsizeMode="tail">
          {prefs.neighborhoods.slice(0, 3).join(', ')}
          {prefs.neighborhoods.length > 3 ? ` +${prefs.neighborhoods.length - 3}` : ''}
          {'  ·  '}
          {priceLabel(prefs.price.min)}
          {prefs.price.max > prefs.price.min ? ` to ${priceLabel(prefs.price.max)}` : ''}
          {'  ·  party of '}
          {prefs.partySize}
        </Text>
        {prefsOpen ? (
          <ChevronUp size={14} color={colors.textMuted} />
        ) : (
          <ChevronDown size={14} color={colors.textMuted} />
        )}
      </Pressable>
      {prefsOpen ? <DayPrefsEditor date={date} /> : null}

      {windows.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/plan/[date]', params: { date } })}
          style={styles.fullDayLink}
        >
          <CalendarRange size={13} color={colors.accent} strokeWidth={2} />
          <Text style={styles.fullDayLinkText}>Full day view</Text>
        </Pressable>
      ) : null}

      {/* Live event feeds answered but had nothing in this day's areas:
          honest provenance for the curated picks that filled in (distinct
          from a live failure, which the provider reports as an error). */}
      {windows.length > 0 && eventsNote === 'live-no-area-matches' ? (
        <Text style={styles.providerNote}>
          Live event listings had nothing in this day&apos;s neighborhoods, so
          curated picks fill in.
        </Text>
      ) : null}

      {/* Itineraries per window */}
      {windows.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            No free time yet. Tap or drag hours in the calendar above, or add a block:
          </Text>
          <View style={styles.presetWrap}>
            {PRESETS.map((p) => (
              <Pressable
                key={p.label}
                accessibilityRole="button"
                onPress={() => void setAvailability(date, [{ start: p.start, end: p.end }])}
                style={styles.preset}
              >
                <Text style={styles.presetText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        windows.map((w) => <WindowItinerary key={`${w.start}-${w.end}`} date={date} window={w} />)
      )}

      {windows.length > 0 || hasDayPrefs ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear this day"
          onPress={onClearDay}
          hitSlop={6}
          style={styles.clearDayBtn}
        >
          <Text style={styles.clearDayText}>Clear this day</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- Per-day preference editor ------------------------------------------------

function DayPrefsEditor({ date }: { date: string }) {
  const profile = useStore((s) => s.profile);
  const dayPrefs = useStore((s) => s.dayPrefsByDate[date]);
  const setDayPrefs = useStore((s) => s.setDayPrefs);
  const clearDayPrefs = useStore((s) => s.clearDayPrefs);
  if (!profile) return null;
  const prefs = resolvePrefs(profile, dayPrefs);

  function toggleList(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  return (
    <View style={styles.prefsBody}>
      <Text style={styles.prefsLabel}>NEIGHBORHOODS FOR THIS DAY</Text>
      <View style={styles.chipWrap}>
        {NEIGHBORHOODS.map((n) => {
          const on = prefs.neighborhoods.includes(n);
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => void setDayPrefs(date, { neighborhoods: toggleList(prefs.neighborhoods, n) })}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.prefsLabel}>PRICE</Text>
      <View style={styles.chipWrap}>
        {PRICE_TIERS.map((t) => {
          const on = t >= prefs.price.min && t <= prefs.price.max;
          return (
            <Pressable
              key={t}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                // Move whichever edge is strictly closer to the tapped tier;
                // an exact tie moves max.
                const { min, max } = prefs.price;
                const next =
                  Math.abs(t - min) < Math.abs(t - max)
                    ? { min: Math.min(t, max) as PriceTier, max }
                    : { min, max: Math.max(t, min) as PriceTier };
                void setDayPrefs(date, { price: next });
              }}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{priceLabel(t)}</Text>
            </Pressable>
          );
        })}
        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Smaller party"
            hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
            onPress={() => void setDayPrefs(date, { partySize: Math.max(1, prefs.partySize - 1) })}
            style={styles.stepBtn}
          >
            <Text style={styles.stepText} maxFontSizeMultiplier={1.4}>−</Text>
          </Pressable>
          <Text style={styles.stepValue} accessibilityLiveRegion="polite">
            party of {prefs.partySize}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Larger party"
            hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
            onPress={() => void setDayPrefs(date, { partySize: Math.min(20, prefs.partySize + 1) })}
            style={styles.stepBtn}
          >
            <Text style={styles.stepText} maxFontSizeMultiplier={1.4}>+</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.prefsLabel}>INTERESTS</Text>
      <View style={styles.chipWrap}>
        {INTEREST_TAGS.map((t) => {
          const on = prefs.interests.includes(t);
          return (
            <Pressable
              key={t}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => void setDayPrefs(date, { interests: toggleList(prefs.interests, t) })}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{t}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void clearDayPrefs(date)}
        style={styles.resetLink}
      >
        <Text style={styles.resetLinkText}>Use my usual preferences</Text>
      </Pressable>
    </View>
  );
}

// ---- One window's itinerary ----------------------------------------------------

// Memoized: DayPanel re-renders on every store change; a window's props
// (date + the window object off the stable availability record) rarely do.
const WindowItinerary = memo(function WindowItinerary({
  date,
  window: w,
}: {
  date: string;
  window: TimeWindow;
}) {
  const key = planKey(date, w);
  const plan = useStore((s) => s.plansByKey[key]);
  const planning = useStore((s) => s.planning[key]);
  const generatePlan = useStore((s) => s.generatePlan);

  // Windows normally arrive pre-planned (setting free time IS planning it),
  // but a window restored from an older build may not have a plan yet:
  // auto-plan it instead of showing a button.
  const planStatus = planning?.status ?? 'idle';
  useEffect(() => {
    if (!plan && planStatus === 'idle') void generatePlan(date, w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, plan, planStatus]);

  const stops = (plan?.items ?? []).filter((i) => i.kind !== 'walk' && i.kind !== 'break');

  if (!plan && planStatus === 'error') {
    // Without this branch a failed generation would spin forever (the ensure
    // effect only fires while idle). Offer the retry explicitly.
    return (
      <View style={styles.windowBox}>
        <Text style={styles.windowLabel}>
          {format12h(w.start)} to {format12h(w.end)}
        </Text>
        <Text style={styles.emptyText}>
          {planning?.error ?? 'Could not build a plan for this window.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void generatePlan(date, w)}
          style={styles.linkBtn}
        >
          <Text style={styles.linkBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!plan || planStatus === 'planning') {
    return (
      <View style={styles.windowBox}>
        <Text style={styles.windowLabel}>
          {format12h(w.start)} to {format12h(w.end)}
        </Text>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (stops.length === 0) {
    // A committed-but-empty plan means nothing fits this slot even after the
    // week-repeat fallback: the window itself (hour, length, neighborhoods)
    // is the constraint, so say so instead of offering a no-op re-plan.
    return (
      <View style={styles.windowBox}>
        <Text style={styles.windowLabel}>
          {format12h(w.start)} to {format12h(w.end)}
        </Text>
        <Text style={styles.emptyText}>{NOTHING_NEW_COPY}</Text>
      </View>
    );
  }

  return (
    <View style={styles.windowBox}>
      <Text style={styles.windowLabel}>
        {format12h(w.start)} to {format12h(w.end)}
      </Text>
      {stops.map((item) => (
        <StopRow key={`${item.id}-${item.startTime}`} date={date} window={w} item={item} />
      ))}
    </View>
  );
});

// ---- One stop row with swap + alternatives -------------------------------------

// Memoized for the same reason as WindowItinerary; `item` is a stable ref
// until the plan itself changes.
const StopRow = memo(function StopRow({
  date,
  window: w,
  item,
}: {
  date: string;
  window: TimeWindow;
  item: PlanItem;
}) {
  const swapPlanItem = useStore((s) => s.swapPlanItem);
  const alternativesForItem = useStore((s) => s.alternativesForItem);

  const [swapping, setSwapping] = useState(false);
  const [swapMsg, setSwapMsg] = useState<string | null>(null);
  const [swapMenuOpen, setSwapMenuOpen] = useState(false);
  // Only the group most relevant to this stop starts expanded: 21 flat chips
  // is a wall; the rest stay one tap away behind their headers.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    [defaultSwapGroup(item.kind)]: true,
  }));
  const [altsOpen, setAltsOpen] = useState(false);
  const [alts, setAlts] = useState<Candidate[] | null>(null);

  const directions = mapsUrl(item);
  const label = stopLabel(item.kind, item.startTime, item.tags);

  async function onSwap(replacementId?: string, intent?: SwapIntent) {
    setSwapping(true);
    setSwapMsg(null);
    try {
      const ok = await swapPlanItem(date, w, item.id, replacementId, intent);
      if (ok) {
        setSwapMenuOpen(false);
        setAltsOpen(false);
        setAlts(null);
      } else if (replacementId) {
        // The tapped option was consumed elsewhere this week (or fell out of
        // the fresh ranking): refresh the list instead of blaming the prefs.
        const list = await alternativesForItem(date, w, item.id);
        setAlts(list);
        setSwapMsg(
          list.length > 0
            ? 'That option was just used elsewhere this week: pick from the refreshed list.'
            : NOTHING_NEW_COPY,
        );
      } else {
        // Be honest instead of silently doing nothing.
        setSwapMsg(
          intent && intent !== 'surprise'
            ? CROSS_CATEGORY_INTENTS.has(intent)
              ? `Nothing ${INTENT_LABEL[intent].toLowerCase()} fits this slot in this day's neighborhoods.`
              : `Nothing ${INTENT_LABEL[intent].toLowerCase()} fits this slot here.`
            : NOTHING_NEW_COPY,
        );
      }
    } finally {
      setSwapping(false);
    }
  }

  async function onToggleAlts() {
    if (altsOpen) {
      setAltsOpen(false);
      return;
    }
    setAltsOpen(true);
    if (!alts) {
      const list = await alternativesForItem(date, w, item.id);
      setAlts(list);
    }
  }

  return (
    <View style={styles.stopRow}>
      <View style={styles.stopHead}>
        <Text style={styles.stopTime}>
          {format12h(item.startTime)} to {format12h(item.endTime)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Swap ${item.title}`}
          accessibilityState={{ expanded: swapMenuOpen }}
          disabled={swapping}
          onPress={() => setSwapMenuOpen((o) => !o)}
          hitSlop={6}
          style={styles.swapBtn}
        >
          {swapping ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <RefreshCw size={13} color={colors.textMuted} strokeWidth={2.2} />
          )}
          <Text style={styles.swapText}>Swap</Text>
        </Pressable>
      </View>

      {swapMenuOpen ? (
        <View style={styles.swapMenuGroups}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Swap for a surprise pick"
            disabled={swapping}
            onPress={() => void onSwap(undefined, 'surprise')}
            style={[styles.swapChip, styles.surpriseChip, swapping && { opacity: 0.5 }]}
          >
            <Text style={styles.swapChipText}>Surprise me</Text>
          </Pressable>
          {SWAP_INTENT_GROUPS.map((group) => {
            const open = !!openGroups[group.label];
            return (
              <View key={group.label}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  hitSlop={6}
                  onPress={() =>
                    setOpenGroups((g) => ({ ...g, [group.label]: !g[group.label] }))
                  }
                  style={styles.swapGroupHead}
                >
                  <Text style={styles.swapGroupLabel}>{group.label}</Text>
                  {open ? (
                    <ChevronUp size={12} color={colors.textMuted} />
                  ) : (
                    <ChevronDown size={12} color={colors.textMuted} />
                  )}
                </Pressable>
                {open ? (
                  <View style={styles.swapMenu}>
                    {group.intents.map((intent) => (
                      <Pressable
                        key={intent}
                        accessibilityRole="button"
                        accessibilityLabel={`Swap for something ${INTENT_LABEL[intent].toLowerCase()}`}
                        disabled={swapping}
                        onPress={() => void onSwap(undefined, intent)}
                        style={[styles.swapChip, swapping && { opacity: 0.5 }]}
                      >
                        <Text style={styles.swapChipText}>{INTENT_LABEL[intent]}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* MTA-style roundel carries the kind color; the label stays ink. */}
      <View style={styles.stopKindRow}>
        <View style={[styles.roundel, { backgroundColor: kindColor(item.kind) }]}>
          <Text style={styles.roundelText} maxFontSizeMultiplier={1.2}>
            {label.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.stopKind}>{label.toUpperCase()}</Text>
      </View>
      <Text style={styles.stopTitle} numberOfLines={2} ellipsizeMode="tail">
        {item.title}
      </Text>
      <Text style={styles.stopMeta}>
        {[item.neighborhood, priceLabel(item.priceTier), ratingText(item.rating, item.ratingCount)]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
      {item.description ? <Text style={styles.stopDesc}>{item.description}</Text> : null}
      {item.note ? <Text style={styles.stopWhy}>{item.note}</Text> : null}
      {swapMsg ? <Text style={styles.noSite}>{swapMsg}</Text> : null}

      <View style={styles.stopActions}>
        {item.bookingUrl ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void openExternal(item.bookingUrl as string)}
            style={styles.linkBtn}
          >
            <ExternalLink size={12} color={colors.accent} strokeWidth={2.2} />
            <Text style={styles.linkBtnText}>
              {item.kind === 'event' ? 'Tickets' : 'Website'}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.noSite}>No website listed</Text>
        )}
        {/* mapsUrl always resolves (falls back to a name+area search), so every
            stop gets Directions: including user-typed bucket wishes. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Directions to ${item.title}`}
          onPress={() => void openExternal(directions)}
          style={styles.linkBtn}
        >
          <Text style={styles.linkBtnText}>Directions</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: altsOpen }}
          onPress={() => void onToggleAlts()}
          style={styles.linkBtn}
        >
          <Text style={styles.linkBtnText}>
            {altsOpen ? 'Hide options' : 'Other options'}
          </Text>
        </Pressable>
      </View>

      {altsOpen ? (
        <View style={styles.altList}>
          {alts === null ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : alts.length === 0 ? (
            <Text style={styles.noSite}>{NOTHING_NEW_COPY}</Text>
          ) : (
            alts.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`Replace with ${c.name}`}
                onPress={() => void onSwap(c.id)}
                style={({ pressed }) => [styles.altRow, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.altName}>{c.name}</Text>
                  <Text style={styles.altMeta}>
                    {[c.neighborhood, priceLabel(c.priceTier), ratingText(c.rating, c.ratingCount)]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                </View>
                <Text style={styles.altUse}>Use</Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headDate: {
    color: colors.text,
    fontFamily: font.family.heading,
    fontSize: font.size.xl,
    letterSpacing: -0.3,
  },
  holidayChip: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  holidayLabel: { fontSize: font.size.xs, fontWeight: font.weight.semibold, letterSpacing: 0.5 },
  skeletonLine: {
    height: 14,
    width: '75%',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  reshuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  reshuffleText: { color: colors.onAccent, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  closeBtn: { padding: spacing.xs },

  prefsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  prefsTogglePressed: { backgroundColor: colors.surfaceAlt },
  prefsToggleText: { color: colors.textMuted, fontSize: font.size.sm, flex: 1 },
  prefsBody: { gap: spacing.sm },
  prefsLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 1.2,
    marginTop: spacing.xs,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.textMuted, fontSize: font.size.xs },
  chipTextOn: { color: colors.accent, fontWeight: font.weight.semibold },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: spacing.xs },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.text, fontSize: font.size.md },
  stepValue: { color: colors.textMuted, fontSize: font.size.xs },
  resetLink: { paddingVertical: spacing.xs },
  resetLinkText: { color: colors.accent, fontSize: font.size.sm },

  emptyBox: { gap: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: font.size.sm, lineHeight: 20 },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preset: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.free,
    backgroundColor: colors.freeSoft,
  },
  presetText: { color: colors.free, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  fullDayLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  fullDayLinkText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.medium },
  providerNote: { color: colors.textFaint, fontSize: font.size.xs, fontStyle: 'italic' },

  windowBox: { gap: spacing.sm, paddingTop: spacing.xs },
  windowLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: font.weight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  stopRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gridLine,
    paddingTop: spacing.sm,
    gap: 2,
  },
  stopHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stopTime: { color: colors.textMuted, fontSize: font.size.xs, letterSpacing: 0.3 },
  swapBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 2 },
  swapText: { color: colors.textMuted, fontSize: font.size.xs, fontWeight: font.weight.medium },
  swapMenuGroups: { gap: 8, marginTop: 2 },
  swapGroupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 2,
    marginBottom: 4,
  },
  swapGroupLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  swapMenu: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swapChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  surpriseChip: { alignSelf: 'flex-start' },
  swapChipText: { color: colors.text, fontSize: font.size.xs, fontWeight: font.weight.medium },
  stopKindRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  roundel: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundelText: {
    color: colors.onArt,
    fontSize: 10,
    fontWeight: font.weight.bold,
  },
  stopKind: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: font.weight.bold,
    letterSpacing: 1.2,
  },
  stopTitle: {
    color: colors.text,
    fontFamily: font.family.heading,
    fontSize: font.size.lg,
    letterSpacing: -0.2,
  },
  stopMeta: { color: colors.textMuted, fontSize: font.size.xs },
  stopDesc: { color: colors.text, fontSize: font.size.sm, lineHeight: 19, marginTop: 2 },
  stopWhy: { color: colors.textFaint, fontSize: font.size.xs, fontStyle: 'italic' },
  stopActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  linkBtnText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.medium },
  noSite: { color: colors.textFaint, fontSize: font.size.xs, fontStyle: 'italic' },

  altList: {
    marginTop: spacing.xs,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: spacing.md,
    gap: spacing.sm,
  },
  altRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  altName: { color: colors.text, fontSize: font.size.sm, fontWeight: font.weight.medium },
  altMeta: { color: colors.textFaint, fontSize: font.size.xs },
  altUse: { color: colors.accent, fontSize: font.size.xs, fontWeight: font.weight.semibold },
  clearDayBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  clearDayText: { color: colors.danger, fontSize: font.size.sm, fontWeight: font.weight.medium },
});
