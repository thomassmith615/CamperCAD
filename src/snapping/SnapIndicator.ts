import * as THREE from 'three';
import type { AppliedSnap } from './SnapTypes';

/** Instrument cyan, the colour reserved throughout the app for measurement. */
const INDICATOR_COLOR = 0x4fd0d8;

/** How far the indicator extends past the object's bounds, in inches. */
const OVERSHOOT = 8;

/**
 * Draws the planes a moving object is currently snapped to.
 *
 * One line per active snap, laid along the snapped plane and stretched a little
 * past the object so it reads as a guide rather than an edge of the object
 * itself. Depth testing is off so a guide against the far wall is still visible
 * through the object it is guiding.
 *
 * Without this, snapping is invisible: the object simply refuses to sit where
 * the pointer is, which reads as a bug rather than as assistance.
 */
export class SnapIndicator {
  readonly group = new THREE.Group();

  private readonly material: THREE.LineBasicMaterial;
  private readonly pool: THREE.Line[] = [];

  constructor() {
    this.group.name = 'Snap indicators';
    this.group.renderOrder = 998;
    this.group.visible = false;

    this.material = new THREE.LineBasicMaterial({
      color: INDICATOR_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
  }

  /**
   * Redraws the guides.
   *
   * @param applied Snaps currently in force.
   * @param bounds World bounds of the moving object, used to size the guides.
   */
  show(applied: readonly AppliedSnap[], bounds: THREE.Box3): void {
    if (applied.length === 0) {
      this.clear();
      return;
    }

    this.group.visible = true;
    this.ensureCapacity(applied.length);

    applied.forEach((snap, index) => {
      const line = this.pool[index];
      line.visible = true;
      line.geometry.setFromPoints(SnapIndicator.pointsFor(snap, bounds));
      line.geometry.computeBoundingSphere();
    });

    for (let i = applied.length; i < this.pool.length; i += 1) {
      this.pool[i].visible = false;
    }
  }

  /** Hides every guide. Called when a drag ends. */
  clear(): void {
    this.group.visible = false;
    for (const line of this.pool) line.visible = false;
  }

  /** Releases geometry and the shared material. */
  dispose(): void {
    for (const line of this.pool) line.geometry.dispose();
    this.material.dispose();
  }

  /** Grows the line pool to hold at least `count` guides. */
  private ensureCapacity(count: number): void {
    while (this.pool.length < count) {
      const line = new THREE.Line(new THREE.BufferGeometry(), this.material);
      line.frustumCulled = false;
      line.renderOrder = 998;
      this.pool.push(line);
      this.group.add(line);
    }
  }

  /**
   * Builds the guide line for one snap.
   *
   * The line lies in the snapped plane and runs along the object's longest
   * remaining extent, which is the direction that makes the alignment legible.
   */
  private static pointsFor(snap: AppliedSnap, bounds: THREE.Box3): THREE.Vector3[] {
    const min = bounds.min.clone().addScalar(-OVERSHOOT);
    const max = bounds.max.clone().addScalar(OVERSHOOT);

    switch (snap.axis) {
      case 'x':
        return [new THREE.Vector3(snap.value, min.y, min.z), new THREE.Vector3(snap.value, min.y, max.z)];
      case 'y':
        return [new THREE.Vector3(min.x, snap.value, min.z), new THREE.Vector3(max.x, snap.value, min.z)];
      case 'z':
        return [new THREE.Vector3(min.x, min.y, snap.value), new THREE.Vector3(max.x, min.y, snap.value)];
    }
  }
}
