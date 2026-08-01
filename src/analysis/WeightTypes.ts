/**
 * Weight and balance vocabulary.
 *
 * This is the first subsystem that produces an answer with a **right and wrong**
 * rather than a preference. A layout that is ugly is a matter of taste; a
 * layout that puts 5,600 lb on a 5,291 lb axle is illegal, uninsurable and
 * dangerous, and the model already contains everything needed to say so.
 *
 * All weights are pounds and all positions are inches in the vehicle frame.
 */

/** Density of fresh water, pounds per US gallon. */
export const WATER_LB_PER_GALLON = 8.34;

/**
 * A vehicle's weight ratings and axle geometry.
 *
 * `curbFront` and `curbRear` are the empty van as it sits, per axle. They are
 * split rather than given as one total because a front-wheel-drive van is
 * strongly front-biased empty, and using a 50/50 assumption would understate
 * front axle load by hundreds of pounds before a single cabinet is added.
 */
export interface VehicleWeightSpec {
  /** Gross vehicle weight rating: the legal maximum for the loaded van. */
  gvwr: number;
  /** Front gross axle weight rating. */
  frontGawr: number;
  /** Rear gross axle weight rating. */
  rearGawr: number;
  /** Empty weight carried by the front axle. */
  curbFront: number;
  /** Empty weight carried by the rear axle. */
  curbRear: number;
  /** Z coordinate of the front axle centreline, in the vehicle frame. */
  frontAxleZ: number;
  /** Z coordinate of the rear axle centreline. */
  rearAxleZ: number;
  /** Provenance of every figure above, shown in the weight panel. */
  sourceNotes: readonly string[];
}

/** How severe a limit breach is. */
export type LoadStatus = 'ok' | 'caution' | 'over';

/** One rating checked against one computed load. */
export interface LoadCheck {
  label: string;
  /** Computed load in pounds. */
  actual: number;
  /** Rated limit in pounds. */
  limit: number;
  status: LoadStatus;
  /** Fraction of the limit used, where 1 is exactly at the rating. */
  utilisation: number;
}

/** A complete weight and balance result. */
export interface WeightReport {
  /** Weight of everything the user has placed, including tank contents. */
  buildWeight: number;
  /** Weight of water and other fluids currently in tanks. */
  fluidWeight: number;
  /** Empty vehicle weight. */
  curbWeight: number;
  /** Curb plus build: the loaded van, before crew and gear. */
  grossWeight: number;
  /** Remaining capacity to GVWR, negative when over. */
  remainingPayload: number;

  /** Load on each axle including the van's own curb distribution. */
  frontAxle: number;
  rearAxle: number;

  /**
   * Centre of gravity of the build only, in the vehicle frame.
   *
   * The build's own CG is what the user can act on: they cannot move the
   * engine, but they can move the water tank.
   */
  buildCentre: { x: number; y: number; z: number } | null;

  /** Lateral imbalance: build weight on the passenger side minus driver side. */
  lateralImbalance: number;

  /** Every rating check, in display order. */
  checks: LoadCheck[];
  /** Plain-language problems, worst first. Empty when the build is legal. */
  warnings: string[];
}

/** Utilisation above which a load is flagged as worth watching. */
export const CAUTION_THRESHOLD = 0.9;

/**
 * Lateral imbalance, in pounds, above which a warning is raised.
 *
 * Vans are not sensitive to modest side-to-side imbalance, but a build with a
 * full water tank and a battery bank on one side and nothing on the other leans
 * visibly and wears one side's tyres. Two hundred pounds is roughly where that
 * becomes noticeable.
 */
export const LATERAL_WARNING_LB = 200;

/** Classifies a load against its rating. */
export function classifyLoad(actual: number, limit: number): LoadStatus {
  if (limit <= 0) return 'ok';
  const utilisation = actual / limit;
  if (utilisation > 1) return 'over';
  return utilisation >= CAUTION_THRESHOLD ? 'caution' : 'ok';
}
