// =============================================================================
// OutNYC — root layout (app/_layout.tsx)
// =============================================================================
// Root Stack. Loads the Fraunces editorial serif, bootstraps the store once,
// and themes the navigator (warm cream headers, serif titles).
// =============================================================================

import {
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_900Black,
  useFonts,
} from '@expo-google-fonts/fraunces';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors, font } from '../lib/theme';
import { useStore } from '../lib/store';

export default function RootLayout() {
  const bootstrap = useStore((s) => s.bootstrap);

  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Fraunces_900Black,
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!fontsLoaded) {
    // Hold on a cream canvas so we never flash a system-serif fallback.
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: {
            color: colors.text,
            fontFamily: font.family.heading,
            fontSize: font.size.lg,
          },
          contentStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          headerBackTitle: '',
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
