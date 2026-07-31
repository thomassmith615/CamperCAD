import * as THREE from 'three';
import type { CameraManager } from '@/core/CameraManager';
import type { SceneManager } from '@/core/SceneManager';
import type { GridManager } from '@/scene/GridManager';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { EventBus } from '@/core/EventBus';
import type { AppEvents } from '@/core/AppEvents';
import { formatLength, type DisplayUnit } from '@/math/Units';
import type { ScreenLabel } from '@/ui/ScreenLabels';
import type { Tool, ToolId } from './ToolTypes';

/** Instrument cyan. */
const MEASURE_COLOR = 0x4fd0d8;

/** Pointer distance in pixels within which a candidate point is captured. */
const PICK_RADIUS_PX = 14;

/**
 * Measures the distance between two points.
 *
 * Points snap to the corners and face centres of existing objects, then fall
 * back to the floor plane rounded to the grid. Snapping the endpoints is what
 * makes the tool trustworthy: a measurement taken by eye between two roughly
 * placed points tells the user nothing they can cut plywood from.
 *
 * The readout gives the direct distance and the three axis components, because
 * a van build needs both — the diagonal to check a panel will pass through the
 * side door, and the components to lay out a cut.
 */
export class MeasureTool implements Tool {
  readonly id: ToolId = 'measure';
  readonly label = 'Measure';
  readonly cursor = 'crosshair';

  readonly group = new THREE.Group();

  private readonly canvas: HTMLCanvasElement;
  private readonly cameras: CameraManager;
  private readonly grid: GridManager;
  private readonly store: ObjectStore;
  private readonly bus: EventBus<AppEvents>;

  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly line: THREE.Line;
  private readonly marker: THREE.Mesh;

  private from: THREE.Vector3 | null = null;
  private to: THREE.Vector3 | null = null;
  private hover: THREE.Vector3 | null = null;
  private labels: ScreenLabel[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    scene: SceneManager,
    cameras: CameraManager,
    grid: GridManager,
    store: ObjectStore,
    bus: EventBus<AppEvents>,
  ) {
    this.canvas = canvas;
    this.cameras = cameras;
    this.grid = grid;
    this.store = store;
    this.bus = bus;

    this.group.name = 'Measurement';
    this.group.renderOrder = 997;
    this.group.visible = false;

    const material = new THREE.LineBasicMaterial({
      color: MEASURE_COLOR,
      depthTest: false,
      transparent: true,
    });
    this.line = new THREE.Line(new THREE.BufferGeometry(), material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 997;

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 12, 8),
      new THREE.MeshBasicMaterial({ color: MEASURE_COLOR, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.marker.renderOrder = 997;
    this.marker.visible = false;

    this.group.add(this.line, this.marker);
    scene.helperGroup.add(this.group);
  }

  /** Labels for this frame, consumed by the screen label layer. */
  get screenLabels(): readonly ScreenLabel[] {
    return this.labels;
  }

  activate(): void {
    this.group.visible = true;
  }

  deactivate(): void {
    this.reset();
    this.group.visible = false;
  }

  onPointerMove(event: PointerEvent): void {
    this.hover = this.candidateAt(event);
    this.marker.visible = this.hover !== null && this.to === null;
    if (this.hover) this.marker.position.copy(this.hover);
  }

  onPointerUp(event: PointerEvent): void {
    if (event.button !== 0) return;

    const point = this.candidateAt(event);
    if (!point) return;

    if (this.from && this.to) {
      this.reset();
      this.from = point;
      return;
    }

    if (!this.from) this.from = point;
    else this.to = point;

    this.emit();
  }

  onCancel(): void {
    this.reset();
    this.emit();
  }

  /**
   * Rebuilds the measurement line and its label.
   *
   * @param unit Unit the readout is formatted in.
   */
  update(unit: DisplayUnit): void {
    this.labels = [];

    const end = this.to ?? this.hover;
    if (!this.from || !end) {
      this.line.visible = false;
      return;
    }

    this.line.visible = true;
    this.line.geometry.setFromPoints([this.from, end]);
    this.line.geometry.computeBoundingSphere();

    const span = end.clone().sub(this.from);
    this.labels.push({
      text: formatLength(span.length(), unit),
      position: this.from.clone().lerp(end, 0.5),
      variant: 'screen-label--measure',
    });
  }

  /** Clears both endpoints. */
  private reset(): void {
    this.from = null;
    this.to = null;
    this.hover = null;
    this.line.visible = false;
    this.marker.visible = false;
    this.labels = [];
  }

  /** Publishes the current measurement for the status bar. */
  private emit(): void {
    if (!this.from || !this.to) {
      this.bus.emit('measure:changed', { measurement: null });
      return;
    }

    const span = this.to.clone().sub(this.from);
    this.bus.emit('measure:changed', {
      measurement: {
        distance: span.length(),
        dx: Math.abs(span.x),
        dy: Math.abs(span.y),
        dz: Math.abs(span.z),
      },
    });
  }

  /**
   * Finds the point under the pointer.
   *
   * Object features are tested first in screen space, so a corner within a few
   * pixels wins even when the pointer is technically over a face. Failing that,
   * the ray meets the floor and is rounded to the grid.
   */
  private candidateAt(event: PointerEvent): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    const camera = this.cameras.camera;
    let best: THREE.Vector3 | null = null;
    let bestDistance = PICK_RADIUS_PX;

    for (const point of this.featurePoints()) {
      const projected = point.clone().project(camera);
      if (projected.z < -1 || projected.z > 1) continue;

      const screenX = ((projected.x + 1) / 2) * rect.width;
      const screenY = ((1 - projected.y) / 2) * rect.height;
      const distance = Math.hypot(screenX - pointerX, screenY - pointerY);

      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }

    if (best) return best;

    const ndc = new THREE.Vector2((pointerX / rect.width) * 2 - 1, -(pointerY / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, camera);

    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.floor, hit)) return null;

    const step = this.grid.spacing;
    hit.x = Math.round(hit.x / step) * step;
    hit.z = Math.round(hit.z / step) * step;
    hit.y = 0;
    return hit;
  }

  /** Every corner and face centre of every visible object. */
  private featurePoints(): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];

    for (const object of this.store.all()) {
      if (!object.mesh.visible) continue;
      const box = object.boundingBox();

      for (let i = 0; i < 8; i += 1) {
        points.push(
          new THREE.Vector3(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          ),
        );
      }

      const centre = box.getCenter(new THREE.Vector3());
      points.push(
        new THREE.Vector3(box.min.x, centre.y, centre.z),
        new THREE.Vector3(box.max.x, centre.y, centre.z),
        new THREE.Vector3(centre.x, box.min.y, centre.z),
        new THREE.Vector3(centre.x, box.max.y, centre.z),
        new THREE.Vector3(centre.x, centre.y, box.min.z),
        new THREE.Vector3(centre.x, centre.y, box.max.z),
      );
    }

    return points;
  }
}
