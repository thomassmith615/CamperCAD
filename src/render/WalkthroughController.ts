import * as THREE from 'three';
import type { CameraManager } from '@/core/CameraManager';
import type { ControlsManager } from '@/core/ControlsManager';
import type { VehicleModel } from '@/vehicle/VehicleModel';

/** Default eye height above the floor, in inches — roughly a 5'8" person. */
const DEFAULT_EYE_HEIGHT = 63;

/** Walking speed in inches per second. */
const WALK_SPEED = 55;

/** Multiplier applied while shift is held. */
const SLOW_FACTOR = 0.35;

/** Mouse look sensitivity, radians per pixel. */
const LOOK_SENSITIVITY = 0.0022;

/** How close the camera may get to a wall, in inches. */
const WALL_MARGIN = 6;

/**
 * First-person walkthrough.
 *
 * The single most useful thing this adds is not the view — it is standing at
 * eye height and discovering that the overhead cabinet is exactly where your
 * head goes. An orbit camera looking down into an open box never reveals that,
 * because from above there is always room.
 *
 * The camera is confined to the cabin using the vehicle's own analytic
 * cross-section rather than by colliding with geometry. That was the point of
 * building `narrowestHalfWidth` and `ceilingHeightOver` back with the
 * measurement work: the same functions that tell a cabinet whether it fits tell
 * a walking camera where the wall is, exactly and cheaply.
 *
 * Objects are deliberately *not* collided with. Walking through a cabinet is
 * far less annoying than being unable to get past one while trying to look at
 * the far end, and this is a viewing mode rather than a game.
 */
export class WalkthroughController {
  private readonly cameras: CameraManager;
  private readonly orbit: ControlsManager;
  private readonly canvas: HTMLCanvasElement;

  private readonly keys = new Set<string>();
  private readonly disposers: Array<() => void> = [];

  private vehicle: VehicleModel | null = null;
  private active = false;
  private eyeHeight = DEFAULT_EYE_HEIGHT;

  private yaw = 0;
  private pitch = 0;
  private readonly position = new THREE.Vector3();
  private savedPosition = new THREE.Vector3();
  private savedTarget = new THREE.Vector3();

  constructor(cameras: CameraManager, orbit: ControlsManager, canvas: HTMLCanvasElement) {
    this.cameras = cameras;
    this.orbit = orbit;
    this.canvas = canvas;

    this.bindInput();
  }

  /** True while walkthrough mode is running. */
  get isActive(): boolean {
    return this.active;
  }

  /** Eye height above the floor, in inches. */
  get height(): number {
    return this.eyeHeight;
  }

  /** Sets eye height, so a shorter or taller person can check their own view. */
  setHeight(inches: number): void {
    this.eyeHeight = THREE.MathUtils.clamp(inches, 30, 80);
    if (this.active) this.position.y = this.eyeHeight;
  }

  /** Points the controller at the loaded vehicle. */
  setVehicle(vehicle: VehicleModel | null): void {
    this.vehicle = vehicle;
  }

  /**
   * Enters walkthrough mode.
   *
   * The orbit camera's state is saved so leaving returns the user exactly where
   * they were. Losing your modelling viewpoint every time you take a look
   * around would make the feature something people use once.
   */
  enter(): void {
    if (this.active) return;

    this.savedPosition.copy(this.cameras.camera.position);
    this.savedTarget.copy(this.cameras.target);

    this.cameras.setProjection('perspective');
    this.orbit.suspend('walkthrough');

    // Start near the rear doors looking forward, which is how you enter a van.
    const startZ = this.vehicle ? this.vehicle.rearZ - 18 : 60;
    this.position.set(0, this.eyeHeight, startZ);
    this.yaw = Math.PI;
    this.pitch = 0;

    this.active = true;
    this.applyCamera();
    void this.canvas.requestPointerLock?.();
  }

  /** Leaves walkthrough mode and restores the previous viewpoint. */
  exit(): void {
    if (!this.active) return;

    this.active = false;
    this.keys.clear();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();

    this.cameras.target.copy(this.savedTarget);
    this.cameras.camera.position.copy(this.savedPosition);
    this.cameras.camera.up.set(0, 1, 0);
    this.cameras.camera.lookAt(this.cameras.target);
    this.orbit.resume('walkthrough');
  }

  /**
   * Advances the walk.
   *
   * @param delta Seconds since the previous frame.
   * @returns True while the mode is active, so the caller knows the camera is
   * under this controller's authority rather than the orbit controls'.
   */
  update(delta: number): boolean {
    if (!this.active) return false;

    const speed = WALK_SPEED * delta * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? SLOW_FACTOR : 1);

    // Movement is horizontal regardless of where the camera is pointed: looking
    // at the ceiling should not fly you into it.
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.sub(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      this.position.add(move);
      this.constrainToCabin();
    }

    this.position.y = this.eyeHeight;
    this.applyCamera();
    return true;
  }

  /** Detaches every listener. */
  dispose(): void {
    this.exit();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }

  /**
   * Keeps the camera inside the van.
   *
   * Width is checked at eye height rather than at the floor, so the walls close
   * in around your shoulders the way they actually do — which is the honest
   * answer to "can I stand next to the bed".
   */
  private constrainToCabin(): void {
    const vehicle = this.vehicle;
    if (!vehicle) return;

    const halfWidth = vehicle.narrowestHalfWidth(this.eyeHeight - 12, this.eyeHeight) - WALL_MARGIN;
    if (halfWidth > 0) {
      this.position.x = THREE.MathUtils.clamp(this.position.x, -halfWidth, halfWidth);
    }

    this.position.z = THREE.MathUtils.clamp(
      this.position.z,
      vehicle.frontZ + WALL_MARGIN,
      vehicle.rearZ - WALL_MARGIN,
    );
  }

  /** Writes the controller's state onto the active camera. */
  private applyCamera(): void {
    const camera = this.cameras.camera;
    camera.position.copy(this.position);
    camera.up.set(0, 1, 0);

    const look = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );

    this.cameras.target.copy(this.position).add(look.multiplyScalar(48));
    camera.lookAt(this.cameras.target);
  }

  /** Wires pointer lock, mouse look and the movement keys. */
  private bindInput(): void {
    const onMouseMove = (event: MouseEvent) => {
      if (!this.active || document.pointerLockElement !== this.canvas) return;

      this.yaw -= event.movementX * LOOK_SENSITIVITY;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - event.movementY * LOOK_SENSITIVITY,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05,
      );
      this.applyCamera();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!this.active) return;
      if (event.code === 'Escape') {
        this.exit();
        return;
      }
      this.keys.add(event.code);
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      this.keys.delete(event.code);
    };

    // Losing pointer lock — by pressing Escape, or by the window blurring — is
    // the user's way out. Treat it as leaving rather than as a stuck state.
    const onLockChange = () => {
      if (this.active && document.pointerLockElement !== this.canvas) this.exit();
    };

    const onClick = () => {
      if (this.active && document.pointerLockElement !== this.canvas) {
        void this.canvas.requestPointerLock?.();
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('pointerlockchange', onLockChange);
    this.canvas.addEventListener('click', onClick);

    this.disposers.push(
      () => document.removeEventListener('mousemove', onMouseMove),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => document.removeEventListener('pointerlockchange', onLockChange),
      () => this.canvas.removeEventListener('click', onClick),
    );
  }
}
