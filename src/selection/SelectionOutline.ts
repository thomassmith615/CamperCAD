import * as THREE from 'three';
import type { SceneObject } from '@/objects/SceneObject';

/** Outline colour: the accent reserved for things the user owns. */
const OUTLINE_COLOR = 0xe2a44a;

/**
 * Draws outlines around selected objects.
 *
 * Edges of the object's **own geometry** are used rather than an axis-aligned
 * bounding box helper. For a cabinet rotated to follow the van's sidewall those
 * differ substantially, and a loose box floating around a rotated object reads
 * as a bug. It matters more once shapes are not all boxes: a bounding-box
 * outline around a cylinder or an L-shaped counter would be plainly wrong.
 *
 * Copying the object's world matrix onto the outline makes the fit exact for
 * free, since both are built against the same unit-box contract.
 *
 * Outlines are drawn with depth testing off so a selected object stays visible
 * behind the van shell, which is the situation the user is usually in.
 */
export class SelectionOutline {
  readonly group = new THREE.Group();

  private readonly material: THREE.LineBasicMaterial;
  private readonly pool: THREE.LineSegments[] = [];
  private readonly owned = new Set<THREE.BufferGeometry>();
  private tracked: readonly SceneObject[] = [];

  constructor() {
    this.group.name = 'Selection outlines';
    this.group.renderOrder = 999;

    this.material = new THREE.LineBasicMaterial({
      color: OUTLINE_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
  }

  /**
   * Points the outlines at a new selection.
   *
   * Line objects are pooled rather than recreated: selection changes on every
   * click, and allocating a line per click produces avoidable garbage during
   * the most common interaction in the application. The geometry inside them is
   * re-fetched per object, since a selection can mix kinds.
   */
  setSelection(objects: readonly SceneObject[]): void {
    this.tracked = objects;

    while (this.pool.length < objects.length) {
      const line = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
      line.matrixAutoUpdate = false;
      line.frustumCulled = false;
      line.renderOrder = 999;
      this.pool.push(line);
      this.group.add(line);
    }

    objects.forEach((object, index) => {
      const line = this.pool[index];
      const { geometry, owned } = object.createEdges();

      this.release(line.geometry);
      line.geometry = geometry;
      if (owned) this.owned.add(geometry);

      line.visible = true;
    });

    for (let i = objects.length; i < this.pool.length; i += 1) {
      this.pool[i].visible = false;
    }

    this.update();
  }

  /**
   * Syncs outline transforms with their objects.
   *
   * Called every frame because a gizmo drag moves objects without any event the
   * outline could subscribe to, and the cost is one matrix copy per selected
   * object.
   */
  update(): void {
    this.tracked.forEach((object, index) => {
      const line = this.pool[index];
      if (!line) return;
      object.mesh.updateMatrixWorld();
      line.matrix.copy(object.mesh.matrixWorld);
      line.matrixWorldNeedsUpdate = true;
    });
  }

  /** Releases the shared material and any per-object edge geometry held. */
  dispose(): void {
    for (const line of this.pool) this.release(line.geometry);
    this.owned.clear();
    this.material.dispose();
  }

  /** Frees geometry this layer owns; shared geometry is left alone. */
  private release(geometry: THREE.BufferGeometry): void {
    if (!this.owned.has(geometry)) return;
    this.owned.delete(geometry);
    geometry.dispose();
  }
}
