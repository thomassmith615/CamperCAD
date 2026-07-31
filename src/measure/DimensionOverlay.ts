import * as THREE from 'three';
import type { SceneObject } from '@/objects/SceneObject';
import { formatLength, type DisplayUnit } from '@/math/Units';
import type { ScreenLabel } from '@/ui/ScreenLabels';

/** Instrument cyan, matching every other measurement in the application. */
const DIMENSION_COLOR = 0x4fd0d8;

/** How far dimension lines stand off the object, in inches. */
const OFFSET = 4;

/** Length of the tick marks at each end of a dimension line, in inches. */
const TICK = 2;

/**
 * Draws width, depth and height dimensions around the selected object.
 *
 * Lines are rebuilt in world space each frame from the object's eight
 * transformed corners rather than being drawn in local space and scaled with
 * the object. Local-space lines would inherit the object's non-uniform scale,
 * so a 60 × 12 × 20 cabinet would show tick marks five times longer on one axis
 * than another — the geometry would be correct and the drawing would look
 * broken.
 *
 * The dimensions reported are the object's own width, height and depth, not its
 * axis-aligned bounding box, so a cabinet rotated to follow the sidewall still
 * reads its true size.
 */
export class DimensionOverlay {
  readonly group = new THREE.Group();

  private readonly material: THREE.LineBasicMaterial;
  private readonly lines: THREE.LineSegments;
  private readonly positions: number[] = [];
  private target: SceneObject | null = null;
  private labels: ScreenLabel[] = [];

  constructor() {
    this.group.name = 'Dimensions';
    this.group.renderOrder = 997;
    this.group.visible = false;

    this.material = new THREE.LineBasicMaterial({
      color: DIMENSION_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });

    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 997;
    this.group.add(this.lines);
  }

  /** Labels for this frame, consumed by the screen label layer. */
  get screenLabels(): readonly ScreenLabel[] {
    return this.labels;
  }

  /** Points the overlay at an object, or hides it. */
  setTarget(object: SceneObject | null): void {
    this.target = object;
    this.group.visible = object !== null;
    if (!object) this.labels = [];
  }

  /**
   * Rebuilds the dimension geometry.
   *
   * @param unit Unit the labels are formatted in.
   */
  update(unit: DisplayUnit): void {
    const object = this.target;
    if (!object) return;

    object.mesh.updateMatrixWorld();
    const matrix = object.mesh.matrixWorld;

    // Local corners of the unit box, whose origin is the bottom face centre.
    const corner = (x: number, y: number, z: number) =>
      new THREE.Vector3(x, y, z).applyMatrix4(matrix);

    const originBottom = corner(-0.5, 0, 0.5);
    const widthEnd = corner(0.5, 0, 0.5);
    const depthEnd = corner(0.5, 0, -0.5);
    const heightEnd = corner(0.5, 1, 0.5);

    // Outward directions in world space, derived from the object's own axes so
    // the offsets follow its rotation.
    const right = new THREE.Vector3(1, 0, 0).transformDirection(matrix);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(matrix);

    this.positions.length = 0;
    this.labels = [];

    this.addDimension(originBottom, widthEnd, forward, up, formatLength(object.get('width'), unit));
    this.addDimension(depthEnd, widthEnd, right, up, formatLength(object.get('depth'), unit));
    this.addDimension(widthEnd, heightEnd, right, forward, formatLength(object.get('height'), unit));

    const geometry = this.lines.geometry;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.computeBoundingSphere();
  }

  /** Releases geometry and the shared material. */
  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
  }

  /**
   * Emits one dimension: an offset measuring line with a tick at each end.
   *
   * @param from Start corner on the object.
   * @param to End corner on the object.
   * @param offsetDir Direction to push the line away from the object.
   * @param tickDir Direction the end ticks run along.
   * @param text Label placed at the midpoint.
   */
  private addDimension(
    from: THREE.Vector3,
    to: THREE.Vector3,
    offsetDir: THREE.Vector3,
    tickDir: THREE.Vector3,
    text: string,
  ): void {
    const shift = offsetDir.clone().multiplyScalar(OFFSET);
    const start = from.clone().add(shift);
    const end = to.clone().add(shift);
    const tick = tickDir.clone().multiplyScalar(TICK / 2);

    const push = (point: THREE.Vector3) => this.positions.push(point.x, point.y, point.z);

    // Measuring line.
    push(start);
    push(end);

    // Extension lines back to the object.
    push(from);
    push(start);
    push(to);
    push(end);

    // End ticks.
    push(start.clone().sub(tick));
    push(start.clone().add(tick));
    push(end.clone().sub(tick));
    push(end.clone().add(tick));

    this.labels.push({
      text,
      position: start.clone().lerp(end, 0.5).add(offsetDir.clone().multiplyScalar(1.5)),
      variant: 'screen-label--measure',
    });
  }
}
