import type * as THREE from 'three';
import type { EventBus } from '@/core/EventBus';
import type { AppEvents } from '@/core/AppEvents';
import type { SceneManager } from '@/core/SceneManager';
import type { SceneObject } from './SceneObject';
import type { ObjectPropertyKey } from './ObjectTypes';

/**
 * The registry of every object in the design.
 *
 * Membership of this store and membership of the scene's design group are the
 * same thing, enforced in one place: commands add and remove objects here and
 * never touch the scene graph themselves. That is what makes undo of a deletion
 * exact — the object was never destroyed, only unparented.
 */
export class ObjectStore {
  private readonly items = new Map<string, SceneObject>();
  private readonly scene: SceneManager;
  private readonly bus: EventBus<AppEvents>;

  constructor(scene: SceneManager, bus: EventBus<AppEvents>) {
    this.scene = scene;
    this.bus = bus;
  }

  /** Number of objects in the design. */
  get count(): number {
    return this.items.size;
  }

  /** Every object, in insertion order. */
  all(): SceneObject[] {
    return [...this.items.values()];
  }

  /** The meshes selection raycasting should test. */
  pickables(): THREE.Object3D[] {
    return this.all()
      .filter((object) => object.mesh.visible)
      .map((object) => object.mesh);
  }

  /** Looks up an object by identifier. */
  get(id: string): SceneObject | undefined {
    return this.items.get(id);
  }

  /** True when the object is currently part of the design. */
  has(object: SceneObject): boolean {
    return this.items.has(object.id);
  }

  /** Finds the object owning a mesh, following the raycast hit's ancestry. */
  fromObject3D(target: THREE.Object3D | null): SceneObject | null {
    let node: THREE.Object3D | null = target;
    while (node) {
      const id = node.userData.objectId;
      if (typeof id === 'string') return this.items.get(id) ?? null;
      node = node.parent;
    }
    return null;
  }

  /** Adds objects and parents their meshes to the design group. */
  add(objects: readonly SceneObject[]): void {
    const added = objects.filter((object) => !this.items.has(object.id));
    if (added.length === 0) return;

    for (const object of added) {
      this.items.set(object.id, object);
      this.scene.designGroup.add(object.mesh);
    }
    this.bus.emit('objects:added', { objects: added });
  }

  /**
   * Removes objects from the design.
   *
   * Their meshes are unparented but nothing is disposed: a removal usually sits
   * on the undo stack, and the objects must come back intact. Disposal happens
   * when the owning command falls off the stack.
   */
  remove(objects: readonly SceneObject[]): void {
    const removed = objects.filter((object) => this.items.has(object.id));
    if (removed.length === 0) return;

    for (const object of removed) {
      this.items.delete(object.id);
      object.mesh.removeFromParent();
    }
    this.bus.emit('objects:removed', { objects: removed });
  }

  /**
   * Announces that an object changed.
   *
   * Mutation happens on the object itself; this is how the inspector, the
   * selection outline and the status bar hear about it. Commands call it after
   * applying their change so a single notification covers the whole edit.
   *
   * @param object Object that changed.
   * @param key Property that changed, or `transform` for a gizmo move.
   */
  notifyChanged(object: SceneObject, key: ObjectPropertyKey | 'transform'): void {
    this.bus.emit('object:changed', { object, key });
  }

  /** Bounds of every object in the design, empty when there are none. */
  bounds(): THREE.Box3 | null {
    const objects = this.all();
    if (objects.length === 0) return null;

    const box = objects[0].boundingBox();
    for (let i = 1; i < objects.length; i += 1) box.union(objects[i].boundingBox());
    return box;
  }
}
