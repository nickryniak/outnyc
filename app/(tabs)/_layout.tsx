// =============================================================================
// OutNYC — tabs layout (app/(tabs)/_layout.tsx)
// =============================================================================
// Bottom tabs: Week, Bucket list, Settings. Uses simple text glyphs as icons to
// avoid pulling in an icon font dependency.
// =============================================================================

import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { colors, font } from '../../lib/theme';

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ color, fontSize: font.size.lg }}
    >
      {glyph}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontWeight: font.weight.semibold },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
      }}
    >
      <Tabs.Screen
        name="week"
        options={{
          headerShown: false,
          title: 'This week',
          tabBarLabel: 'Week',
          tabBarIcon: ({ color }) => <TabIcon glyph="▦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="bucket"
        options={{
          title: 'Bucket list',
          tabBarLabel: 'Bucket',
          tabBarIcon: ({ color }) => <TabIcon glyph="★" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}
