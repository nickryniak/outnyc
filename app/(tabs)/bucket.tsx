// =============================================================================
// OutNYC — bucket list (app/(tabs)/bucket.tsx)
// =============================================================================
// Manage aspirational items. OPEN items are woven into plans by the planner.
// =============================================================================

import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  Body,
  Button,
  Caption,
  EmptyView,
  Heading,
  LoadingView,
} from '../../components/ui';
import { useStore } from '../../lib/store';
import { colors, radius, spacing } from '../../lib/theme';
import type { BucketItem } from '../../lib/types';

export default function BucketScreen() {
  const loadStatus = useStore((s) => s.loadStatus);
  const bucketList = useStore((s) => s.bucketList);
  const addBucketItem = useStore((s) => s.addBucketItem);
  const toggleBucketDone = useStore((s) => s.toggleBucketDone);
  const removeBucketItem = useStore((s) => s.removeBucketItem);

  const [draft, setDraft] = useState('');

  const { open, done } = useMemo(() => {
    const sorted = [...bucketList].sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      open: sorted.filter((b) => !b.done),
      done: sorted.filter((b) => b.done),
    };
  }, [bucketList]);

  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return <LoadingView label="Loading your list…" />;
  }

  async function onAdd() {
    const title = draft.trim();
    if (!title) return;
    await addBucketItem({ title });
    setDraft('');
  }

  return (
    <View style={styles.container}>
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add something you want to do…"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={onAdd}
        />
        <Button label="Add" onPress={onAdd} disabled={draft.trim().length === 0} />
      </View>

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        data={open}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={<Heading>Open</Heading>}
        ListEmptyComponent={
          <EmptyView
            title="Nothing open yet"
            message="Add a few things you want to do — the planner weaves these into your days when they fit."
          />
        }
        renderItem={({ item }) => (
          <BucketRow
            item={item}
            onToggle={() => void toggleBucketDone(item.id)}
            onRemove={() => void removeBucketItem(item.id)}
          />
        )}
        ListFooterComponent={
          done.length > 0 ? (
            <View style={styles.doneSection}>
              <Heading>Done</Heading>
              {done.map((item) => (
                <BucketRow
                  key={item.id}
                  item={item}
                  onToggle={() => void toggleBucketDone(item.id)}
                  onRemove={() => void removeBucketItem(item.id)}
                />
              ))}
            </View>
          ) : null
        }
      />
    </View>
  );
}

function BucketRow({
  item,
  onToggle,
  onRemove,
}: {
  item: BucketItem;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        onPress={onToggle}
        style={[styles.check, item.done && styles.checkDone]}
      >
        <Body>{item.done ? '✓' : ''}</Body>
      </Pressable>
      <View style={styles.rowContent}>
        <Body>{item.title}</Body>
        <View style={styles.metaRow}>
          {item.neighborhood ? <Caption muted>{item.neighborhood}</Caption> : null}
          {item.priceTier ? (
            <Caption muted>· {'$'.repeat(item.priceTier)}</Caption>
          ) : null}
          {item.tags.length > 0 ? (
            <Caption muted>· {item.tags.join(', ')}</Caption>
          ) : null}
        </View>
        {item.note ? <Caption muted>{item.note}</Caption> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.title}`}
        onPress={onRemove}
        style={styles.remove}
      >
        <Caption muted>✕</Caption>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  composer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
  },
  list: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
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
  rowContent: {
    flex: 1,
    gap: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: {
    backgroundColor: colors.secondarySoft,
    borderColor: colors.success,
  },
  remove: {
    padding: spacing.xs,
  },
  doneSection: {
    gap: spacing.md,
    marginTop: spacing.lg,
    opacity: 0.7,
  },
});
