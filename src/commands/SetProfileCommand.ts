import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { ProfilePoint } from '@/geometry/ProfileShapes';
import type { Command } from './Command';

/** Window within which successive profile edits merge, in milliseconds. */
const MERGE_WINDOW_MS = 1000;

/**
 * Reshapes an extrusion's polygon profile.
 *
 * Separate from {@link SetPropertyCommand} because a profile is not a scalar:
 * it is an array whose length can change, and setting it also rewrites the
 * object's width and depth. Capturing the dimensions alongside the polygon is
 * what makes undo restore the object exactly, including a size the user had
 * stretched by hand before reshaping.
 */
export class SetProfileCommand implements Command {
  readonly label = 'Reshape profile';

  private readonly store: ObjectStore;
  private readonly object: SceneObject;
  private readonly before: ProfilePoint[];
  private readonly beforeScale: [number, number, number];
  private after: ProfilePoint[];
  private timestamp: number;

  constructor(store: ObjectStore, object: SceneObject, points: readonly ProfilePoint[]) {
    this.store = store;
    this.object = object;
    this.before = object.profile.map(([x, z]) => [x, z] as ProfilePoint);
    this.after = points.map(([x, z]) => [x, z] as ProfilePoint);
    this.timestamp = performance.now();

    const { x, y, z } = object.mesh.scale;
    this.beforeScale = [x, y, z];
  }

  execute(): void {
    this.object.setProfile(this.after);
    this.store.notifyChanged(this.object, 'transform');
  }

  undo(): void {
    this.object.setProfile(this.before);
    this.object.mesh.scale.set(...this.beforeScale);
    this.object.mesh.updateMatrixWorld(true);
    this.store.notifyChanged(this.object, 'transform');
  }

  /**
   * Absorbs a follow-up reshape of the same object.
   *
   * Typing coordinates produces a command per field; merging within a short
   * window means one undo returns to the shape the user started from rather
   * than stepping back through every digit.
   */
  mergeWith(next: Command): boolean {
    if (!(next instanceof SetProfileCommand)) return false;
    if (next.object !== this.object) return false;
    if (next.timestamp - this.timestamp > MERGE_WINDOW_MS) return false;

    this.after = next.after;
    this.timestamp = next.timestamp;
    return true;
  }
}
