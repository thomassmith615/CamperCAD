import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { Command } from './Command';

/**
 * Adds one or more objects to the design.
 *
 * Undo removes them but keeps them alive, because a redo must restore the same
 * objects with the same identifiers rather than equivalent copies — anything
 * holding a reference, such as the selection, would otherwise be left pointing
 * at an object that no longer exists.
 */
export class AddObjectCommand implements Command {
  readonly label: string;

  private readonly store: ObjectStore;
  private readonly objects: readonly SceneObject[];

  /**
   * @param store Registry to add to.
   * @param objects Objects to add.
   * @param label Description shown in the history, defaulted from the contents.
   */
  constructor(store: ObjectStore, objects: readonly SceneObject[], label?: string) {
    this.store = store;
    this.objects = objects;
    this.label = label ?? (objects.length === 1 ? `Add ${objects[0].name}` : `Add ${objects.length} objects`);
  }

  execute(): void {
    this.store.add(this.objects);
  }

  undo(): void {
    this.store.remove(this.objects);
  }

  /**
   * Frees the objects, but only if the addition never took effect — that is,
   * if this command is being discarded from the redo stack.
   */
  dispose(): void {
    for (const object of this.objects) {
      if (!this.store.has(object)) object.dispose();
    }
  }
}
