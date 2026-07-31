import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { CameraManager } from '@/core/CameraManager';
import type { ControlsManager } from '@/core/ControlsManager';
import type { SceneManager } from '@/core/SceneManager';
import type { EventBus } from '@/core/EventBus';
import type { AppEvents } from '@/core/AppEvents';
import type { CommandStack } from '@/commands/CommandStack';
import { TransformObjectCommand } from '@/commands/TransformObjectCommand';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { TransformSnapshot } from '@/objects/ObjectTypes';
import type { SelectionManager } from './SelectionManager';

/** Gizmo interaction modes. */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** History labels per mode. */
const MODE_LABELS: Record<GizmoMode, string> = {
  translate: 'Move',
  rotate: 'Rotate',
  scale: 'Resize',
};

/** Rotation snap increment, 15 degrees in radians. */
const ROTATION_SNAP = Math.PI / 12;

/**
 * Three exposes the gizmo's scene objects through `getHelper()` from r169.
 * Earlier releases had `TransformControls` extend `Object3D` directly. Probing
 * for the method keeps the app working across both rather than throwing at
 * startup on a version mismatch.
 */
function gizmoHelper(controls: TransformControls): THREE.Object3D {
  const provider = controls as unknown as { getHelper?: () => THREE.Object3D };
  return typeof provider.getHelper === 'function' ? provider.getHelper() : (controls as unknown as THREE.Object3D);
}

/**
 * The move/rotate/scale gizmo.
 *
 * Because dimensions are carried by mesh scale, scale mode edits width, height
 * and depth directly, and because an object's origin is the centre of its
 * bottom face, scaling in Y grows a cabinet upward from the floor rather than
 * through the subfloor.
 *
 * Multiple selected objects are moved through an invisible proxy the gizmo
 * attaches to; the proxy's frame-to-frame delta is applied to each object.
 * Rotate and scale are restricted to a single selection: rotating a group about
 * a shared centroid also has to move each member, and doing that correctly with
 * non-uniform scale is a separate piece of work rather than something to
 * approximate silently.
 */
export class TransformGizmo {
  private readonly controls: TransformControls;
  private readonly proxy = new THREE.Object3D();
  private readonly selection: SelectionManager;
  private readonly store: ObjectStore;
  private readonly stack: CommandStack;
  private readonly orbit: ControlsManager;
  private readonly bus: EventBus<AppEvents>;

  private mode: GizmoMode = 'translate';
  private attached: SceneObject[] = [];
  private before: TransformSnapshot[] = [];
  private lastProxyPosition = new THREE.Vector3();
  private usingProxy = false;

  constructor(
    scene: SceneManager,
    cameras: CameraManager,
    orbit: ControlsManager,
    canvas: HTMLElement,
    selection: SelectionManager,
    store: ObjectStore,
    stack: CommandStack,
    bus: EventBus<AppEvents>,
  ) {
    this.selection = selection;
    this.store = store;
    this.stack = stack;
    this.orbit = orbit;
    this.bus = bus;

    this.proxy.name = 'Gizmo proxy';
    scene.helperGroup.add(this.proxy);

    this.controls = new TransformControls(cameras.camera, canvas);
    this.controls.setSpace('local');
    this.controls.rotationSnap = ROTATION_SNAP;
    scene.helperGroup.add(gizmoHelper(this.controls));

    this.controls.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean((event as unknown as { value: boolean }).value);
      if (dragging) this.orbit.suspend('gizmo');
      else this.orbit.resume('gizmo');
    });

    this.controls.addEventListener('mouseDown', () => this.beginGesture());
    this.controls.addEventListener('mouseUp', () => this.endGesture());
    this.controls.addEventListener('objectChange', () => this.onObjectChange());

    bus.on('selection:changed', ({ objects }) => this.attach(objects));
    bus.on('grid:changed', ({ spacing }) => {
      this.controls.translationSnap = spacing;
    });
  }

  /** True while the pointer is on a gizmo handle, so picking must stand down. */
  get isEngaged(): boolean {
    return this.controls.dragging || this.controls.axis !== null;
  }

  /** Current interaction mode. */
  get activeMode(): GizmoMode {
    return this.mode;
  }

  /** Whether the current selection permits rotate and scale. */
  get supportsMode(): (mode: GizmoMode) => boolean {
    return (mode: GizmoMode) => mode === 'translate' || this.selection.size === 1;
  }

  /** Switches mode, falling back to translate when the selection forbids it. */
  setMode(mode: GizmoMode): void {
    this.mode = this.supportsMode(mode) ? mode : 'translate';
    this.controls.setMode(this.mode);
    this.announce();
  }

  /** Rebinds the gizmo after a camera swap, then follows the selection. */
  update(camera: THREE.Camera): void {
    if (this.controls.camera !== camera) this.controls.camera = camera;
  }

  /** Detaches and releases the gizmo. */
  dispose(): void {
    this.controls.detach();
    this.controls.dispose();
  }

  /**
   * Points the gizmo at a selection.
   *
   * A single unlocked object gets the gizmo directly. Several objects get the
   * proxy, positioned at the centre of their combined bounds. Nothing, or a
   * selection containing a locked object, detaches it.
   */
  private attach(objects: readonly SceneObject[]): void {
    this.attached = objects.filter((object) => !object.isLocked);

    if (this.attached.length === 0) {
      this.usingProxy = false;
      this.controls.detach();
      this.announce();
      return;
    }

    if (this.attached.length === 1) {
      this.usingProxy = false;
      this.controls.attach(this.attached[0].mesh);
    } else {
      this.usingProxy = true;
      if (this.mode !== 'translate') this.setMode('translate');

      const bounds = this.attached[0].boundingBox();
      for (const object of this.attached.slice(1)) bounds.union(object.boundingBox());
      bounds.getCenter(this.proxy.position);

      this.proxy.rotation.set(0, 0, 0);
      this.proxy.scale.set(1, 1, 1);
      this.proxy.updateMatrixWorld(true);
      this.lastProxyPosition.copy(this.proxy.position);
      this.controls.attach(this.proxy);
    }

    this.controls.setMode(this.mode);
    this.announce();
  }

  /** Captures the pre-drag state of everything the gesture will move. */
  private beginGesture(): void {
    this.before = this.attached.map((object) => object.snapshot());
    if (this.usingProxy) this.lastProxyPosition.copy(this.proxy.position);
  }

  /** Applies the frame's change and keeps dependent state in sync. */
  private onObjectChange(): void {
    if (this.usingProxy) {
      const delta = this.proxy.position.clone().sub(this.lastProxyPosition);
      this.lastProxyPosition.copy(this.proxy.position);
      for (const object of this.attached) {
        object.mesh.position.add(delta);
        object.mesh.updateMatrixWorld(true);
      }
    } else if (this.mode === 'scale') {
      this.attached[0]?.clampDimensions();
    }

    for (const object of this.attached) this.store.notifyChanged(object, 'transform');
  }

  /**
   * Closes the gesture, pushing one command for the whole drag.
   *
   * Gestures that changed nothing are discarded so a click that grazes a handle
   * does not leave a do-nothing entry in the history.
   */
  private endGesture(): void {
    if (this.attached.length === 0 || this.before.length === 0) return;

    const after = this.attached.map((object) => object.snapshot());
    if (TransformObjectCommand.isMeaningful(this.before, after)) {
      this.stack.execute(
        new TransformObjectCommand(this.store, this.attached, this.before, after, MODE_LABELS[this.mode]),
      );
    }
    this.before = [];
  }

  /** Publishes gizmo state for the toolbar. */
  private announce(): void {
    this.bus.emit('gizmo:changed', {
      mode: this.mode,
      enabled: this.attached.length > 0,
      multiSelect: this.attached.length > 1,
    });
  }
}
