// =============================================================================
// OutNYC — bucket list (app/(tabs)/bucket.tsx)
// =============================================================================
// Aspirational items the planner weaves into your week. Paste a whole list
// (numbered or one-per-line) to bulk-import; each OPEN item becomes a candidate.
// =============================================================================

import { useHeaderHeight } from '@react-navigation/elements';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Caption, Eyebrow, Heading, LoadingView } from '../../components/ui';
import { confirmDestructive } from '../../lib/confirm';
import { useStore } from '../../lib/store';
import { colors, font, radius, spacing } from '../../lib/theme';
import { weekdayLabel } from '../../lib/time';
import type { BucketItem } from '../../lib/types';

// ---- Paste parsing ----------------------------------------------------------

/** Split pasted text into item strings — handles "1." / "1)" / bullets / lines. */
function parseList(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const parts = /(^|\s)\d+[.)]\s+/.test(t)
    ? t.split(/\s*\d+[.)]\s+/)
    : t.split(/\r?\n|•|(?:^|\s)[-*]\s+/);
  return parts.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Split "Title - note" into a title + optional note. */
function splitTitleNote(line: string): { title: string; note?: string } {
  const [first, ...rest] = line.split(/\s+[-–—]\s+/);
  if (first && rest.length > 0) return { title: first.trim(), note: rest.join('. ').trim() };
  return { title: line };
}

const TAG_RULES: [RegExp, string[]][] = [
  [/park|garden|beach|island|greenway|hudson|rockaway|red hook|governors|roosevelt|kayak|bike|walk|outdoor|golf/i, ['outdoors']],
  [/museum|\bmet\b|broadway|shakespeare|gallery|\bart\b/i, ['art']],
  [/jazz|live music|concert|vanguard/i, ['live music']],
  [/movie|film|snl|late night|fallon|show/i, ['film']],
  [/rooftop|\bbar\b|party|le bain|club|drinks|cocktail/i, ['bar']],
  [/pizza|ramen|food|eat|dinner|brunch|slice/i, ['food']],
  [/comedy|stand-?up/i, ['comedy']],
];

function inferTags(text: string): string[] {
  const tags = new Set<string>();
  for (const [re, ts] of TAG_RULES) if (re.test(text)) ts.forEach((t) => tags.add(t));
  return [...tags];
}

function toInputs(text: string) {
  return parseList(text).map((line) => {
    const { title, note } = splitTitleNote(line);
    return { title, note, tags: inferTags(line) };
  });
}

// ---- Screen -----------------------------------------------------------------

export default function BucketScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const loadStatus = useStore((s) => s.loadStatus);
  const bucketList = useStore((s) => s.bucketList);
  const plansByKey = useStore((s) => s.plansByKey);
  const addBucketItems = useStore((s) => s.addBucketItems);
  const toggleBucketDone = useStore((s) => s.toggleBucketDone);
  const removeBucketItem = useStore((s) => s.removeBucketItem);

  const [draft, setDraft] = useState('');
  const parsedCount = useMemo(() => parseList(draft).length, [draft]);

  const { open, done } = useMemo(() => {
    const sorted = [...bucketList].sort((a, b) => a.sortOrder - b.sortOrder);
    return { open: sorted.filter((b) => !b.done), done: sorted.filter((b) => b.done) };
  }, [bucketList]);

  // Bucket item id -> earliest date it's scheduled on. Bucket-derived stops
  // carry the item's id as `bucketItemId` (planner + swaps), so that's the link.
  const scheduledDateById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of Object.values(plansByKey)) {
      for (const it of p.items) {
        if (!it.bucketItemId) continue;
        const earliest = map[it.bucketItemId];
        if (!earliest || p.date < earliest) map[it.bucketItemId] = p.date;
      }
    }
    return map;
  }, [plansByKey]);

  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return <LoadingView label="Loading your list…" />;
  }

  async function onAdd() {
    const inputs = toInputs(draft);
    if (inputs.length === 0) return;
    await addBucketItems(inputs);
    setDraft('');
  }

  function confirmRemove(item: BucketItem) {
    confirmDestructive(
      `Remove “${item.title}”?`,
      'This deletes it from your bucket list.',
      'Remove',
      () => void removeBucketItem(item.id),
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Eyebrow>Your list</Eyebrow>
        <Caption muted>
          Paste a whole list (numbered or one per line). The planner weaves open
          items into your week when they fit.
        </Caption>

        <View style={styles.importer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={'e.g.\n1. Shakespeare in the Park\n2. Jazz club\n3. Rooftop party'}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            multiline
            textAlignVertical="top"
          />
          <Button
            label={parsedCount > 1 ? `Add ${parsedCount} items` : 'Add item'}
            onPress={onAdd}
            disabled={parsedCount === 0}
          />
        </View>

        <Heading>Open</Heading>
        {open.length === 0 ? (
          <Caption muted>Nothing open yet. Paste a few ideas above.</Caption>
        ) : (
          open.map((item) => (
            <BucketRow
              key={item.id}
              item={item}
              scheduledDate={scheduledDateById[item.id]}
              onToggle={() => void toggleBucketDone(item.id)}
              onRemove={() => confirmRemove(item)}
            />
          ))
        )}

        {done.length > 0 ? (
          <View style={styles.doneSection}>
            <Heading>Done</Heading>
            {done.map((item) => (
              <BucketRow
                key={item.id}
                item={item}
                onToggle={() => void toggleBucketDone(item.id)}
                onRemove={() => confirmRemove(item)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function BucketRow({
  item,
  scheduledDate,
  onToggle,
  onRemove,
}: {
  item: BucketItem;
  /** Date this item is already on a plan for, if any. */
  scheduledDate?: string;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        hitSlop={8}
        onPress={onToggle}
        style={[styles.check, item.done && styles.checkDone]}
      >
        {item.done ? <Text style={styles.checkMark}>✓</Text> : null}
      </Pressable>
      <View style={styles.rowContent}>
        <Text style={[styles.rowTitle, item.done && styles.rowTitleDone]}>{item.title}</Text>
        {item.neighborhood || item.priceTier || item.tags.length > 0 ? (
          <Text style={styles.rowMeta}>
            {[
              item.neighborhood,
              item.priceTier ? '$'.repeat(item.priceTier) : null,
              item.tags.length ? item.tags.join(', ') : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </Text>
        ) : null}
        {item.note ? <Caption muted>{item.note}</Caption> : null}
        {scheduledDate ? (
          <View style={styles.scheduledChip}>
            <Text style={styles.scheduledChipText}>
              On calendar · {weekdayLabel(scheduledDate)}
            </Text>
          </View>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.title}`}
        hitSlop={10}
        onPress={onRemove}
        style={styles.remove}
      >
        <Text style={styles.removeGlyph}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  importer: { gap: spacing.sm },
  input: {
    minHeight: 96,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: font.size.md,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowContent: { flex: 1, gap: 2 },
  rowTitle: {
    color: colors.text,
    fontFamily: font.family.heading,
    fontSize: font.size.md + 1,
  },
  rowTitleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  rowMeta: { color: colors.textMuted, fontSize: font.size.sm },
  check: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkDone: { backgroundColor: colors.secondary, borderColor: colors.secondary },
  checkMark: { color: colors.onArt, fontSize: 14, fontWeight: font.weight.bold },
  remove: { padding: spacing.xs },
  removeGlyph: { color: colors.textFaint, fontSize: font.size.md },
  scheduledChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.secondarySoft,
    marginTop: 2,
  },
  scheduledChipText: {
    color: colors.secondary,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
  },
  doneSection: { gap: spacing.md, marginTop: spacing.lg, opacity: 0.75 },
});
