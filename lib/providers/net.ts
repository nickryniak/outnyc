// =============================================================================
// OutNYC: provider fetch helpers (lib/providers/net.ts)
// =============================================================================
// One bounded-fetch helper for the live providers: aborts after `timeoutMs` so
// a hung API can never stall planning (providers catch and fall back to seed).
// Plus a fast connectivity probe so always-attempted (key-free) providers can
// skip straight to their fallback when offline instead of eating the timeout.
// =============================================================================

import NetInfo from '@react-native-community/netinfo';

// The probe must be much cheaper than the fetch timeout it's saving.
const ONLINE_PROBE_TIMEOUT_MS = 1500;

/**
 * Best-effort connectivity check. FAIL OPEN: resolves true when the probe
 * itself times out, errors, or reports "unknown": the probe must never be
 * the reason a fetch is blocked.
 */
export async function isOnline(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ONLINE_PROBE_TIMEOUT_MS);
    });
    const state = await Promise.race([NetInfo.fetch(), timeout]);
    // isConnected is null when unknown: only a definite false means offline.
    return state == null ? true : state.isConnected !== false;
  } catch {
    return true;
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
