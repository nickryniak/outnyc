// =============================================================================
// OutNYC: cross-platform destructive confirm (lib/confirm.ts)
// =============================================================================
// Alert.alert is a NO-OP in react-native-web, which silently turns any
// confirm-gated action into a dead button on the web build. This helper uses
// the browser confirm dialog on web and the native alert sheet elsewhere.
// =============================================================================

import { Alert, Platform } from 'react-native';

export function confirmDestructive(
  title: string,
  message: string,
  actionLabel: string,
  onConfirm: () => void,
): void {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`);
    if (ok) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: actionLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
