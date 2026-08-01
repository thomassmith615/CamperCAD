/**
 * Data model for the object library.
 *
 * A library item is a **named set of defaults**, not a new kind of geometry. It
 * carries dimensions, weight, price and a placement rule, and produces an
 * ordinary {@link SceneObject}. This is what keeps the library from becoming a
 * second object system: everything downstream — snapping, clearances, undo,
 * serialisation, the eventual bill of materials — treats a 12V compressor
 * fridge exactly as it treats a box, because it is one.
 *
 * The consequence is deliberate. A catalog entry that needed genuinely
 * different geometry (a curved wheel-well cover, a rounded tank) would need a
 * new `ObjectKind` and a builder to go with it. Until such an entry exists,
 * paying for that generality would be paying for nothing.
 */

import type { ObjectKind } from '@/objects/ObjectTypes';

/** Top-level grouping in the library browser. */
export type LibraryCategory =
  | 'cabinetry'
  | 'sleeping'
  | 'kitchen'
  | 'water'
  | 'electrical'
  | 'climate'
  | 'storage';

/** Display names and order for the category tabs. */
export const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  cabinetry: 'Cabinets',
  sleeping: 'Sleeping',
  kitchen: 'Kitchen',
  water: 'Water',
  electrical: 'Electrical',
  climate: 'Climate',
  storage: 'Storage',
};

/** Category order in the browser. */
export const CATEGORY_ORDER: readonly LibraryCategory[] = [
  'cabinetry',
  'sleeping',
  'kitchen',
  'water',
  'electrical',
  'climate',
  'storage',
];

/**
 * Where an item naturally sits when placed.
 *
 * Placement rules exist because most van components have exactly one sensible
 * home, and making the user drag a roof fan down from the air to the ceiling is
 * busywork the application can do correctly every time.
 */
export type PlacementRule =
  | 'floor'
  | 'ceiling'
  /** Against whichever side wall is nearer the drop point. */
  | 'wall'
  /** On top of whatever is under the cursor, else the floor. */
  | 'surface'
  /** Wherever the cursor is, at the height it was dropped. */
  | 'free';

/**
 * One entry in the library.
 *
 * Dimensions are inches, weight is pounds, price is US dollars. `weight` and
 * `price` are typical rather than exact: they are starting points for the
 * weight and cost rollups, and the inspector lets the user correct them per
 * object once they have bought a specific product.
 */
export interface LibraryItem {
  /** Stable identifier. Saved projects do not reference it, but presets may. */
  id: string;
  name: string;
  category: LibraryCategory;
  /** One line explaining what this is and when to use it. */
  description: string;
  kind: ObjectKind;
  /** Width (X), height (Y), depth (Z) in inches. */
  dimensions: [number, number, number];
  color: string;
  /** Typical dry weight in pounds. */
  weight: number;
  /** Typical retail price in US dollars, or 0 when it varies too much. */
  price: number;
  /** Fluid capacity in US gallons, for tanks. Omitted for everything else. */
  capacityGallons?: number;
  /** Material key for panels, feeding the cut list. Defaults to birch ply. */
  material?: string;
  /**
   * Electrical characteristics, for anything that draws, stores or makes power.
   *
   * Duty cycle matters more than rated wattage for the energy budget: a fridge
   * compressor draws 45 W but runs perhaps a third of the time, so its daily
   * consumption is a third of what its label suggests.
   */
  electrical?: {
    /** Continuous draw while running, in watts. */
    watts?: number;
    /** Average running hours per day. */
    hoursPerDay?: number;
    /** True when it needs inverted AC. */
    ac?: boolean;
    /** Nominal capacity in amp-hours, for batteries. */
    batteryAmpHours?: number;
    /** Rated output in watts, for solar panels. */
    solarWatts?: number;
    /** Continuous rating in watts, for inverters. */
    inverterWatts?: number;
  };
  /**
   * Plumbing characteristics, for tanks, fixtures and pumps.
   *
   * Minutes per day is what makes a shower expensive: at 1.8 GPM, eight minutes
   * is fourteen gallons, which is most of a small fresh tank in one wash.
   */
  plumbing?: {
    /** Tank role: fresh, grey or black. */
    tankRole?: string;
    /** Flow while running, in gallons per minute. */
    flowGpm?: number;
    /** Minutes of running per day. */
    minutesPerDay?: number;
    /** False when waste leaves the van directly rather than via a grey tank. */
    drainsToGrey?: boolean;
    /** Delivery rate in gallons per minute, for pumps. */
    pumpGpm?: number;
  };
  /**
   * Whether a new tank arrives full. Defaults to true.
   *
   * Fresh tanks start full because a layout that only balances empty is not a
   * layout that works. Waste tanks start empty, since fresh-full and grey-empty
   * is the state a van actually leaves in — filling both would double-count
   * water the van never carries at once.
   */
  startsFull?: boolean;
  placement: PlacementRule;
  /**
   * Notes seeded onto the created object — clearances, gotchas, sizing rules.
   * These are the things a first-time builder does not know to ask about.
   */
  notes: string;
  /** Search terms beyond the name, e.g. brand names and synonyms. */
  keywords: readonly string[];
}

/** Matches an item against a lowercased search query. */
export function matchesQuery(item: LibraryItem, query: string): boolean {
  if (query === '') return true;
  const haystack = `${item.name} ${item.description} ${item.keywords.join(' ')}`.toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}
