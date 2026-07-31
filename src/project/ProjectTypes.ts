import type { DisplayUnit } from '@/math/Units';
import type { CameraState } from '@/core/CameraManager';
import type { ObjectData } from '@/objects/ObjectTypes';
import type { GroupData, LayerData } from '@/objects/StructureTypes';

/**
 * Current project file schema.
 *
 * Bumped only for a change existing files cannot survive. Adding an optional
 * field is not such a change: {@link migrate} fills defaults for anything
 * missing, so a v1 file gains new features rather than being rejected.
 */
export const PROJECT_SCHEMA = 1;

/** File extension and MIME type used for export and import. */
export const PROJECT_FILE_EXTENSION = '.campercad.json';

/**
 * A saved design.
 *
 * The vehicle is referenced by id rather than embedded, and every length is in
 * internal inches regardless of the unit the project was authored in — `units`
 * records only how to display them. A project authored in millimetres and one
 * authored in inches are byte-identical apart from that field, which is what
 * lets two people collaborate without a conversion step.
 */
export interface ProjectData {
  schema: number;
  /** Stable identifier. Preserved across saves, regenerated on import. */
  id: string;
  name: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Id of a vehicle in the catalog. */
  vehicleId: string;
  /** Display unit, not a storage unit. */
  units: DisplayUnit;
  grid: { spacing: number; visible: boolean };
  snapping: { enabled: boolean; tolerance: number };
  camera: CameraState;
  objects: ObjectData[];
  /** Layers. Absent in projects saved before layers existed. */
  layers: LayerData[];
  /** Groups. Absent in projects saved before groups existed. */
  groups: GroupData[];
}

/** Lightweight record for the open dialog, read without loading a project. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  objectCount: number;
  vehicleId: string;
}

/**
 * Raised when a file cannot be read as a project.
 *
 * Carries a message written for the user rather than a stack trace, because
 * this is the one error in the application that a person will routinely see:
 * dragging in the wrong JSON file is an easy mistake.
 */
export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}
