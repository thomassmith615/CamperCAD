/**
 * Inline SVG icons.
 *
 * Icons are inlined rather than loaded from a sprite or an icon package: the set
 * is small, they must be recolourable through `currentColor`, and shipping them
 * as markup keeps the dependency list at one library. Every icon is drawn on a
 * 24-unit grid with a 1.6 stroke so weights match across the toolbar.
 */
const PATHS: Record<string, string> = {
  perspective: '<path d="M12 3 3 7v10l9 4 9-4V7l-9-4Z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/>',
  orthographic: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16M9 4v16"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  ruler: '<path d="M3 15.5 15.5 3 21 8.5 8.5 21 3 15.5Z"/><path d="m7 12 2 2M10 9l2 2M13 6l2 2"/>',
  van: '<path d="M2 16V9a2 2 0 0 1 2-2h9l5 4h3v5"/><path d="M2 16h2m4 0h8m4 0h2"/><circle cx="6" cy="17" r="2"/><circle cx="18" cy="17" r="2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 14 9 5 9-5"/>',
};

/**
 * Returns markup for an icon.
 *
 * @param name Icon key.
 * @param size Rendered size in pixels.
 * @throws When the icon does not exist, which surfaces typos at first render
 * rather than leaving a silently blank button.
 */
export function icon(name: keyof typeof PATHS | string, size = 16): string {
  const path = PATHS[name];
  if (!path) throw new Error(`Unknown icon "${name}"`);
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
  );
}
