import type { Vector3 } from 'three';
import type { DisplayUnit } from '@/math/Units';
import type { ProjectionMode, ViewPreset } from './CameraManager';
import type { VehicleModel } from '@/vehicle/VehicleModel';
import type { SceneObject } from '@/objects/SceneObject';
import type { ObjectPropertyKey } from '@/objects/ObjectTypes';
import type { GizmoMode } from '@/selection/TransformGizmo';
import type { ToolId } from '@/tools/ToolTypes';
import type { AppliedSnap } from '@/snapping/SnapTypes';
import type { GroupData, LayerData } from '@/objects/StructureTypes';
import type { InputMode } from '@/input/InputSettings';
import type { WeightReport } from '@/analysis/WeightTypes';

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

  /** Objects entered the design, whether newly created or restored by undo. */
  'objects:added': { objects: SceneObject[] };
  /** Objects left the design. Consumers holding references must drop them. */
  'objects:removed': { objects: SceneObject[] };
  /**
   * An object's state changed. `key` names the property, or is `transform` when
   * a gizmo drag changed position, rotation or dimensions together.
   */
  'object:changed': { object: SceneObject; key: ObjectPropertyKey | 'transform' };
  /** The selection changed. The array is ordered by time of selection. */
  'selection:changed': { objects: SceneObject[] };
  /** The undo history changed. Labels describe the next undo and redo steps. */
  'history:changed': {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
  };
  /** The active tool changed. */
  'tool:changed': { tool: ToolId };
  /**
   * The transform gizmo's state changed. `enabled` is false when nothing
   * transformable is selected; `multiSelect` restricts the available modes.
   */
  'gizmo:changed': { mode: GizmoMode; enabled: boolean; multiSelect: boolean };

  /** Snapping was enabled or disabled, or its tolerance changed. */
  'snap:settings': { enabled: boolean; tolerance: number };
  /**
   * The set of snaps holding the dragged object changed. Empty while nothing is
   * being dragged, or while a drag is running free.
   */
  'snap:active': { applied: AppliedSnap[] };
  /**
   * The measure tool's result changed. Null once the measurement is cleared or
   * only one endpoint has been placed.
   */
  'measure:changed': {
    measurement: { distance: number; dx: number; dy: number; dz: number } | null;
  };

  /** The open project changed identity, name or save state. */
  'project:changed': { id: string; name: string; updatedAt: string; dirty: boolean };
  /**
   * A project operation failed in a way the user needs to know about — a full
   * storage quota, an unreadable file, a missing vehicle.
   */
  'project:error': { message: string };
  /**
   * The user asked for the open dialog, from the keyboard rather than the
   * toolbar. Raised as an event so the shortcut does not require the core to
   * know that a dialog exists.
   */
  'project:open-requested': undefined;

  /** Layers or groups changed: added, removed, renamed or retoggled. */
  'structure:changed': { layers: LayerData[]; groups: GroupData[] };
  /** The outliner opened or closed. */
  'outliner:toggled': { open: boolean };
  /** The outliner was toggled from the keyboard. */
  'outliner:requested': undefined;
  /** The input device mode changed, whether detected or chosen. */
  'input:mode': { mode: InputMode };

  /** A fresh weight and balance result. Recomputed whenever the design changes. */
  'weight:changed': { report: WeightReport | null };
  /** The balance overlay was shown or hidden. */
  'balance:toggled': { visible: boolean };

  /** The library drawer opened or closed. */
  'library:toggled': { open: boolean };
  /**
   * The user asked to toggle the library from the keyboard. Raised as an event
   * so the shortcut does not require the core to know the drawer exists.
   */
  'library:requested': undefined;
}
