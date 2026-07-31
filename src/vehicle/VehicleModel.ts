import * as THREE from 'three';
import type { CrossSection } from '@/geometry/CrossSection';
import type { VehicleDefinition } from './VehicleTypes';

/** A named, individually hideable piece of the vehicle. */
export interface VehiclePart {
  /** Stable id, e.g. `shell`, `floor`, `wheel-well-right`. */
  id: string;
  /** Label shown in the visibility list. */
  label: string;
  /** Scene object backing the part. */
  object: THREE.Object3D;
}

/**
 * A built vehicle: its definition, its scene objects, and the queries other
 * subsystems ask of it.
 *
 * Snapping, measurement and placement validation all need to ask geometric
 * questions of the van — how wide is it at this height, where is the ceiling,
 * is this point inside the cabin. Answering them from the analytic cross-section
 * rather than by raycasting the mesh is both exact and far cheaper, and it keeps
 * those subsystems independent of how the shell happens to be tessellated.
 */
export class VehicleModel {
  readonly definition: VehicleDefinition;
  readonly group = new THREE.Group();
  readonly section: CrossSection;

  private readonly partList: VehiclePart[] = [];

  constructor(definition: VehicleDefinition, section: CrossSection) {
    this.definition = definition;
    this.section = section;
    this.group.name = `Vehicle:${definition.id}`;
  }

  /** Every named part, in the order they were registered. */
  get parts(): readonly VehiclePart[] {
    return this.partList;
  }

  /** Z coordinate of the cab bulkhead. */
  get frontZ(): number {
    return -this.definition.interior.length / 2;
  }

  /** Z coordinate of the rear door opening. */
  get rearZ(): number {
    return this.definition.interior.length / 2;
  }

  /** Interior standing height at the centreline. */
  get standingHeight(): number {
    return this.section.peakHeight;
  }

  /** Widest interior dimension and the height at which it occurs. */
  get widestPoint(): { width: number; height: number } {
    return this.section.maximumWidth();
  }

  /** Adds a part to the model and to the vehicle group. */
  addPart(part: VehiclePart): void {
    this.partList.push(part);
    this.group.add(part.object);
  }

  /** Looks up a part by id. */
  part(id: string): VehiclePart | undefined {
    return this.partList.find((p) => p.id === id);
  }

  /** Shows or hides a single part. Returns false if the id is unknown. */
  setPartVisible(id: string, visible: boolean): boolean {
    const part = this.part(id);
    if (!part) return false;
    part.object.visible = visible;
    return true;
  }

  /** Interior width available at a given height above the floor. */
  widthAtHeight(height: number): number {
    return this.section.widthAtHeight(height);
  }

  /**
   * Distance from a point to the nearest side wall, measured horizontally at
   * that point's own height. Negative when the point is outside the wall.
   *
   * This is the primitive the measurement readout and wall snapping are built
   * on; it accounts for the wall's tumblehome, which a naive half-width check
   * does not.
   */
  distanceToSideWall(point: THREE.Vector3): number {
    const halfWidth = this.widthAtHeight(point.y) / 2;
    if (halfWidth <= 0) return 0;
    return halfWidth - Math.abs(point.x);
  }

  /** True when the point lies inside the cabin volume. */
  contains(point: THREE.Vector3): boolean {
    if (point.y < 0 || point.y > this.standingHeight) return false;
    if (point.z < this.frontZ || point.z > this.rearZ) return false;
    return this.distanceToSideWall(point) >= 0;
  }

  /** Axis-aligned bounds of the cabin volume. */
  interiorBounds(): THREE.Box3 {
    const { width } = this.widestPoint;
    return new THREE.Box3(
      new THREE.Vector3(-width / 2, 0, this.frontZ),
      new THREE.Vector3(width / 2, this.standingHeight, this.rearZ),
    );
  }

  /** Usable floor area in square feet, for the vehicle summary panel. */
  floorAreaSquareFeet(): number {
    const { length, floorWidth } = this.definition.interior;
    return (length * floorWidth) / 144;
  }
}
