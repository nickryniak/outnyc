// =============================================================================
// OutNYC — expanded day panel (components/DayPanel.tsx)
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
import { BellRing, ChevronDown, ChevronUp, ExternalLink, RefreshCw, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { INTEREST_TAGS, NEIGHBORHOODS } from '../lib/constants';
import { holidayFor } from '../lib/holidays';
import { planKey, resolvePrefs, useStore } from '../lib/store';
import { colors, font, radius, spacing } from '../lib/theme';
import { format12h, monthDayLabel, weekdayLabel } from '../lib/time';
import type { Candidate, PlanItem, PriceTier, TimeWindow } from '../lib/types';

const PRICE_TIERS: PriceTier[] = [1, 2, 3, 4];

function priceLabel(tier?: PriceTier): string {
  return tier ? '$'.repeat(tier) : '';
}

async function open(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch (err) {
    console.warn('[link] failed to open url:', err);
  }
}

function mapsUrl(item: PlanItem): string | null {
  const label = encodeURIComponent(item.title);
  if (item.lat != null && item.lng != null) {
    return `https://maps.apple.com/?q=${label}&ll=${item.lat},${item.lng}`;
  }
  if (item.address) return `https://maps.apple.com/?q=${encodeURIComponent(item.address)}`;
  return null;
}

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
  // in render — returning `?? []` straight from the selector makes a new array
  // every call and sends zustand's snapshot check into an infinite loop.
  const availability = useStore((s) => s.availabilityByDate[date]);
  const windows = availability?.windows ?? [];
  const dayPrefs = useStore((s) => s.dayPrefsByDate[date]);
  const reshuffleDay = useStore((s) => s.reshuffleDay);
  const setAvailability = useStore((s) => s.setAvailability);
  const holiday = holidayFor(date);

  const [busy, setBusy] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  if (!profile) return null;
  const prefs = resolvePrefs(profile, dayPrefs);

  async function onReshuffle() {
    setBusy(true);
    try {
      await reshuffleDay(date);
    } finally {
      setBusy(false);
    }
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
            <Text style={[styles.holidayLabel, { color: holiday.color }]}>{holiday.name}</Text>
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
              <ActivityIndicator size="small" color={colors.onArt} />
            ) : (
              <RefreshCw size={13} color={colors.onArt} strokeWidth={2.2} />
            )}
            <Text style={styles.reshuffleText}>Reshuffle</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close day panel"
          hitSlop={8}
          onPress={onClose}
          style={styles.closeBtn}
        >
          <X size={16} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      </View>

      {/* Per-day preferences */}
      <Pressable
        accessibilityRole="button"
        onPress={() => setPrefsOpen((o) => !o)}
        style={styles.prefsToggle}
      >
        <Text style={styles.prefsToggleText}>
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
          style={styles.remindersLink}
        >
          <BellRing size={13} color={colors.accent} strokeWidth={2} />
          <Text style={styles.remindersLinkText}>Reminders and full view</Text>
        </Pressable>
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
              onPress={() => {
                const { min, max } = prefs.price;
                const next =
                  Math.abs(t - min) <= Math.abs(t - max)
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
            onPress={() => void setDayPrefs(date, { partySize: Math.max(1, prefs.partySize - 1) })}
            style={styles.stepBtn}
          >
            <Text style={styles.stepText}>-</Text>
          </Pressable>
          <Text style={styles.stepValue}>party of {prefs.partySize}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Larger party"
            onPress={() => void setDayPrefs(date, { partySize: Math.min(20, prefs.partySize + 1) })}
            style={styles.stepBtn}
          >
            <Text style={styles.stepText}>+</Text>
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

function WindowItinerary({ date, window: w }: { date: string; window: TimeWindow }) {
  const key = planKey(date, w);
  const plan = useStore((s) => s.plansByKey[key]);
  const planning = useStore((s) => s.planning[key]);
  const generatePlan = useStore((s) => s.generatePlan);

  const stops = (plan?.items ?? []).filter((i) => i.kind !== 'walk' && i.kind !== 'break');

  if (planning?.status === 'planning') {
    return (
      <View style={styles.windowBox}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!plan || stops.length === 0) {
    return (
      <View style={styles.windowBox}>
        <Text style={styles.windowLabel}>
          {format12h(w.start)} to {format12h(w.end)}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void generatePlan(date, w)}
          style={styles.planBtn}
        >
          <Text style={styles.planBtnText}>Plan this window</Text>
        </Pressable>
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
}

// ---- One stop row with swap + alternatives -------------------------------------

function StopRow({
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
  const [altsOpen, setAltsOpen] = useState(false);
  const [alts, setAlts] = useState<Candidate[] | null>(null);

  const directions = mapsUrl(item);

  async function onSwap(replacementId?: string) {
    setSwapping(true);
    setSwapMsg(null);
    try {
      const ok = await swapPlanItem(date, w, item.id, replacementId);
      if (ok) {
        setAltsOpen(false);
        setAlts(null);
      } else {
        // Be honest instead of silently doing nothing.
        setSwapMsg('Nothing new fits this slot right now. Try a reshuffle instead.');
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
          disabled={swapping}
          onPress={() => void onSwap()}
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

      <Text style={styles.stopTitle}>{item.title}</Text>
      <Text style={styles.stopMeta}>
        {[item.neighborhood, priceLabel(item.priceTier)].filter(Boolean).join('  ·  ')}
      </Text>
      {item.description ? <Text style={styles.stopDesc}>{item.description}</Text> : null}
      {item.note ? <Text style={styles.stopWhy}>{item.note}</Text> : null}
      {swapMsg ? <Text style={styles.noSite}>{swapMsg}</Text> : null}

      <View style={styles.stopActions}>
        {item.bookingUrl ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void open(item.bookingUrl as string)}
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
        {directions ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void open(directions)}
            style={styles.linkBtn}
          >
            <Text style={styles.linkBtnText}>Directions</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => void onToggleAlts()} style={styles.linkBtn}>
          <Text style={styles.linkBtnText}>
            {altsOpen ? 'Hide options' : 'See what else is on'}
          </Text>
        </Pressable>
      </View>

      {altsOpen ? (
        <View style={styles.altList}>
          {alts === null ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : alts.length === 0 ? (
            <Text style={styles.noSite}>Nothing else fits this slot right now.</Text>
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
                    {[c.neighborhood, priceLabel(c.priceTier)].filter(Boolean).join('  ·  ')}
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
}

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
  holidayLabel: { fontSize: font.size.xs, fontWeight: font.weight.semibold, letterSpacing: 0.5 },
  reshuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  reshuffleText: { color: colors.onArt, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  closeBtn: { padding: spacing.xs },

  prefsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gridLine,
  },
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
  remindersLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  remindersLinkText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.medium },

  windowBox: { gap: spacing.sm, paddingTop: spacing.xs },
  windowLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: font.weight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  planBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  planBtnText: { color: colors.onArt, fontSize: font.size.sm, fontWeight: font.weight.semibold },

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
});
