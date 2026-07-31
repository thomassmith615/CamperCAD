import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CameraManager } from './CameraManager';
import { InputSettings } from '@/input/InputSettings';

/**
 * OrbitControls treats an unrecognised mouse-button action as "do nothing" for
 * that button. This is how a button is freed for the selection tool.
 */
const NO_MOUSE_ACTION = -1 as unknown as THREE.MOUSE;

/** Pan sensitivity for two-finger trackpad scrolling, in inches per pixel. */
const SCROLL_PAN_SCALE = 0.55;

/** Zoom sensitivity for pinch gestures. */
const PINCH_ZOOM_SCALE = 0.012;

/**
 * Wraps `OrbitControls` and keeps them bound to whichever camera is active.
 *
 * `OrbitControls` cannot change camera after construction, so switching between
 * perspective and orthographic requires a fresh instance. This class hides that:
 * callers ask for a camera change and all tuning, the shared orbit target and
 * the user-interaction callback are reapplied automatically.
 *
 * ## Two input mappings
 *
 * The button map is rebuilt from {@link InputSettings} whenever the mode
 * changes. In mouse mode the left button belongs to selection and orbiting
 * lives on the middle button; in trackpad mode a plain left drag orbits,
 * because a trackpad has no middle button and a plain drag is the only
 * comfortable gesture it has.
 *
 * Two-finger scrolling and pinching are handled here rather than by
 * `OrbitControls`, which maps every wheel event to zoom. On a trackpad that is
 * wrong twice over: two-finger scroll is the pan gesture users expect, and
 * pinch — which the browser delivers as a Ctrl-modified wheel — is the zoom.
 *
 * ## Suspension
 *
 * Several subsystems need to stop the camera moving: a view tween, a gizmo
 * drag, a marquee. A single boolean would let whichever finished first
 * re-enable the camera underneath the others, so suspensions are held by name
 * and the camera resumes only when every one has been released.
 */
export class ControlsManager {
  private controls: OrbitControls;
  private readonly canvas: HTMLElement;
  private readonly cameras: CameraManager;
  private readonly input: InputSettings;
  private readonly interactionHandlers = new Set<() => void>();
  private readonly suspensions = new Set<string>();
  private readonly disposers: Array<() => void> = [];

  private boundCamera: THREE.Camera;
  private dragging = false;
  private spaceHeld = false;

  constructor(cameras: CameraManager, canvas: HTMLElement, input: InputSettings) {
    this.cameras = cameras;
    this.canvas = canvas;
    this.input = input;
    this.boundCamera = cameras.camera;
    this.controls = this.createControls(cameras.camera);

    this.disposers.push(input.onChange(() => this.applyButtonMap()));
    this.bindWheel();
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

  /** True while the space bar is held. */
  get isSpaceHeld(): boolean {
    return this.spaceHeld;
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
   * Records the space bar state and remaps the left button accordingly.
   *
   * Space is the escape hatch that makes both modes workable on either device:
   * in mouse mode it borrows the left button for orbiting, and in trackpad mode
   * it borrows it for panning, which is the gesture a trackpad otherwise has to
   * reach for two fingers to get.
   */
  setSpaceHeld(held: boolean): void {
    if (held === this.spaceHeld) return;
    this.spaceHeld = held;
    this.applyButtonMap();
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
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
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

    // Wheel handling is done by this class so scroll can pan on a trackpad.
    controls.enableZoom = false;

    controls.addEventListener('start', () => {
      this.dragging = true;
      this.notifyInteraction();
    });
    controls.addEventListener('end', () => {
      this.dragging = false;
    });

    this.applyButtonMap(controls);
    return controls;
  }

  /**
   * Rebuilds the mouse button map for the current mode and space state.
   *
   * @param target Controls to configure. Defaults to the live instance, which
   * is not yet assigned while called from the constructor.
   */
  private applyButtonMap(target?: OrbitControls): void {
    const controls = target ?? this.controls;
    if (!controls) return;

    const trackpad = this.input.current === 'trackpad';

    let left: THREE.MOUSE = NO_MOUSE_ACTION;
    if (this.spaceHeld) left = trackpad ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    else if (trackpad) left = THREE.MOUSE.ROTATE;

    controls.mouseButtons = {
      LEFT: left,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };
  }

  /**
   * Handles wheel input directly.
   *
   * In mouse mode the wheel zooms, as it always has. In trackpad mode a
   * two-finger scroll pans in the camera's own screen plane and a pinch zooms.
   * Panning is applied by moving the camera and its target together, which is
   * what `screenSpacePanning` does internally and keeps the orbit centre
   * correct.
   */
  private bindWheel(): void {
    const onWheel = (event: WheelEvent) => {
      if (this.suspensions.size > 0) return;

      const detected = InputSettings.classifyWheel(event);
      if (detected) this.input.suggestMode(detected);

      event.preventDefault();
      this.notifyInteraction();

      const pinching = event.ctrlKey;
      const trackpad = this.input.current === 'trackpad';

      if (trackpad && !pinching) this.panByScroll(event.deltaX, event.deltaY);
      else this.zoomBy(pinching ? event.deltaY * PINCH_ZOOM_SCALE : Math.sign(event.deltaY) * 0.12);
    };

    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.disposers.push(() => this.canvas.removeEventListener('wheel', onWheel));
  }

  /** Slides the camera and its target across the view plane. */
  private panByScroll(deltaX: number, deltaY: number): void {
    const camera = this.cameras.camera;
    const distance = camera.position.distanceTo(this.cameras.target);
    const scale = (SCROLL_PAN_SCALE * Math.max(distance, 1)) / 400;

    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);

    const offset = right.multiplyScalar(deltaX * scale).add(up.multiplyScalar(-deltaY * scale));
    camera.position.add(offset);
    this.cameras.target.add(offset);
  }

  /**
   * Moves the camera along its view axis, or adjusts orthographic zoom.
   *
   * @param amount Positive zooms out, negative zooms in.
   */
  private zoomBy(amount: number): void {
    const camera = this.cameras.camera;

    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (1 - amount), 0.02, 60);
      camera.updateProjectionMatrix();
      return;
    }

    const offset = camera.position.clone().sub(this.cameras.target);
    const distance = THREE.MathUtils.clamp(offset.length() * (1 + amount), 12, 2400);
    camera.position.copy(this.cameras.target).addScaledVector(offset.normalize(), distance);
  }

  /** Tells listeners the user moved the camera by hand. */
  private notifyInteraction(): void {
    for (const handler of this.interactionHandlers) handler();
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
