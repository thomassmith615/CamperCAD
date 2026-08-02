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
  cursor: '<path d="m5 3 6.5 16 2.2-6.3L20 10.5 5 3Z"/>',
  box: '<path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
  walk: '<circle cx="13" cy="4" r="1.6"/><path d="m10 21 2-6-2.5-3 1-5 3 2 2.5 1.5"/><path d="m13.5 15 2.5 6M9.5 7 7 9.5"/>',
  droplet: '<path d="M12 3s6 6.4 6 10.4A6 6 0 0 1 6 13.4C6 9.4 12 3 12 3Z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 10h6M9 14h6M9 18h3"/>',
  balance: '<path d="M12 3v18M7 21h10"/><path d="M3 8h18"/><path d="m6 8-3 6h6L6 8ZM18 8l-3 6h6l-3-6Z"/>',
  cylinder: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12a7 3 0 0 0 14 0V6"/>',
  panel: '<path d="M4 3h13l3 3v15H7l-3-3V3Z"/><path d="M17 3v3h3M4 18h13v3"/>',
  extrusion: '<path d="M4 20V8l5-5h11v8h-7v9H4Z"/><path d="M13 11 20 3M4 8h5V3"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 4v5h-5"/>',
  scale: '<path d="M4 15v5h5"/><path d="M20 9V4h-5"/><path d="m4 20 7-7M20 4l-7 7"/>',
  undo: '<path d="M3 8h11a5 5 0 0 1 0 10h-6"/><path d="m7 4-4 4 4 4"/>',
  redo: '<path d="M21 8H10a5 5 0 0 0 0 10h6"/><path d="m17 4 4 4-4 4"/>',
  duplicate: '<rect x="9" y="9" width="12" height="12" rx="1.5"/><path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6"/>',
  magnet: '<path d="M6 4v7a6 6 0 0 0 12 0V4"/><path d="M6 9h5M13 9h5"/><path d="M3 4h6M15 4h6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.9 5.3A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.3 4"/><path d="M6.3 7.4A17 17 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  lockOff: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
  group: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M13 7h4a1 1 0 0 1 1 1v3M11 13H8a1 1 0 0 1-1-1v-3"/>',
  ungroup: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  outliner: '<path d="M4 6h4v4H4zM4 14h4v4H4z"/><path d="M11 8h9M11 16h9"/>',
  array: '<rect x="3" y="8" width="5" height="8" rx="1"/><rect x="10" y="8" width="5" height="8" rx="1"/><rect x="17" y="8" width="4" height="8" rx="1" opacity="0.5"/>',
  mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3"/>',
  trackpad: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 13v6M3 13h18"/>',
  library: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17.5 5.5 3.2 14.2"/>',
  filePlus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M12 12v5M9.5 14.5h5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  save: '<path d="M5 3h11l3 3v15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M8 3v6h7V3"/><rect x="8" y="13" width="8" height="8"/>',
  download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 21V9"/><path d="m7 13 5-5 5 5"/><path d="M4 4h16"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
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
