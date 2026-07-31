import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { ObjectProperties, ObjectPropertyKey } from '@/objects/ObjectTypes';
import type { Command } from './Command';

/** Window within which successive edits to one property merge, in milliseconds. */
const MERGE_WINDOW_MS = 1000;

/**
 * Changes one property of one object.
 *
 * Because every editable thing about an object is a named scalar, this single
 * command covers renaming, recolouring, resizing, repositioning, locking and
 * every property the object library adds later. There is no per-property
 * command class and no per-property undo code.
 *
 * @typeParam K The property being edited.
 */
export class SetPropertyCommand<K extends ObjectPropertyKey> implements Command {
  readonly label: string;

  private readonly store: ObjectStore;
  private readonly object: SceneObject;
  private readonly key: K;
  private readonly before: ObjectProperties[K];
  private after: ObjectProperties[K];
  private timestamp: number;

  /**
   * @param store Registry used to announce the change.
   * @param object Object to edit.
   * @param key Property to set.
   * @param value New value. The previous value is read from the object now.
   */
  constructor(store: ObjectStore, object: SceneObject, key: K, value: ObjectProperties[K]) {
    this.store = store;
    this.object = object;
    this.key = key;
    this.before = object.get(key);
    this.after = value;
    this.timestamp = performance.now();
    this.label = `Change ${SetPropertyCommand.describe(key)}`;
  }

  /** True when the new value differs from what the object already holds. */
  static changes<P extends ObjectPropertyKey>(object: SceneObject, key: P, value: ObjectProperties[P]): boolean {
    const current = object.get(key);
    if (typeof current === 'number' && typeof value === 'number') return Math.abs(current - value) > 1e-6;
    return current !== value;
  }

  execute(): void {
    this.object.set(this.key, this.after);
    this.store.notifyChanged(this.object, this.key);
  }

  undo(): void {
    this.object.set(this.key, this.before);
    this.store.notifyChanged(this.object, this.key);
  }

  /**
   * Absorbs a follow-up edit to the same property of the same object.
   *
   * Dragging a number field or retyping a width produces a burst of commands;
   * merging them within a short window means one undo returns to the value the
   * user started from rather than stepping back through every intermediate.
   */
  mergeWith(next: Command): boolean {
    if (!(next instanceof SetPropertyCommand)) return false;
    if (next.object !== this.object || next.key !== this.key) return false;
    if (next.timestamp - this.timestamp > MERGE_WINDOW_MS) return false;

    this.after = next.after as ObjectProperties[K];
    this.timestamp = next.timestamp;
    return true;
  }

  /** Turns a property key into words, e.g. `positionX` into `position X`. */
  private static describe(key: ObjectPropertyKey): string {
    return key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  }
}
