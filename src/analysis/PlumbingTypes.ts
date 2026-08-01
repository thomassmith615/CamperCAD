/**
 * Plumbing vocabulary.
 *
 * A van water system is small enough that the usual plumbing arithmetic mostly
 * does not bite — runs are feet rather than storeys, and a 12 V pump makes far
 * less pressure than a mains supply. What does bite is capacity: a 20 gallon
 * tank and a shower are not compatible, and the only way to find that out
 * should not be running out of water three days from a tap.
 *
 * Flows are US gallons per minute, volumes US gallons, pressures psi.
 */

/** What role a tank plays in the system. */
export type TankRole = 'none' | 'fresh' | 'grey' | 'black';

/** Display labels for the tank role picker. */
export const TANK_ROLE_LABELS: Record<TankRole, string> = {
  none: 'Not a tank',
  fresh: 'Fresh water',
  grey: 'Grey waste',
  black: 'Black waste',
};

/** One tubing size. */
export interface PipeSpec {
  /** Nominal size as sold, e.g. `1/2"`. */
  label: string;
  /** Nominal size in inches, used for ordering. */
  nominal: number;
  /**
   * Inside diameter in inches.
   *
   * PEX is sized by *outside* diameter, so half-inch PEX has a considerably
   * smaller bore than half-inch copper. Using the nominal figure in a velocity
   * calculation understates velocity by about a third, which is exactly the
   * error that produces a system that hammers and whistles.
   */
  insideDiameter: number;
  /** Typical cost per foot in US dollars. */
  costPerFoot: number;
}

/**
 * Tubing commonly used in conversions.
 *
 * PEX-B dominates because it tolerates freezing better than rigid pipe and can
 * be run in continuous lengths around corners without fittings — and every
 * fitting inside a wall is a leak waiting for a rough road.
 */
export const PIPE_TABLE: readonly PipeSpec[] = [
  { label: '3/8" PEX', nominal: 0.375, insideDiameter: 0.35, costPerFoot: 0.55 },
  { label: '1/2" PEX', nominal: 0.5, insideDiameter: 0.475, costPerFoot: 0.65 },
  { label: '3/4" PEX', nominal: 0.75, insideDiameter: 0.671, costPerFoot: 1.1 },
];

/** Drain sizes, which are chosen by fixture rather than calculated. */
export const DRAIN_TABLE: readonly PipeSpec[] = [
  { label: '1-1/4" drain', nominal: 1.25, insideDiameter: 1.19, costPerFoot: 1.8 },
  { label: '1-1/2" drain', nominal: 1.5, insideDiameter: 1.44, costPerFoot: 2.2 },
];

/**
 * Maximum comfortable flow velocity, in feet per second.
 *
 * Above roughly 8 ft/s water becomes audibly noisy and erodes fittings over
 * time. In a van the noise matters more than the erosion: the plumbing runs
 * within a few feet of where someone is sleeping.
 */
export const MAX_VELOCITY_FPS = 8;

/** Velocity above which the system is workable but will be heard. */
export const QUIET_VELOCITY_FPS = 5;

/** Hazen-Williams roughness coefficient for smooth plastic tubing. */
export const HAZEN_WILLIAMS_C = 150;

/** One fixture drawing water. */
export interface FixtureEntry {
  name: string;
  /** Flow while running, in gallons per minute. */
  flowGpm: number;
  /** Minutes of running per day. */
  minutesPerDay: number;
  /** Water used per day, in gallons. */
  dailyGallons: number;
  /** Whether waste goes to the grey tank rather than straight out. */
  drainsToGrey: boolean;
  /** Straight-line distance from the fresh tank, in inches. */
  distanceFromTank: number | null;
}

/** A sized supply run. */
export interface PipeRun {
  fixture: FixtureEntry;
  /** One-way run length in feet, after routing allowance. */
  runFeet: number;
  /** Chosen tubing, or null when nothing in the table works. */
  pipe: PipeSpec | null;
  /** Flow velocity in the chosen tubing, feet per second. */
  velocityFps: number;
  /** Pressure lost over the run, in psi. */
  pressureDropPsi: number;
  /** Set when the run cannot be made to work. */
  problem: string | null;
}

/** Tank capacity and endurance. */
export interface WaterBudget {
  freshGallons: number;
  greyGallons: number;
  blackGallons: number;
  /** Water used per day across every fixture. */
  dailyUse: number;
  /** Water reaching the grey tank per day. */
  dailyGrey: number;
  /** Days before the fresh tank runs dry. */
  daysOfWater: number;
  /** Days before the grey tank needs dumping. */
  daysToGreyFull: number;
  /** Peak simultaneous demand, in gallons per minute. */
  peakDemandGpm: number;
  /** Installed pump capacity, in gallons per minute. */
  pumpGpm: number;
  /** Weight of a full fresh tank, in pounds. */
  freshWeightFull: number;
  warnings: string[];
}

/** A complete plumbing report. */
export interface PlumbingReport {
  fixtures: FixtureEntry[];
  runs: PipeRun[];
  budget: WaterBudget;
  hasFreshTank: boolean;
}

/**
 * Routing allowance applied to straight-line distances.
 *
 * Slightly higher than the electrical figure: water lines cannot turn as
 * sharply as wire, and they are usually routed to stay inside the heated
 * envelope rather than by the shortest path.
 */
export const PLUMBING_ROUTING_FACTOR = 1.5;

/** Extra tubing allowed at each end for connections, in feet. */
export const PLUMBING_SLACK_FEET = 3;
