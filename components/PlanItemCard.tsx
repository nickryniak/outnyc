// =============================================================================
// OutNYC — plan item card (components/PlanItemCard.tsx)
// =============================================================================
// One stop in the itinerary, styled like a printed city-guide entry: a serif
// numeral, the time and kind, a serif title, and Book/Tickets/Directions
// deep-links. Walk/break stops render as a slim connector between entries.
// =============================================================================

import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, kindColor, radius, spacing } from '../lib/theme';
import { format12h, toMinutes } from '../lib/time';
import type { PlanItem, PriceTier } from '../lib/types';

function priceLabel(tier?: PriceTier): string {
  return tier ? '$'.repeat(tier) : '';
}

function kindLabel(kind: PlanItem['kind']): string {
  switch (kind) {
    case 'restaurant':
      return 'Eat';
    case 'bar':
      return 'Drink';
    case 'event':
      return 'Live';
    case 'activity':
      return 'Do';
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

export function PlanItemCard({ item, stopNumber }: { item: PlanItem; stopNumber?: number }) {
  const isConnector = item.kind === 'walk' || item.kind === 'break';

  if (isConnector) {
    const mins = Math.max(0, toMinutes(item.endTime) - toMinutes(item.startTime));
    const to = item.neighborhood ? `to ${item.neighborhood}` : '';
    return (
      <View style={styles.connector}>
        <View style={styles.connectorLine} />
        <Text style={styles.connectorText}>
          {item.kind === 'walk' ? '↳ walk' : '↳ break'} {mins ? `· ${mins} min ` : ''}
          {to}
        </Text>
      </View>
    );
  }

  const tint = kindColor(item.kind);
  const directions = mapsUrl(item);

  return (
    <View style={styles.stop}>
      <View style={styles.numeralCol}>
        <View style={[styles.numeral, { borderColor: tint }]}>
          <Text style={[styles.numeralText, { color: tint }]}>{stopNumber ?? '•'}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.metaTop}>
          <Text style={styles.time}>
            {format12h(item.startTime)} – {format12h(item.endTime)}
          </Text>
          <Text style={[styles.kind, { color: tint }]}>{kindLabel(item.kind).toUpperCase()}</Text>
        </View>

        <Text style={styles.title}>{item.title}</Text>

        <Text style={styles.sub}>
          {[item.neighborhood, priceLabel(item.priceTier)].filter(Boolean).join('  ·  ')}
          {item.bucketItemId ? '  ·  from your list' : ''}
        </Text>

        {item.description ? <Text style={styles.desc}>{item.description}</Text> : null}
        {item.note ? <Text style={styles.why}>{item.note}</Text> : null}

        <View style={styles.actions}>
          {item.bookingUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.kind === 'event' ? 'Get tickets' : 'Open website'}
              onPress={() => openExternal(item.bookingUrl as string)}
              style={({ pressed }) => [styles.actionPrimary, pressed && styles.pressed]}
            >
              <Text style={styles.actionPrimaryText}>
                {item.kind === 'event' ? 'Tickets ↗' : 'Website ↗'}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.noSite}>No website listed</Text>
          )}
          {directions ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Directions to ${item.title}`}
              onPress={() => openExternal(directions)}
              style={({ pressed }) => [styles.actionGhost, pressed && styles.pressed]}
            >
              <Text style={styles.actionGhostText}>Directions ↗</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stop: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  numeralCol: {
    alignItems: 'center',
    width: 40,
  },
  numeral: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  numeralText: {
    fontFamily: font.family.display,
    fontSize: font.size.lg,
  },
  body: {
    flex: 1,
    paddingBottom: spacing.lg,
    gap: 3,
  },
  metaTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 1,
  },
  time: {
    color: colors.textMuted,
    fontSize: font.size.sm,
    letterSpacing: 0.2,
  },
  kind: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    letterSpacing: 1.4,
  },
  title: {
    color: colors.text,
    fontFamily: font.family.heading,
    fontSize: font.size.xl,
    letterSpacing: -0.3,
    lineHeight: font.size.xl + 3,
  },
  sub: {
    color: colors.textMuted,
    fontSize: font.size.sm,
  },
  desc: {
    color: colors.text,
    fontSize: font.size.sm,
    lineHeight: 19,
    marginTop: 2,
  },
  why: {
    color: colors.textFaint,
    fontSize: font.size.xs,
    fontStyle: 'italic',
  },
  noSite: {
    color: colors.textFaint,
    fontSize: font.size.sm,
    fontStyle: 'italic',
    alignSelf: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionPrimary: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  actionPrimaryText: {
    color: colors.onArt,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
  },
  actionGhost: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  actionGhostText: {
    color: colors.text,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
  },
  pressed: {
    opacity: 0.7,
  },
  connector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: 20,
    paddingBottom: spacing.md,
  },
  connectorLine: {
    width: 1.5,
    height: 24,
    backgroundColor: colors.border,
    marginLeft: 19,
  },
  connectorText: {
    color: colors.textFaint,
    fontSize: font.size.sm,
    fontStyle: 'italic',
  },
});
