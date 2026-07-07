// =============================================================================
// OutNYC: entry gate (app/index.tsx)
// =============================================================================
// Shows a loading state while bootstrapping (normally covered by the native
// splash, which the root layout holds until the store settles; the spinner is
// only visible on a retry after an error), surfaces load errors, then always
// lands on the welcome sign. Every session starts at the front door.
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

  return <Redirect href="/welcome" />;
}
