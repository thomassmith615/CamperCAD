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
import type { SnapEngine } from '@/snapping/SnapEngine';
import type { SnapIndicator } from '@/snapping/SnapIndicator';
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
 * ## Snapping
 *
 * Every drag frame recomputes the object's position from the **state captured
 * when the drag began** plus the gizmo's raw offset, and only then applies the
 * snap correction. Applying corrections incrementally would let them accumulate:
 * a correction made on one frame would become part of the input to the next, and
 * an object dragged slowly along a wall would creep. Recomputing from the drag
 * origin each frame makes the correction stateless and the result identical
 * whether the user moved fast or slow.
 *
 * ## Multiple selection
 *
 * Several objects are moved through an invisible proxy the gizmo attaches to.
 * Rotate and scale stay restricted to a single selection: rotating a group about
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
  private readonly snapping: SnapEngine;
  private readonly indicator: SnapIndicator;

  private mode: GizmoMode = 'translate';
  private attached: SceneObject[] = [];
  private before: TransformSnapshot[] = [];
  private dragStartPositions: THREE.Vector3[] = [];
  private proxyStart = new THREE.Vector3();
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
    snapping: SnapEngine,
    indicator: SnapIndicator,
  ) {
    this.selection = selection;
    this.store = store;
    this.stack = stack;
    this.orbit = orbit;
    this.bus = bus;
    this.snapping = snapping;
    this.indicator = indicator;

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
  }

  /** True while the pointer is on a gizmo handle, so picking must stand down. */
  get isEngaged(): boolean {
    return this.controls.dragging || this.controls.axis !== null;
  }

  /** Current interaction mode. */
  get activeMode(): GizmoMode {
    return this.mode;
  }

  /** Whether the current selection permits a given mode. */
  supportsMode(mode: GizmoMode): boolean {
    return mode === 'translate' || this.selection.size === 1;
  }

  /** Switches mode, falling back to translate when the selection forbids it. */
  setMode(mode: GizmoMode): void {
    this.mode = this.supportsMode(mode) ? mode : 'translate';
    this.controls.setMode(this.mode);
    this.announce();
  }

  /** Rebinds the gizmo after a camera swap. */
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
   * selection containing only locked objects, detaches it.
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

      this.combinedBounds().getCenter(this.proxy.position);
      this.proxy.rotation.set(0, 0, 0);
      this.proxy.scale.set(1, 1, 1);
      this.proxy.updateMatrixWorld(true);
      this.controls.attach(this.proxy);
    }

    this.controls.setMode(this.mode);
    this.announce();
  }

  /** Captures the pre-drag state of everything the gesture will move. */
  private beginGesture(): void {
    this.before = this.attached.map((object) => object.snapshot());
    this.dragStartPositions = this.attached.map((object) => object.mesh.position.clone());
    this.proxyStart.copy(this.proxy.position);
  }

  /**
   * Applies the frame's change, then the snap correction.
   *
   * Positions are always rebuilt from the drag-start state so the correction
   * never compounds across frames.
   */
  private onObjectChange(): void {
    if (this.usingProxy) {
      const offset = this.proxy.position.clone().sub(this.proxyStart);
      this.attached.forEach((object, index) => {
        const start = this.dragStartPositions[index];
        if (start) object.mesh.position.copy(start).add(offset);
        object.mesh.updateMatrixWorld(true);
      });
    } else if (this.mode === 'scale') {
      const object = this.attached[0];
      if (object) {
        object.clampDimensions();
        this.snapping.solveDimensions(object.mesh.scale);
        object.mesh.updateMatrixWorld(true);
      }
    }

    if (this.mode === 'translate') this.applySnapping();

    for (const object of this.attached) this.store.notifyChanged(object, 'transform');
  }

  /**
   * Solves snapping for the current drag position and nudges the selection onto
   * whatever it found, publishing the result so the guides and status bar can
   * show what is holding the object.
   */
  private applySnapping(): void {
    if (this.attached.length === 0) return;

    const bounds = this.combinedBounds();
    const result = this.snapping.solve(this.attached, bounds);
    const delta = new THREE.Vector3(result.delta[0], result.delta[1], result.delta[2]);

    if (delta.lengthSq() > 0) {
      for (const object of this.attached) {
        object.mesh.position.add(delta);
        object.mesh.updateMatrixWorld(true);
      }
      bounds.translate(delta);
    }

    this.indicator.show(result.applied, bounds);
    this.bus.emit('snap:active', { applied: result.applied });
  }

  /**
   * Closes the gesture, pushing one command for the whole drag.
   *
   * Gestures that changed nothing are discarded so a click that grazes a handle
   * does not leave a do-nothing entry in the history.
   */
  private endGesture(): void {
    this.indicator.clear();
    this.bus.emit('snap:active', { applied: [] });

    if (this.attached.length === 0 || this.before.length === 0) return;

    const after = this.attached.map((object) => object.snapshot());
    if (TransformObjectCommand.isMeaningful(this.before, after)) {
      this.stack.execute(
        new TransformObjectCommand(this.store, this.attached, this.before, after, MODE_LABELS[this.mode]),
      );
    }
    this.before = [];

    // The proxy has drifted with the drag; re-centre it on the moved selection
    // so the next gesture starts from the right place.
    if (this.usingProxy && this.attached.length > 0) {
      this.combinedBounds().getCenter(this.proxy.position);
      this.proxy.updateMatrixWorld(true);
    }
  }

  /** World bounds of every attached object. */
  private combinedBounds(): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const object of this.attached) bounds.union(object.boundingBox());
    return bounds;
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
