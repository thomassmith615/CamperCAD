import * as THREE from 'three';
import type { SceneObject } from '@/objects/SceneObject';

/** Outline colour: the accent reserved for things the user owns. */
const OUTLINE_COLOR = 0xe2a44a;

/**
 * Edge geometry matching the shared unit box, including its bottom-face origin.
 * Every outline reuses it and is positioned by copying the object's matrix.
 */
const UNIT_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));

/**
 * Draws outlines around selected objects.
 *
 * Edges of the object's own box are used rather than an axis-aligned bounding
 * box helper. For a cabinet rotated to follow the van's sidewall those differ
 * substantially, and a loose box floating around a rotated object reads as a
 * bug. Copying the object's world matrix onto the outline makes it exact for
 * free.
 *
 * Outlines are drawn with depth testing off so a selected object stays visible
 * behind the van shell, which is the situation the user is usually in.
 */
export class SelectionOutline {
  readonly group = new THREE.Group();

  private readonly material: THREE.LineBasicMaterial;
  private readonly pool: THREE.LineSegments[] = [];
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
   * click, and allocating geometry per click produces avoidable garbage during
   * the most common interaction in the application.
   */
  setSelection(objects: readonly SceneObject[]): void {
    this.tracked = objects;

    while (this.pool.length < objects.length) {
      const line = new THREE.LineSegments(UNIT_EDGES, this.material);
      line.matrixAutoUpdate = false;
      line.frustumCulled = false;
      line.renderOrder = 999;
      this.pool.push(line);
      this.group.add(line);
    }

    this.pool.forEach((line, index) => {
      line.visible = index < objects.length;
    });

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

  /** Releases the shared material. Edge geometry is module-level and persists. */
  dispose(): void {
    this.material.dispose();
  }
}
