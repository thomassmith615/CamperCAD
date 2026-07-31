import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraManager } from './CameraManager';

/**
 * Wraps `OrbitControls` and keeps them bound to whichever camera is active.
 *
 * `OrbitControls` cannot change camera after construction, so switching between
 * perspective and orthographic requires a fresh instance. This class hides that:
 * callers ask for a camera change and all tuning, the shared orbit target and
 * the user-interaction callback are reapplied automatically.
 */
export class ControlsManager {
  private controls: OrbitControls;
  private readonly canvas: HTMLElement;
  private readonly cameras: CameraManager;
  private readonly interactionHandlers = new Set<() => void>();
  private boundCamera: THREE.Camera;
  private dragging = false;

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

  /** True while the user is dragging; suppresses click-through selection. */
  get isDragging(): boolean {
    return this.dragging;
  }

  /** Enables or disables user input, e.g. during a camera tween. */
  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
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

    controls.addEventListener('start', () => {
      this.dragging = true;
      for (const handler of this.interactionHandlers) handler();
    });
    controls.addEventListener('end', () => {
      this.dragging = false;
    });

    return controls;
  }

  /** Recreates the controls for a new camera, preserving enabled state. */
  private rebind(camera: THREE.Camera): void {
    const wasEnabled = this.controls.enabled;
    this.controls.dispose();
    this.controls = this.createControls(camera);
    this.controls.enabled = wasEnabled;
    this.boundCamera = camera;
  }
}
