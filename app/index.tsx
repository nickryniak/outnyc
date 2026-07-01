// =============================================================================
// OutNYC — entry gate (app/index.tsx)
// =============================================================================
// Shows a loading state while bootstrapping, surfaces load errors, then routes
// to onboarding (first run) or the week view.
// =============================================================================

import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorView, LoadingView } from '../components/ui';
import { useStore } from '../lib/store';
import { colors } from '../lib/theme';

export default function Index() {
  const insets = useSafeAreaInsets();
  const loadStatus = useStore((s) => s.loadStatus);
  const loadError = useStore((s) => s.loadError);
  const profile = useStore((s) => s.profile);
  const bootstrap = useStore((s) => s.bootstrap);

  if (loadStatus === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <ErrorView
          message={loadError ?? 'Could not load your data.'}
          onRetry={() => void bootstrap()}
        />
      </View>
    );
  }

  if (loadStatus !== 'ready' || profile == null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <LoadingView label="Setting up OutNYC…" />
      </View>
    );
  }

  return <Redirect href={profile.onboarded ? '/week' : '/onboarding'} />;
}
