// =============================================================================
// OutNYC — plan item card (components/PlanItemCard.tsx)
// =============================================================================
// One stop in the itinerary, styled like a printed city-guide entry: a serif
// numeral, the time and kind, a serif title, and Book/Tickets/Directions
// deep-links. Walk/break stops render as a slim connector between entries.
// =============================================================================

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { priceLabel, ratingText } from '../lib/format';
import { stopLabel } from '../lib/labels';
import { openExternal } from '../lib/linking';
import { mapsUrl } from '../lib/maps';
import { colors, font, kindColor, radius, spacing } from '../lib/theme';
import { format12h, toMinutes } from '../lib/time';
import type { PlanItem } from '../lib/types';

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
  // One spoken line for the whole entry; the Book/Directions Pressables stay
  // individually focusable below it.
  const summary = [
    stopNumber != null ? `Stop ${stopNumber}` : 'Stop',
    item.title,
    `${format12h(item.startTime)} to ${format12h(item.endTime)}`,
    item.neighborhood,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.stop} accessibilityLabel={summary}>
      <View style={styles.numeralCol}>
        {/* Solid MTA-style roundel: kind color fill, white numeral. */}
        <View
          accessible
          accessibilityLabel={stopNumber != null ? `Stop ${stopNumber}` : 'Stop'}
          style={[styles.numeral, { backgroundColor: tint }]}
        >
          <Text style={styles.numeralText} maxFontSizeMultiplier={1.4}>
            {stopNumber ?? '•'}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.metaTop}>
          <Text style={styles.time}>
            {format12h(item.startTime)} – {format12h(item.endTime)}
          </Text>
          <Text style={styles.kind}>
            {stopLabel(item.kind, item.startTime, item.tags).toUpperCase()}
          </Text>
        </View>

        {/* Never clamped: this full-view card is the one surface where a long
            event title (openers, venue, night) must be readable end to end —
            the grid block and day-panel rows truncate and point here. */}
        <Text style={styles.title}>{item.title}</Text>

        {/* Provenance for bucket stops is the FROM YOUR LIST kind label above —
            no duplicate "from your list" suffix here. */}
        <Text style={styles.sub}>
          {[item.neighborhood, priceLabel(item.priceTier), ratingText(item.rating, item.ratingCount)]
            .filter(Boolean)
            .join('  ·  ')}
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
          {/* mapsUrl always resolves (name+area search fallback), so every stop
              gets Directions — including user-typed bucket wishes. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Directions to ${item.title}`}
            onPress={() => openExternal(directions)}
            style={({ pressed }) => [styles.actionGhost, pressed && styles.pressed]}
          >
            <Text style={styles.actionGhostText}>Directions ↗</Text>
          </Pressable>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  numeralText: {
    color: colors.onArt,
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
    color: colors.textMuted,
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
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimaryText: {
    color: colors.onAccent,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
  },
  actionGhost: {
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
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
