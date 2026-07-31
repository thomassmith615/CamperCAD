import type { Vector3 } from 'three';
import type { DisplayUnit } from '@/math/Units';
import type { ProjectionMode, ViewPreset } from './CameraManager';
import type { VehicleModel } from '@/vehicle/VehicleModel';

/**
 * The application's event vocabulary.
 *
 * Every entry is a contract between a producer and any number of consumers.
 * Adding a subsystem means adding entries here — never widening an existing
 * payload in a breaking way, because panels subscribe structurally.
 *
 * Type-only imports keep this module free of runtime dependencies, so it can be
 * imported from anywhere without creating an initialisation cycle.
 */
export interface AppEvents {
  /** The camera moved to a named view, or the user orbited away from one. */
  'view:changed': { preset: ViewPreset | null };
  /** Perspective/orthographic projection was switched. */
  'projection:changed': { mode: ProjectionMode };
  /** Grid spacing (inches) or visibility changed. */
  'grid:changed': { spacing: number; visible: boolean };
  /** The unit used for every readout and text input changed. */
  'units:changed': { unit: DisplayUnit };
  /** A vehicle finished building and was added to the scene. */
  'vehicle:loaded': { vehicle: VehicleModel };
  /** Part visibility of the current vehicle changed. */
  'vehicle:visibility': { part: string; visible: boolean };
  /** Emitted once per animation frame with renderer statistics. */
  'frame:rendered': { fps: number; drawCalls: number; triangles: number };
  /**
   * The pointer moved over the viewport. `point` is the intersection with the
   * van floor plane in internal inches, or null when the pointer is off-plane.
   */
  'pointer:moved': { point: Vector3 | null };
}
