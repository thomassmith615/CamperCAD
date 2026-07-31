import * as THREE from 'three';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { VehicleModel } from '@/vehicle/VehicleModel';

/** Gap to the nearest other object, with the object it was measured against. */
export interface NearestGap {
  object: SceneObject;
  /** Shortest distance between the two bounding boxes, in inches. Zero when
   * they touch or overlap. */
  distance: number;
}

/**
 * Every clearance the inspector reports for one object.
 *
 * Values are inches. A negative clearance means the object protrudes past that
 * surface, which is exactly the case a builder needs to see rather than have
 * clamped to zero.
 */
export interface Clearances {
  toFloor: number;
  toCeiling: number;
  toDriverWall: number;
  toPassengerWall: number;
  toBulkhead: number;
  toRearDoors: number;
  nearest: NearestGap | null;
}

/**
 * Computes distances between an object and the things around it.
 *
 * Clearances are taken against the analytic cross-section rather than by
 * raycasting the shell mesh. That matters on a curved wall: the useful number is
 * the gap where the wall is tightest across the object's own height, not the gap
 * at some arbitrary sample point, and the section can answer that exactly while
 * a raycast would need dozens of probes to approximate it.
 */
export class MeasurementService {
  private readonly store: ObjectStore;
  private vehicle: VehicleModel | null = null;

  constructor(store: ObjectStore) {
    this.store = store;
  }

  /** Points the service at the loaded vehicle, or at none. */
  setVehicle(vehicle: VehicleModel | null): void {
    this.vehicle = vehicle;
  }

  /**
   * Measures one object against the vehicle and its neighbours.
   *
   * @returns Null when no vehicle is loaded, since every clearance but the
   * nearest-object gap is defined relative to the van.
   */
  clearances(object: SceneObject): Clearances | null {
    const vehicle = this.vehicle;
    if (!vehicle) return null;

    const box = object.boundingBox();
    const halfWidth = vehicle.narrowestHalfWidth(box.min.y, box.max.y);
    const ceiling = vehicle.ceilingHeightOver(box.min.x, box.max.x);

    return {
      toFloor: box.min.y,
      toCeiling: ceiling - box.max.y,
      toDriverWall: box.min.x - -halfWidth,
      toPassengerWall: halfWidth - box.max.x,
      toBulkhead: box.min.z - vehicle.frontZ,
      toRearDoors: vehicle.rearZ - box.max.z,
      nearest: this.nearestObject(object),
    };
  }

  /**
   * Finds the closest other object and the gap to it.
   *
   * Distance is measured between bounding boxes rather than between centres, so
   * the number answers "will these fit side by side" rather than "how far apart
   * are they conceptually".
   */
  nearestObject(object: SceneObject): NearestGap | null {
    const box = object.boundingBox();
    let best: NearestGap | null = null;

    for (const other of this.store.all()) {
      if (other === object || !other.mesh.visible) continue;

      const distance = MeasurementService.boxGap(box, other.boundingBox());
      if (!best || distance < best.distance) best = { object: other, distance };
    }

    return best;
  }

  /**
   * Shortest distance between two axis-aligned boxes.
   *
   * Per-axis separation is zero where the boxes overlap, so boxes that overlap
   * on every axis return zero and boxes that miss on one axis return the true
   * diagonal gap.
   */
  static boxGap(a: THREE.Box3, b: THREE.Box3): number {
    const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));
    const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));
    const dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z));
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
