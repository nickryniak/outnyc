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

  const bootDone = loadStatus === 'ready' || loadStatus === 'error';
  useEffect(() => {
    if (fontsLoaded && bootDone) void SplashScreen.hideAsync();
  }, [fontsLoaded, bootDone]);

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
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="plan/[date]" options={{ title: 'Your plan' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
