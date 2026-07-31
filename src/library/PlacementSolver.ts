import * as THREE from 'three';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { VehicleModel } from '@/vehicle/VehicleModel';
import type { LibraryItem, PlacementRule } from './LibraryTypes';

/** Gap left between a wall-mounted item and the wall, in inches. */
const WALL_GAP = 0.5;

/** Gap left below a ceiling-mounted item, in inches. */
const CEILING_GAP = 0.25;

/**
 * Resolves a library item's placement rule into an actual position.
 *
 * The rules encode what a builder would do without thinking: a roof fan goes on
 * the ceiling, a battery goes on the floor, an upper cabinet goes against
 * whichever wall you dropped it near. Getting this right removes the most
 * tedious part of laying out a van, which is dragging every component down onto
 * the surface it obviously belongs on.
 *
 * Every rule degrades safely. With no vehicle loaded, or with a drop point
 * outside the cabin, placement falls back to the floor at the cursor rather
 * than refusing or producing something floating in space.
 */
export class PlacementSolver {
  private readonly store: ObjectStore;
  private vehicle: VehicleModel | null = null;

  constructor(store: ObjectStore) {
    this.store = store;
  }

  /** Points the solver at the loaded vehicle, or at none. */
  setVehicle(vehicle: VehicleModel | null): void {
    this.vehicle = vehicle;
  }

  /** The vehicle placements are being solved against, or null. */
  get target(): VehicleModel | null {
    return this.vehicle;
  }

  /**
   * Computes where an item should sit.
   *
   * @param item Library item being placed.
   * @param cursor Point on the floor plane under the pointer, in inches.
   * @returns Position for the object's origin — the centre of its bottom face —
   * and the Y rotation it should take.
   */
  solve(item: LibraryItem, cursor: THREE.Vector3): { position: THREE.Vector3; rotationY: number } {
    const [width, height, depth] = item.dimensions;
    const position = cursor.clone();
    let rotationY = 0;

    switch (item.placement) {
      case 'floor':
        position.y = 0;
        break;

      case 'ceiling':
        position.y = this.ceilingHeight(position.x, width) - height - CEILING_GAP;
        break;

      case 'wall': {
        const placement = this.againstNearestWall(position, depth, height);
        position.copy(placement.position);
        rotationY = placement.rotationY;
        break;
      }

      case 'surface':
        position.y = this.surfaceHeightAt(position, width, depth);
        break;

      case 'free':
        position.y = 0;
        break;
    }

    position.y = Math.max(0, position.y);
    return { position, rotationY };
  }

  /**
   * True when the rule wants the item held at a computed height rather than
   * dropped on the floor. Used by the creation tool to decide whether the ghost
   * should follow the cursor's floor point or the solved position.
   */
  static isElevated(rule: PlacementRule): boolean {
    return rule === 'ceiling' || rule === 'wall' || rule === 'surface';
  }

  /** Ceiling height over a footprint centred on `x` and `width` wide. */
  private ceilingHeight(x: number, width: number): number {
    const vehicle = this.vehicle;
    if (!vehicle) return 76;
    return vehicle.ceilingHeightOver(x - width / 2, x + width / 2);
  }

  /**
   * Places an item flat against whichever side wall is nearer.
   *
   * The item is rotated a quarter turn so its depth faces the wall, then pushed
   * in until it touches. The wall position is taken at the item's own height
   * band, so an upper cabinet sits where the wall actually is at 50 inches
   * rather than where it is at the floor.
   */
  private againstNearestWall(
    cursor: THREE.Vector3,
    depth: number,
    height: number,
  ): { position: THREE.Vector3; rotationY: number } {
    const position = cursor.clone();
    const vehicle = this.vehicle;

    // Wall items keep whatever height the cursor implies unless it is on the
    // floor, in which case a sensible mounting height is assumed.
    if (position.y <= 0) position.y = 40;

    if (!vehicle) return { position, rotationY: 0 };

    const halfWidth = vehicle.narrowestHalfWidth(position.y, position.y + height);
    if (halfWidth <= 0) return { position, rotationY: 0 };

    const onPassengerSide = cursor.x >= 0;

    // Rotated a quarter turn, the object's depth runs along X and its width
    // along Z, so the half-extent pushed against the wall is depth/2.
    position.x = onPassengerSide ? halfWidth - depth / 2 - WALL_GAP : -halfWidth + depth / 2 + WALL_GAP;

    return { position, rotationY: onPassengerSide ? -Math.PI / 2 : Math.PI / 2 };
  }

  /**
   * Height of the highest existing object under the given footprint.
   *
   * This is what makes a countertop land on the cabinet below it and a mattress
   * land on its platform, rather than both ending up on the floor. Only objects
   * whose footprint genuinely overlaps are considered, so a fridge across the
   * aisle does not lift a counter into the air.
   */
  private surfaceHeightAt(cursor: THREE.Vector3, width: number, depth: number): number {
    const footprint = new THREE.Box2(
      new THREE.Vector2(cursor.x - width / 2, cursor.z - depth / 2),
      new THREE.Vector2(cursor.x + width / 2, cursor.z + depth / 2),
    );

    let height = 0;

    for (const object of this.store.all()) {
      if (!object.mesh.visible) continue;

      const box = object.boundingBox();
      const other = new THREE.Box2(
        new THREE.Vector2(box.min.x, box.min.z),
        new THREE.Vector2(box.max.x, box.max.z),
      );

      if (!footprint.intersectsBox(other)) continue;
      height = Math.max(height, box.max.y);
    }

    return height;
  }
}
