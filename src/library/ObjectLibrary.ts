import { CABINETRY_ITEMS } from './catalog/cabinetry';
import { SYSTEM_ITEMS } from './catalog/systems';
import { CATEGORY_ORDER, matchesQuery, type LibraryCategory, type LibraryItem } from './LibraryTypes';

/** Every catalog entry, assembled from the per-domain files. */
const ITEMS: readonly LibraryItem[] = [...CABINETRY_ITEMS, ...SYSTEM_ITEMS];

/**
 * The object library.
 *
 * A read-only registry over the catalog files. It exists so the browser UI and
 * any future consumer (presets, a bill of materials, a "what fits here"
 * suggestion) query one place rather than importing catalog arrays directly.
 *
 * Kept as a class rather than loose functions so a later version can back it
 * with a fetched catalog or a user's own saved components without changing a
 * single call site.
 */
export class ObjectLibrary {
  private readonly byId: ReadonlyMap<string, LibraryItem>;

  constructor() {
    const map = new Map<string, LibraryItem>();
    for (const item of ITEMS) {
      if (map.has(item.id)) {
        console.warn(`[ObjectLibrary] duplicate item id "${item.id}"; the later entry is ignored.`);
        continue;
      }
      map.set(item.id, item);
    }
    this.byId = map;
  }

  /** Every item, in catalog order. */
  all(): readonly LibraryItem[] {
    return ITEMS;
  }

  /** Looks up one item by id. */
  get(id: string): LibraryItem | undefined {
    return this.byId.get(id);
  }

  /**
   * Items matching a search query, grouped by category.
   *
   * Categories with no matches are omitted entirely rather than shown empty, so
   * a search narrows the browser instead of leaving the user scrolling past
   * headings with nothing under them.
   *
   * @param query Free text. Empty returns every category.
   */
  search(query: string): Array<{ category: LibraryCategory; items: LibraryItem[] }> {
    const normalised = query.trim().toLowerCase();

    return CATEGORY_ORDER.map((category) => ({
      category,
      items: ITEMS.filter((item) => item.category === category && matchesQuery(item, normalised)),
    })).filter((group) => group.items.length > 0);
  }
}
