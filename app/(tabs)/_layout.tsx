// =============================================================================
// OutNYC: tabs layout (app/(tabs)/_layout.tsx)
// =============================================================================
// Bottom tabs: Week, Bucket list, Settings. Minimal line icons (lucide).
// =============================================================================

import { Tabs } from 'expo-router';
import { CalendarDays, ListChecks, SlidersHorizontal } from 'lucide-react-native';

import { colors, font } from '../../lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: {
          color: colors.text,
          fontFamily: font.family.heading,
          fontSize: font.size.lg,
        },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.sign,
          borderTopWidth: 2,
        },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
      }}
    >
      <Tabs.Screen
        name="week"
        options={{
          headerShown: false,
          title: 'This week',
          tabBarLabel: 'Week',
          tabBarIcon: ({ color }) => <CalendarDays size={20} color={color} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="bucket"
        options={{
          title: 'Bucket list',
          tabBarLabel: 'Bucket',
          tabBarIcon: ({ color }) => <ListChecks size={20} color={color} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => (
            <SlidersHorizontal size={20} color={color} strokeWidth={1.8} />
          ),
        }}
      />
    </Tabs>
  );
}
