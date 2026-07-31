import * as THREE from 'three';

/** Named viewpoints available from the toolbar and viewport corner control. */
export type ViewPreset = 'iso' | 'top' | 'front' | 'rear' | 'left' | 'right';

/** Projection modes. Axis-aligned views default to orthographic. */
export type ProjectionMode = 'perspective' | 'orthographic';

/**
 * Direction from the look-at target toward the camera, plus the up vector, for
 * each named view.
 *
 * The vehicle is modelled with +X toward the passenger (right) side, +Y up and
 * +Z toward the rear doors, so "front" looks at the cab end from outside the
 * van. Top view uses -Z as screen-up so the van's nose points up the screen,
 * which is how conversion layouts are conventionally drawn.
 */
const VIEW_VECTORS: Record<ViewPreset, { dir: THREE.Vector3; up: THREE.Vector3 }> = {
  iso: { dir: new THREE.Vector3(0.85, 0.62, 1.0).normalize(), up: new THREE.Vector3(0, 1, 0) },
  top: { dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) },
  front: { dir: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  rear: { dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  left: { dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  right: { dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
};

/** In-flight camera move. */
interface Tween {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromUp: THREE.Vector3;
  toUp: THREE.Vector3;
  elapsed: number;
  duration: number;
}

/** Cubic ease used for every camera move, matching the UI's motion feel. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Owns both cameras and the shared orbit target.
 *
 * A single `target` vector instance is exposed and handed directly to
 * `OrbitControls`, so orbiting, framing and view presets all operate on the
 * same state without synchronisation code. Switching projection preserves the
 * apparent framing: the orthographic frustum is derived from the perspective
 * camera's distance and field of view, and vice versa.
 */
export class CameraManager {
  /** Shared look-at point, in inches. Mutated by controls and by framing. */
  readonly target = new THREE.Vector3();

  readonly perspectiveCamera: THREE.PerspectiveCamera;
  readonly orthographicCamera: THREE.OrthographicCamera;

  private mode: ProjectionMode = 'perspective';
  private preset: ViewPreset | null = 'iso';
  private aspect = 1;
  private tween: Tween | null = null;

  /** Fallback framing radius (inches) used before a vehicle is loaded. */
  private contentRadius = 120;

  constructor(aspect: number) {
    this.aspect = aspect;

    this.perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 1, 4000);
    this.perspectiveCamera.position.set(220, 150, 260);

    this.orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 4000);
    this.orthographicCamera.position.copy(this.perspectiveCamera.position);

    this.syncOrthographicFrustum();
  }

  /** The camera that should be rendered and driven by controls right now. */
  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.mode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;
  }

  /** Current projection mode. */
  get projection(): ProjectionMode {
    return this.mode;
  }

  /** Active named view, or null once the user has orbited freely. */
  get activePreset(): ViewPreset | null {
    return this.preset;
  }

  /** True while a preset transition is playing; controls are disabled then. */
  get isAnimating(): boolean {
    return this.tween !== null;
  }

  /** Updates both cameras for a new viewport aspect ratio. */
  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    this.syncOrthographicFrustum();
  }

  /**
   * Switches projection while keeping the subject the same size on screen.
   *
   * Going orthographic derives the frustum height from the current perspective
   * distance; going back to perspective derives the distance from the
   * orthographic frustum height, including any zoom the user applied.
   */
  setProjection(mode: ProjectionMode): void {
    if (mode === this.mode) return;

    if (mode === 'orthographic') {
      this.orthographicCamera.position.copy(this.perspectiveCamera.position);
      this.orthographicCamera.up.copy(this.perspectiveCamera.up);
      this.orthographicCamera.zoom = 1;
      this.mode = mode;
      this.syncOrthographicFrustum();
    } else {
      const visibleHeight = (this.orthographicCamera.top - this.orthographicCamera.bottom) / this.orthographicCamera.zoom;
      const distance = visibleHeight / 2 / Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov) / 2);
      const direction = this.orthographicCamera.position.clone().sub(this.target).normalize();
      this.perspectiveCamera.position.copy(this.target).addScaledVector(direction, distance);
      this.perspectiveCamera.up.copy(this.orthographicCamera.up);
      this.mode = mode;
    }

    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Moves to a named view.
   *
   * Axis-aligned views switch to orthographic because a dimensioned side
   * elevation is only readable without perspective distortion; the iso view
   * returns to perspective. An explicit projection toggle still overrides this
   * afterwards.
   *
   * @param preset View to move to.
   * @param animate Pass false to jump instantly (used during startup).
   */
  applyView(preset: ViewPreset, animate = true): void {
    this.setProjection(preset === 'iso' ? 'perspective' : 'orthographic');

    const { dir, up } = VIEW_VECTORS[preset];
    const distance = this.fitDistance(this.contentRadius);
    const position = this.target.clone().addScaledVector(dir, distance);

    this.preset = preset;
    this.orthographicCamera.zoom = 1;
    this.syncOrthographicFrustum(distance);

    if (!animate) {
      this.camera.position.copy(position);
      this.camera.up.copy(up);
      this.camera.lookAt(this.target);
      return;
    }

    this.tween = {
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      fromTarget: this.target.clone(),
      toTarget: this.target.clone(),
      fromUp: this.camera.up.clone(),
      toUp: up.clone(),
      elapsed: 0,
      duration: 0.42,
    };
  }

  /**
   * Frames a bounding box, remembering its radius so later view changes keep
   * the same fit.
   *
   * @param box World-space bounds in inches.
   * @param animate Whether to tween to the new position.
   */
  frame(box: THREE.Box3, animate = true): void {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.contentRadius = Math.max(sphere.radius, 1);

    const direction = this.camera.position.clone().sub(this.target);
    if (direction.lengthSq() < 1e-6) direction.copy(VIEW_VECTORS.iso.dir);
    direction.normalize();

    const distance = this.fitDistance(this.contentRadius);
    const toTarget = sphere.center.clone();
    const toPosition = toTarget.clone().addScaledVector(direction, distance);

    this.syncOrthographicFrustum(distance);

    if (!animate) {
      this.target.copy(toTarget);
      this.camera.position.copy(toPosition);
      this.camera.lookAt(this.target);
      return;
    }

    this.tween = {
      fromPosition: this.camera.position.clone(),
      toPosition,
      fromTarget: this.target.clone(),
      toTarget,
      fromUp: this.camera.up.clone(),
      toUp: this.camera.up.clone(),
      elapsed: 0,
      duration: 0.42,
    };
  }

  /** Clears the active preset after the user orbits or pans manually. */
  clearPreset(): void {
    this.preset = null;
  }

  /**
   * Advances any in-flight camera move.
   *
   * @param delta Seconds since the previous frame.
   * @returns True while the camera is still moving.
   */
  update(delta: number): boolean {
    const tween = this.tween;
    if (!tween) return false;

    tween.elapsed += delta;
    const t = Math.min(1, tween.elapsed / tween.duration);
    const eased = easeInOutCubic(t);

    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    this.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    this.camera.up.lerpVectors(tween.fromUp, tween.toUp, eased).normalize();
    this.camera.lookAt(this.target);

    if (t >= 1) {
      this.tween = null;
      return false;
    }
    return true;
  }

  /**
   * Distance at which a sphere of `radius` fills the frame in both axes, with a
   * small margin so geometry never touches the viewport edge.
   */
  private fitDistance(radius: number): number {
    const vFov = THREE.MathUtils.degToRad(this.perspectiveCamera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.aspect);
    return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.06;
  }

  /**
   * Rebuilds the orthographic frustum so it shows the same vertical extent the
   * perspective camera would at the given distance.
   */
  private syncOrthographicFrustum(distance?: number): void {
    const d = distance ?? this.perspectiveCamera.position.distanceTo(this.target);
    const halfHeight = Math.max(d * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov) / 2), 1);
    const halfWidth = halfHeight * this.aspect;

    const cam = this.orthographicCamera;
    cam.left = -halfWidth;
    cam.right = halfWidth;
    cam.top = halfHeight;
    cam.bottom = -halfHeight;
    cam.updateProjectionMatrix();
  }
}
