import * as THREE from 'three';
import type { CameraManager } from '@/core/CameraManager';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { SelectionManager, SelectionMode } from '@/selection/SelectionManager';
import type { TransformGizmo } from '@/selection/TransformGizmo';
import type { InputSettings } from '@/input/InputSettings';
import type { ControlsManager } from '@/core/ControlsManager';
import type { Tool, ToolId } from './ToolTypes';

/** Pixels of movement before a press is treated as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/**
 * The default tool: picking and marquee selection.
 *
 * What a left drag does depends on the input mode. With a mouse it marquees,
 * because the middle button is free to orbit. With a trackpad a plain drag
 * orbits — there is no middle button to give it to — and a marquee requires
 * Shift or Ctrl/Cmd. A click that does not move picks in both modes, so tapping
 * an object never depends on which mode is active.
 *
 * Marquee selection tests projected bounds rather than object centres, so a
 * long cabinet is caught by a band that crosses any part of it — the behaviour
 * of a "touch" marquee, which suits laying out a van interior better than
 * requiring full containment.
 */
export class SelectTool implements Tool {
  readonly id: ToolId = 'select';
  readonly label = 'Select';
  readonly cursor = 'default';

  private readonly cameras: CameraManager;
  private readonly store: ObjectStore;
  private readonly selection: SelectionManager;
  private readonly gizmo: TransformGizmo;
  private readonly canvas: HTMLCanvasElement;
  private readonly input: InputSettings;
  private readonly orbit: ControlsManager;
  private readonly marquee: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();

  private startX = 0;
  private startY = 0;
  private dragging = false;
  private pressed = false;
  private marqueeAllowed = true;

  /**
   * @param host Viewport element the rubber band is drawn into. It must be a
   * positioned ancestor of the canvas.
   */
  constructor(
    host: HTMLElement,
    canvas: HTMLCanvasElement,
    cameras: CameraManager,
    store: ObjectStore,
    selection: SelectionManager,
    gizmo: TransformGizmo,
    input: InputSettings,
    orbit: ControlsManager,
  ) {
    this.input = input;
    this.orbit = orbit;
    this.canvas = canvas;
    this.cameras = cameras;
    this.store = store;
    this.selection = selection;
    this.gizmo = gizmo;

    this.marquee = document.createElement('div');
    this.marquee.className = 'marquee';
    this.marquee.hidden = true;
    host.append(this.marquee);
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.gizmo.isEngaged) return;

    this.pressed = true;
    this.dragging = false;
    this.marqueeAllowed = this.input.allowsMarquee({
      shift: event.shiftKey,
      accel: event.ctrlKey || event.metaKey,
      space: this.orbit.isSpaceHeld,
    });
    this.startX = event.clientX;
    this.startY = event.clientY;
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.pressed) return;

    if (!this.dragging) {
      const travelled = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
      if (travelled < DRAG_THRESHOLD) return;

      // In trackpad mode a plain drag belongs to the camera, so the press is
      // abandoned rather than turned into a marquee or, worse, a stray pick on
      // release.
      if (!this.marqueeAllowed) {
        this.pressed = false;
        return;
      }

      this.dragging = true;
      this.marquee.hidden = false;
      // A modifier-drag marquee in trackpad mode would otherwise orbit
      // underneath the rubber band.
      this.orbit.suspend('marquee');
    }

    const rect = this.canvas.getBoundingClientRect();
    const left = Math.min(this.startX, event.clientX) - rect.left;
    const top = Math.min(this.startY, event.clientY) - rect.top;

    this.marquee.style.left = `${left}px`;
    this.marquee.style.top = `${top}px`;
    this.marquee.style.width = `${Math.abs(event.clientX - this.startX)}px`;
    this.marquee.style.height = `${Math.abs(event.clientY - this.startY)}px`;
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.pressed) return;
    this.pressed = false;

    const mode = SelectTool.modeFor(event);

    if (this.dragging) {
      this.marquee.hidden = true;
      this.dragging = false;
      this.orbit.resume('marquee');
      this.selection.select(this.objectsInBand(event), mode);
      return;
    }

    const picked = this.pick(event);
    this.selection.select(picked ? [picked] : [], picked ? mode : 'replace');
  }

  onCancel(): void {
    this.pressed = false;
    this.dragging = false;
    this.marqueeAllowed = true;
    this.marquee.hidden = true;
  }

  deactivate(): void {
    this.onCancel();
  }

  /** Modifier keys decide how a pick combines with the existing selection. */
  private static modeFor(event: PointerEvent): SelectionMode {
    if (event.shiftKey) return 'add';
    if (event.ctrlKey || event.metaKey) return 'toggle';
    return 'replace';
  }

  /** Converts a client position into normalised device coordinates. */
  private toNdc(clientX: number, clientY: number, target: THREE.Vector2): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return target.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  /** Raycasts the design layer, returning the frontmost object hit. */
  private pick(event: PointerEvent): SceneObject | null {
    const ndc = this.toNdc(event.clientX, event.clientY, new THREE.Vector2());
    this.raycaster.setFromCamera(ndc, this.cameras.camera);

    const hits = this.raycaster.intersectObjects(this.store.pickables(), false);
    return hits.length > 0 ? this.store.fromObject3D(hits[0].object) : null;
  }

  /**
   * Finds every object whose projected bounds overlap the rubber band.
   *
   * All eight corners are projected rather than the centre, so an object is
   * caught when any part of it falls inside the band even if its centre does
   * not — the difference matters for the long, thin geometry a van build is
   * full of.
   */
  private objectsInBand(event: PointerEvent): SceneObject[] {
    const start = this.toNdc(this.startX, this.startY, new THREE.Vector2());
    const end = this.toNdc(event.clientX, event.clientY, new THREE.Vector2());

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    const camera = this.cameras.camera;
    const corner = new THREE.Vector3();

    return this.store.all().filter((object) => {
      if (!object.mesh.visible) return false;
      const box = object.boundingBox();

      let objMinX = Infinity;
      let objMaxX = -Infinity;
      let objMinY = Infinity;
      let objMaxY = -Infinity;

      for (let i = 0; i < 8; i += 1) {
        corner.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        );
        corner.project(camera);
        objMinX = Math.min(objMinX, corner.x);
        objMaxX = Math.max(objMaxX, corner.x);
        objMinY = Math.min(objMinY, corner.y);
        objMaxY = Math.max(objMaxY, corner.y);
      }

      return objMaxX >= minX && objMinX <= maxX && objMaxY >= minY && objMinY <= maxY;
    });
  }
}
