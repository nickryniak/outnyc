// =============================================================================
// OutNYC — plan item card (components/PlanItemCard.tsx)
// =============================================================================
// Renders one ordered stop in an itinerary, with a kind-colored rail, time,
// price tier, and a "Book"/"Tickets" deep-link-out button (never auto-books).
// =============================================================================

import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { colors, kindColor, radius, spacing } from '../lib/theme';
import { format12h } from '../lib/time';
import type { PlanItem, PriceTier } from '../lib/types';
import { Body, Caption } from './ui';

function priceLabel(tier?: PriceTier): string {
  if (!tier) return '';
  return '$'.repeat(tier);
}

function kindLabel(kind: PlanItem['kind']): string {
  switch (kind) {
    case 'restaurant':
      return 'Eat';
    case 'bar':
      return 'Drink';
    case 'event':
      return 'Event';
    case 'activity':
      return 'Activity';
    case 'bucket':
      return 'Bucket list';
    case 'walk':
      return 'Walk';
    case 'break':
      return 'Break';
    default:
      return kind;
  }
}

async function openExternal(url: string): Promise<void> {
  try {
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
    else await Linking.openURL(url);
  } catch (err) {
    console.warn('[link] failed to open url:', err);
  }
}

/** Apple Maps URL for a stop, from coordinates or address. Null if neither. */
function mapsUrl(item: PlanItem): string | null {
  const label = encodeURIComponent(item.title);
  if (item.lat != null && item.lng != null) {
    return `https://maps.apple.com/?q=${label}&ll=${item.lat},${item.lng}`;
  }
  if (item.address) {
    return `https://maps.apple.com/?q=${encodeURIComponent(item.address)}`;
  }
  return null;
}

export function PlanItemCard({ item }: { item: PlanItem }) {
  const rail = kindColor(item.kind);
  const isConnector = item.kind === 'walk' || item.kind === 'break';
  const directions = mapsUrl(item);

  return (
    <View style={[styles.row, isConnector && styles.rowConnector]}>
      <View style={[styles.rail, { backgroundColor: rail }]} />
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Caption muted>
            {format12h(item.startTime)} – {format12h(item.endTime)}
          </Caption>
          <View style={[styles.kindTag, { borderColor: rail }]}>
            <Caption muted>{kindLabel(item.kind)}</Caption>
          </View>
        </View>

        {isConnector ? (
          <Caption muted>{item.title}</Caption>
        ) : (
          <Body>{item.title}</Body>
        )}

        <View style={styles.metaRow}>
          {item.neighborhood ? <Caption muted>{item.neighborhood}</Caption> : null}
          {item.priceTier ? (
            <Caption muted>· {priceLabel(item.priceTier)}</Caption>
          ) : null}
          {item.bucketItemId ? <Caption muted>· from your list</Caption> : null}
        </View>

        {!isConnector && (item.bookingUrl || directions) ? (
          <View style={styles.actionRow}>
            {item.bookingUrl ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.kind === 'event' ? 'Get tickets' : 'Book'}
                onPress={() => openExternal(item.bookingUrl as string)}
                style={({ pressed }) => [styles.bookBtn, pressed && styles.bookBtnPressed]}
              >
                <Caption>{item.kind === 'event' ? 'Tickets ↗' : 'Book ↗'}</Caption>
              </Pressable>
            ) : null}
            {directions ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Directions to ${item.title}`}
                onPress={() => openExternal(directions)}
                style={({ pressed }) => [styles.dirBtn, pressed && styles.bookBtnPressed]}
              >
                <Caption muted>Directions ↗</Caption>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  rowConnector: {
    backgroundColor: colors.surfaceAlt,
    opacity: 0.9,
  },
  rail: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kindTag: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  bookBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  dirBtn: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bookBtnPressed: {
    opacity: 0.7,
  },
});
