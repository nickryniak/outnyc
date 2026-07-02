// =============================================================================
// OutNYC — maps deep links (lib/maps.ts)
// =============================================================================
// The single Directions URL builder. ALWAYS returns a usable link: precise
// coordinates when we have them, then street address, then a plain text search
// of "title + neighborhood + New York" — so even a user-typed bucket wish with
// no location data still gets a Directions button that opens a sensible search.
// =============================================================================

interface MapTarget {
  title: string;
  neighborhood?: string;
  lat?: number;
  lng?: number;
  address?: string;
}

/** Apple Maps link for a stop; falls back to a name+area text search. */
export function mapsUrl(item: MapTarget): string {
  const label = encodeURIComponent(item.title);
  if (item.lat != null && item.lng != null) {
    return `https://maps.apple.com/?q=${label}&ll=${item.lat},${item.lng}`;
  }
  if (item.address) {
    return `https://maps.apple.com/?q=${encodeURIComponent(item.address)}`;
  }
  const query = [item.title, item.neighborhood, 'New York'].filter(Boolean).join(' ');
  return `https://maps.apple.com/?q=${encodeURIComponent(query)}`;
}
