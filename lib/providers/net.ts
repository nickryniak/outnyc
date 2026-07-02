// =============================================================================
// OutNYC — provider fetch helper (lib/providers/net.ts)
// =============================================================================
// One bounded-fetch helper for the live providers: aborts after `timeoutMs` so
// a hung API can never stall planning (providers catch and fall back to seed).
// =============================================================================

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
