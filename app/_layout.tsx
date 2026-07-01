// =============================================================================
// OutNYC — root layout (app/_layout.tsx)
// =============================================================================
// Root Stack. Bootstraps the store once on mount and themes the navigator.
// =============================================================================

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '../lib/theme';
import { useStore } from '../lib/store';

export default function RootLayout() {
  const bootstrap = useStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="day/[date]"
          options={{ title: 'Availability', presentation: 'card' }}
        />
        <Stack.Screen name="plan/[date]" options={{ title: 'Your plan' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
