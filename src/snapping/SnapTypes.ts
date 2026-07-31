/**
 * Vocabulary for the snapping system.
 *
 * Snapping is solved **per axis**. Every snap the specification calls for —
 * grid, walls, ceiling, floor, other objects, corners, edges, faces — reduces to
 * "some feature of the moving object should land on some world coordinate along
 * one axis". Corner and edge snapping are not special cases: they are what
 * happens when two or three axes resolve at once.
 */

/** The axis a candidate constrains. */
export type SnapAxis = 'x' | 'y' | 'z';

/** What produced a candidate, used for priority and for the readout. */
export type SnapSource = 'grid' | 'floor' | 'ceiling' | 'wall' | 'bulkhead' | 'rear' | 'object';

/** Which feature of the moving object a candidate aligns. */
export type SnapAnchor = 'min' | 'center' | 'max';

/**
 * Priority per source. Lower wins when two candidates are both in range.
 *
 * Real geometry beats the grid: if a cabinet is a hair off the wall and also a
 * hair off a grid line, the user meant the wall.
 */
export const SNAP_PRIORITY: Record<SnapSource, number> = {
  wall: 0,
  floor: 0,
  ceiling: 0,
  bulkhead: 0,
  rear: 0,
  object: 1,
  grid: 2,
};

/** A world coordinate the moving object may be attracted to. */
export interface SnapCandidate {
  axis: SnapAxis;
  /** World coordinate to align to, in inches. */
  value: number;
  /** Feature of the moving object that should land on `value`. */
  anchor: SnapAnchor;
  source: SnapSource;
  /** Short description shown in the status bar, e.g. `Left wall`. */
  label: string;
}

/** A candidate that was actually applied, with the correction it produced. */
export interface AppliedSnap extends SnapCandidate {
  /** Correction added to the moving object's position along `axis`. */
  delta: number;
}

/** The outcome of one snap solve. */
export interface SnapResult {
  /** Correction to add to the moving object's position, in inches. */
  delta: [number, number, number];
  /** Candidates that were applied, at most one per axis. */
  applied: AppliedSnap[];
}

/** User-controllable snapping behaviour. */
export interface SnapSettings {
  /** Master switch, toggled from the toolbar. */
  enabled: boolean;
  /**
   * Attraction distance in inches.
   *
   * Fixed in world units rather than screen pixels: a builder thinks "within
   * an inch", and a tolerance that grew as you zoomed out would snap a cabinet
   * across the van.
   */
  tolerance: number;
}

/** Defaults applied at startup. */
export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  enabled: true,
  tolerance: 1.5,
};
