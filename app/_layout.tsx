// =============================================================================
// OutNYC — root layout (app/_layout.tsx)
// =============================================================================
// Root Stack. Loads Inter (the wayfinding grotesk), bootstraps the store once,
// and themes the navigator (station-white headers, black type).
// =============================================================================

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorView } from '../components/ui';
import { colors, font } from '../lib/theme';
import { useStore } from '../lib/store';

// Keep the native splash up until fonts + the bootstrap load are done, so we
// never flash the bare cream placeholder in between.
void SplashScreen.preventAutoHideAsync();

/**
 * Root error boundary — expo-router renders this in place of the tree when a
 * route crashes during render, instead of leaving a blank screen.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // A crash before the normal hide fires would leave the native splash
  // covering this screen forever.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ErrorView message={error.message} onRetry={() => void retry()} />
    </View>
  );
}

export default function RootLayout() {
  const bootstrap = useStore((s) => s.bootstrap);
  const loadStatus = useStore((s) => s.loadStatus);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_800ExtraBold,
    Inter_900Black,
  });
  // useFonts never flips `loaded` when the load FAILS (e.g. a flaky network in
  // Expo Go) — it sets the error instead. Treat either as "done" so the splash
  // always hides and the app proceeds on system-font fallbacks rather than
  // sitting behind the native splash forever.
  const fontsDone = fontsLoaded || fontError != null;

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const bootDone = loadStatus === 'ready' || loadStatus === 'error';
  useEffect(() => {
    if (fontsDone && bootDone) void SplashScreen.hideAsync();
  }, [fontsDone, bootDone]);

  if (!fontsDone) {
    // Hold on a white canvas so we never flash a fallback font.
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
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="plan/[date]" options={{ title: 'Your plan' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
