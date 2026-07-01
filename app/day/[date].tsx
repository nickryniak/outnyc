// =============================================================================
// OutNYC — set availability for a day (app/day/[date].tsx)
// =============================================================================
// Add/remove free-time windows ('HH:MM'–'HH:MM') for a single date, then save
// and jump to planning. Validates each window and surfaces inline errors.
// =============================================================================

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Body, Button, Caption, Heading } from '../../components/ui';
import { useStore } from '../../lib/store';
import { colors, radius, spacing } from '../../lib/theme';
import { formatWindow, isValidWindow, relativeDayLabel } from '../../lib/time';
import type { TimeWindow } from '../../lib/types';

// A couple of one-tap presets to make the common case fast.
const PRESETS: TimeWindow[] = [
  { start: '18:00', end: '23:00' },
  { start: '12:00', end: '17:00' },
  { start: '09:00', end: '13:00' },
];

export default function DayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date: string }>();
  const date = typeof params.date === 'string' ? params.date : '';

  const existing = useStore((s) => (date ? s.availabilityByDate[date] : undefined));
  const setAvailability = useStore((s) => s.setAvailability);

  const [windows, setWindows] = useState<TimeWindow[]>(existing?.windows ?? []);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('23:00');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // If the stored availability changes underneath us, reflect it once.
  useEffect(() => {
    setWindows(existing?.windows ?? []);
  }, [existing]);

  if (!date) {
    return (
      <View style={styles.container}>
        <Heading>Unknown day</Heading>
        <Caption muted>No date was provided.</Caption>
      </View>
    );
  }

  function addWindow(w: TimeWindow) {
    if (!isValidWindow(w)) {
      setError('Enter valid times as HH:MM, with start before end.');
      return;
    }
    const dup = windows.some((x) => x.start === w.start && x.end === w.end);
    if (dup) {
      setError('That window is already added.');
      return;
    }
    setError(null);
    setWindows((cur) => [...cur, w].sort((a, b) => a.start.localeCompare(b.start)));
  }

  function removeWindow(index: number) {
    setWindows((cur) => cur.filter((_, i) => i !== index));
  }

  async function onSave(thenPlan: boolean) {
    setSaving(true);
    try {
      await setAvailability(date, windows);
      if (thenPlan && windows.length > 0) {
        router.replace({ pathname: '/plan/[date]', params: { date } });
      } else {
        router.back();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Heading>{relativeDayLabel(date)}</Heading>
      <Caption muted>{date}</Caption>

      <Heading>Free-time windows</Heading>
      {windows.length === 0 ? (
        <Caption muted>None yet. Add one below.</Caption>
      ) : (
        <View style={styles.windowList}>
          {windows.map((w, i) => (
            <View key={`${w.start}-${w.end}-${i}`} style={styles.windowRow}>
              <Body>{formatWindow(w)}</Body>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove window"
                onPress={() => removeWindow(i)}
                style={styles.remove}
              >
                <Caption muted>Remove</Caption>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Heading>Add a window</Heading>
      <View style={styles.inputRow}>
        <TextInput
          value={start}
          onChangeText={setStart}
          placeholder="18:00"
          placeholderTextColor={colors.textFaint}
          style={styles.timeInput}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />
        <Body muted>to</Body>
        <TextInput
          value={end}
          onChangeText={setEnd}
          placeholder="23:00"
          placeholderTextColor={colors.textFaint}
          style={styles.timeInput}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
        />
        <Button label="Add" onPress={() => addWindow({ start, end })} />
      </View>
      {error ? <Caption muted>{error}</Caption> : null}

      <Caption muted>Quick presets</Caption>
      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable
            key={`${p.start}-${p.end}`}
            accessibilityRole="button"
            onPress={() => addWindow(p)}
            style={styles.preset}
          >
            <Caption>{formatWindow(p)}</Caption>
          </Pressable>
        ))}
      </View>

      <View style={styles.actions}>
        <Button
          label={windows.length > 0 ? 'Save & plan this day' : 'Save'}
          onPress={() => onSave(true)}
          loading={saving}
        />
        <Button label="Save only" variant="secondary" onPress={() => onSave(false)} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  windowList: {
    gap: spacing.sm,
  },
  windowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  remove: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timeInput: {
    width: 72,
    minHeight: 48,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  preset: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
