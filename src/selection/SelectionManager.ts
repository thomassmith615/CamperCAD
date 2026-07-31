import type { EventBus } from '@/core/EventBus';
import type { AppEvents } from '@/core/AppEvents';
import type { SceneObject } from '@/objects/SceneObject';

/** How a new pick combines with the existing selection. */
export type SelectionMode = 'replace' | 'add' | 'toggle';

/**
 * The set of currently selected objects.
 *
 * Insertion order is preserved, which matters: the first-selected object is the
 * one the inspector shows and the one alignment operations will later treat as
 * the anchor.
 *
 * Locked objects can still be selected. Locking prevents transformation, not
 * inspection — a locked object that could not be selected would also be
 * impossible to unlock.
 */
export class SelectionManager {
  private readonly selected = new Set<SceneObject>();
  private readonly bus: EventBus<AppEvents>;

  constructor(bus: EventBus<AppEvents>) {
    this.bus = bus;

    // An object deleted while selected must not linger in the selection, or the
    // gizmo stays attached to a mesh that is no longer in the scene.
    bus.on('objects:removed', ({ objects }) => {
      const pruned = objects.filter((object) => this.selected.delete(object));
      if (pruned.length > 0) this.announce();
    });
  }

  /** Selected objects, in the order they were selected. */
  get objects(): SceneObject[] {
    return [...this.selected];
  }

  /** Number of selected objects. */
  get size(): number {
    return this.selected.size;
  }

  /** The single selected object, or null when the count is not exactly one. */
  get single(): SceneObject | null {
    return this.selected.size === 1 ? this.objects[0] : null;
  }

  /** True when the object is selected. */
  has(object: SceneObject): boolean {
    return this.selected.has(object);
  }

  /** True when every selected object can be transformed. */
  get isTransformable(): boolean {
    return this.selected.size > 0 && this.objects.every((object) => !object.isLocked);
  }

  /**
   * Applies a pick to the selection.
   *
   * @param objects Objects picked, possibly empty for a click on nothing.
   * @param mode How to combine them with the current selection.
   */
  select(objects: readonly SceneObject[], mode: SelectionMode = 'replace'): void {
    const before = this.signature();

    if (mode === 'replace') this.selected.clear();

    for (const object of objects) {
      if (mode === 'toggle' && this.selected.has(object)) this.selected.delete(object);
      else this.selected.add(object);
    }

    if (this.signature() !== before) this.announce();
  }

  /** Empties the selection. */
  clear(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.announce();
  }

  /** Publishes the current selection. */
  private announce(): void {
    this.bus.emit('selection:changed', { objects: this.objects });
  }

  /** Cheap comparable identity of the selection, used to suppress no-op events. */
  private signature(): string {
    return this.objects.map((object) => object.id).join('|');
  }
}
