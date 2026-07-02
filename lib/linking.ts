// =============================================================================
// OutNYC — external link opener (lib/linking.ts)
// =============================================================================
// One wrapper around Linking.openURL so a bad or unhandleable URL logs a
// warning instead of throwing an unhandled rejection mid-gesture.
// =============================================================================

import { Linking } from 'react-native';

export async function openExternal(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch (err) {
    console.warn('[link] failed to open url:', err);
  }
}
