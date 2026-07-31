import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { Command } from './Command';

/**
 * Removes one or more objects from the design.
 *
 * The objects are held by this command for as long as it sits on the undo
 * stack, which is what makes undo of a deletion exact rather than a
 * reconstruction. They are freed only when the command is discarded and the
 * deletion becomes permanent.
 */
export class RemoveObjectCommand implements Command {
  readonly label: string;

  private readonly store: ObjectStore;
  private readonly objects: readonly SceneObject[];

  constructor(store: ObjectStore, objects: readonly SceneObject[]) {
    this.store = store;
    this.objects = objects;
    this.label = objects.length === 1 ? `Delete ${objects[0].name}` : `Delete ${objects.length} objects`;
  }

  execute(): void {
    this.store.remove(this.objects);
  }

  undo(): void {
    this.store.add(this.objects);
  }

  /** Frees the objects if the deletion is still in force. */
  dispose(): void {
    for (const object of this.objects) {
      if (!this.store.has(object)) object.dispose();
    }
  }
}
