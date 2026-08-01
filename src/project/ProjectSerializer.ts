import type { DisplayUnit } from '@/math/Units';
import type { CameraState } from '@/core/CameraManager';
import type { ObjectData, ObjectKind } from '@/objects/ObjectTypes';
import { PROJECT_SCHEMA, ProjectFormatError, type ProjectData } from './ProjectTypes';
import { DEFAULT_LAYERS, DEFAULT_LAYER_ID, type GroupData, type LayerData } from '@/objects/StructureTypes';

/** Units a project may declare. */
const UNITS: readonly DisplayUnit[] = ['in', 'ft-in', 'mm', 'cm', 'm'];

/** Object kinds this build can rebuild. */
const KINDS: readonly ObjectKind[] = ['box', 'cylinder', 'panel', 'extrusion'];

/** Values used when an optional field is absent from an older file. */
const DEFAULT_CAMERA: CameraState = {
  position: [220, 150, 260],
  target: [0, 30, 0],
  projection: 'perspective',
  zoom: 1,
};

/** Narrows an unknown value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a finite number, or returns the fallback. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Reads a boolean, or returns the fallback. */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Reads a non-empty string, or returns the fallback. */
function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Reads a fixed-length numeric tuple, or returns the fallback. */
function triple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])];
}

/**
 * Reads and writes project files.
 *
 * Parsing is deliberately **lenient about missing fields and strict about
 * wrong ones**. A file that omits a property the current build expects is
 * repaired with a default, because that is what an older file looks like; a file
 * whose property is present but the wrong type is rejected, because that is what
 * a corrupt or unrelated file looks like. Silently repairing the second case
 * would load a project full of zeros and let the user believe it was their work.
 */
export class ProjectSerializer {
  /** Formats a project as pretty-printed JSON for export. */
  static stringify(project: ProjectData): string {
    return JSON.stringify(project, null, 2);
  }

  /**
   * Parses project JSON.
   *
   * @throws {ProjectFormatError} When the text is not JSON, or not a project.
   */
  static parse(text: string): ProjectData {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ProjectFormatError('That file is not valid JSON.');
    }
    return ProjectSerializer.migrate(raw);
  }

  /**
   * Brings any supported file version up to the current schema.
   *
   * New versions are handled by adding a case below that upgrades from the
   * previous one and falls through, so a v1 file passes through every step in
   * order rather than needing a dedicated v1-to-current path.
   *
   * @throws {ProjectFormatError} When the value is not a project, or comes from
   * a newer build than this one.
   */
  static migrate(raw: unknown): ProjectData {
    if (!isRecord(raw)) {
      throw new ProjectFormatError('That file does not contain a CamperCAD project.');
    }

    const schema = num(raw.schema, 0);
    if (schema === 0 || !Array.isArray(raw.objects)) {
      throw new ProjectFormatError('That file does not contain a CamperCAD project.');
    }
    if (schema > PROJECT_SCHEMA) {
      throw new ProjectFormatError(
        `This project was saved by a newer version of CamperCAD (format ${schema}). Update before opening it.`,
      );
    }

    const now = new Date().toISOString();

    return {
      schema: PROJECT_SCHEMA,
      id: str(raw.id, ProjectSerializer.createId()),
      name: str(raw.name, 'Untitled project'),
      createdAt: str(raw.createdAt, now),
      updatedAt: str(raw.updatedAt, now),
      vehicleId: str(raw.vehicleId, ''),
      units: ProjectSerializer.readUnit(raw.units),
      grid: ProjectSerializer.readGrid(raw.grid),
      snapping: ProjectSerializer.readSnapping(raw.snapping),
      camera: ProjectSerializer.readCamera(raw.camera),
      objects: raw.objects.map((entry, index) => ProjectSerializer.readObject(entry, index)),
      layers: ProjectSerializer.readLayers(raw.layers),
      groups: ProjectSerializer.readGroups(raw.groups),
    };
  }

  /** Generates an identifier for a project without a secure context. */
  static createId(): string {
    return `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Reads the layer list.
   *
   * A file with no layers is a file saved before layers existed, so it gets the
   * defaults; its objects fall back to the default layer individually. This is
   * exactly the case the lenient-about-missing rule was written for.
   */
  private static readLayers(value: unknown): LayerData[] {
    if (!Array.isArray(value) || value.length === 0) {
      return DEFAULT_LAYERS.map((layer) => ({ ...layer }));
    }

    const layers = value.filter(isRecord).map((entry, index) => ({
      id: str(entry.id, `layer-${index}`),
      name: str(entry.name, `Layer ${index + 1}`),
      visible: bool(entry.visible, true),
      locked: bool(entry.locked, false),
      color: str(entry.color, '#e2a44a'),
    }));

    return layers.length > 0 ? layers : DEFAULT_LAYERS.map((layer) => ({ ...layer }));
  }

  /** Reads the group list, discarding malformed entries. */
  private static readGroups(value: unknown): GroupData[] {
    if (!Array.isArray(value)) return [];

    return value.filter(isRecord).map((entry, index) => ({
      id: str(entry.id, `group-${index}`),
      name: str(entry.name, `Group ${index + 1}`),
      collapsed: bool(entry.collapsed, true),
    }));
  }

  private static readUnit(value: unknown): DisplayUnit {
    return UNITS.includes(value as DisplayUnit) ? (value as DisplayUnit) : 'in';
  }

  private static readGrid(value: unknown): ProjectData['grid'] {
    if (!isRecord(value)) return { spacing: 1, visible: true };
    return { spacing: Math.max(0.01, num(value.spacing, 1)), visible: bool(value.visible, true) };
  }

  private static readSnapping(value: unknown): ProjectData['snapping'] {
    if (!isRecord(value)) return { enabled: true, tolerance: 1.5 };
    return { enabled: bool(value.enabled, true), tolerance: Math.max(0, num(value.tolerance, 1.5)) };
  }

  private static readCamera(value: unknown): CameraState {
    if (!isRecord(value)) return { ...DEFAULT_CAMERA };
    return {
      position: triple(value.position, DEFAULT_CAMERA.position),
      target: triple(value.target, DEFAULT_CAMERA.target),
      projection: value.projection === 'orthographic' ? 'orthographic' : 'perspective',
      zoom: Math.max(0.01, num(value.zoom, 1)),
    };
  }

  /**
   * Reads one object.
   *
   * An object with an unrecognised kind is rejected rather than coerced to a
   * box: a project from a future build containing a water tank must not open
   * silently with the tank turned into a cube of the wrong size.
   */
  private static readObject(value: unknown, index: number): ObjectData {
    if (!isRecord(value)) {
      throw new ProjectFormatError(`Object ${index + 1} in this project is malformed.`);
    }

    const kind = value.kind;
    if (!KINDS.includes(kind as ObjectKind)) {
      throw new ProjectFormatError(
        `This project contains an object type this version cannot open ("${String(kind)}").`,
      );
    }

    return {
      schema: 1,
      id: str(value.id, `obj_${index}_${Math.random().toString(36).slice(2, 8)}`),
      kind: kind as ObjectKind,
      name: str(value.name, `Object ${index + 1}`),
      dimensions: triple(value.dimensions, [24, 24, 24]),
      position: triple(value.position, [0, 0, 0]),
      rotation: triple(value.rotation, [0, 0, 0]),
      color: str(value.color, '#c9a227'),
      weight: Math.max(0, num(value.weight, 0)),
      price: Math.max(0, num(value.price, 0)),
      capacityGallons: Math.max(0, num(value.capacityGallons, 0)),
      fillGallons: Math.max(0, num(value.fillGallons, 0)),
      loadWatts: Math.max(0, num(value.loadWatts, 0)),
      loadHoursPerDay: Math.max(0, num(value.loadHoursPerDay, 0)),
      loadIsAc: bool(value.loadIsAc, false),
      batteryAmpHours: Math.max(0, num(value.batteryAmpHours, 0)),
      solarWatts: Math.max(0, num(value.solarWatts, 0)),
      inverterWatts: Math.max(0, num(value.inverterWatts, 0)),
      notes: typeof value.notes === 'string' ? value.notes : '',
      material: str(value.material, 'birch-ply'),
      locked: bool(value.locked, false),
      visible: bool(value.visible, true),
      layerId: str(value.layerId, DEFAULT_LAYER_ID),
      groupId: typeof value.groupId === 'string' ? value.groupId : '',
      ...ProjectSerializer.readProfile(value.profile),
    };
  }

  /**
   * Reads an extrusion profile.
   *
   * A malformed profile is dropped rather than rejected: the object still has
   * valid dimensions, so it loads as a box of the right size and the user can
   * reshape it. Refusing the whole project over one bad polygon would be a
   * worse trade.
   */
  private static readProfile(value: unknown): { profile?: Array<[number, number]> } {
    if (!Array.isArray(value)) return {};

    const points = value
      .filter((entry): entry is unknown[] => Array.isArray(entry) && entry.length === 2)
      .map((entry) => [num(entry[0], 0), num(entry[1], 0)] as [number, number]);

    return points.length >= 3 ? { profile: points } : {};
  }
}
