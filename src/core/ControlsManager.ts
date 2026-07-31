import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraManager } from './CameraManager';

/**
 * OrbitControls treats an unrecognised mouse-button action as "do nothing" for
 * that button. This is how the left button is freed for selection.
 */
const NO_MOUSE_ACTION = -1 as unknown as THREE.MOUSE;

/**
 * Wraps `OrbitControls` and keeps them bound to whichever camera is active.
 *
 * `OrbitControls` cannot change camera after construction, so switching between
 * perspective and orthographic requires a fresh instance. This class hides that:
 * callers ask for a camera change and all tuning, the shared orbit target and
 * the user-interaction callback are reapplied automatically.
 *
 * ## Mouse mapping
 *
 * The left button does not orbit. It belongs to selection, which is the action
 * performed most often, so orbiting moves to the middle button and panning to
 * the right. Holding space restores left-drag orbit for trackpad users with no
 * middle button.
 *
 * ## Suspension
 *
 * Several subsystems need to stop the camera moving — a view tween, a gizmo
 * drag, a marquee. A single boolean would let whichever finished first re-enable
 * the camera underneath the others, so suspensions are held by name and the
 * camera resumes only when every one has been released.
 */
export class ControlsManager {
  private controls: OrbitControls;
  private readonly canvas: HTMLElement;
  private readonly cameras: CameraManager;
  private readonly interactionHandlers = new Set<() => void>();
  private readonly suspensions = new Set<string>();
  private boundCamera: THREE.Camera;
  private dragging = false;
  private orbitOnLeft = false;

  constructor(cameras: CameraManager, canvas: HTMLElement) {
    this.cameras = cameras;
    this.canvas = canvas;
    this.boundCamera = cameras.camera;
    this.controls = this.createControls(cameras.camera);
  }

  /**
   * Registers a callback fired when the user orbits, pans or zooms by hand.
   * Used to drop the active view preset highlight.
   *
   * @returns An unsubscribe function.
   */
  onUserInteract(handler: () => void): () => void {
    this.interactionHandlers.add(handler);
    return () => this.interactionHandlers.delete(handler);
  }

  /** True while the user is dragging the camera. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** True when at least one subsystem is holding the camera still. */
  get isSuspended(): boolean {
    return this.suspensions.size > 0;
  }

  /**
   * Stops camera input on behalf of `reason` until the matching
   * {@link resume}. Repeated suspensions under the same reason are idempotent.
   */
  suspend(reason: string): void {
    this.suspensions.add(reason);
    this.applyEnabled();
  }

  /** Releases a suspension. The camera resumes when none remain. */
  resume(reason: string): void {
    this.suspensions.delete(reason);
    this.applyEnabled();
  }

  /**
   * Temporarily maps orbit onto the left button, for users holding space.
   *
   * Applied to the live controls rather than by rebuilding them, so the change
   * takes effect between gestures without disturbing camera state.
   */
  setOrbitOnLeft(enabled: boolean): void {
    if (enabled === this.orbitOnLeft) return;
    this.orbitOnLeft = enabled;
    this.controls.mouseButtons.LEFT = enabled ? THREE.MOUSE.ROTATE : NO_MOUSE_ACTION;
  }

  /** Applies damping and keeps the controls bound to the active camera. */
  update(): void {
    if (this.cameras.camera !== this.boundCamera) {
      this.rebind(this.cameras.camera);
    }
    this.controls.update();
  }

  /** Detaches listeners and releases the controls. */
  dispose(): void {
    this.controls.dispose();
    this.interactionHandlers.clear();
  }

  /** Builds a controls instance with CamperCAD's tuning applied. */
  private createControls(camera: THREE.Camera): OrbitControls {
    const controls = new OrbitControls(camera, this.canvas);

    // Share the camera manager's target instance so framing, presets and
    // orbiting all read and write the same point.
    controls.target = this.cameras.target;

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.9;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 12;
    controls.maxDistance = 2400;
    controls.maxPolarAngle = Math.PI * 0.98;

    controls.mouseButtons = {
      LEFT: this.orbitOnLeft ? THREE.MOUSE.ROTATE : NO_MOUSE_ACTION,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };

    controls.addEventListener('start', () => {
      this.dragging = true;
      for (const handler of this.interactionHandlers) handler();
    });
    controls.addEventListener('end', () => {
      this.dragging = false;
    });

    return controls;
  }

  /** Recreates the controls for a new camera, preserving suspension state. */
  private rebind(camera: THREE.Camera): void {
    this.controls.dispose();
    this.controls = this.createControls(camera);
    this.boundCamera = camera;
    this.applyEnabled();
  }

  /** Enables input only when nothing is holding a suspension. */
  private applyEnabled(): void {
    this.controls.enabled = this.suspensions.size === 0;
  }
}
