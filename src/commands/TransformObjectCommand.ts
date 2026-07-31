import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { TransformSnapshot } from '@/objects/ObjectTypes';
import type { Command } from './Command';

/**
 * Records a completed transform gesture.
 *
 * A gizmo drag changes an object many times a second; recording each change
 * would make undo useless. Instead the gesture is bracketed: the tool captures
 * a snapshot when the drag starts, another when it ends, and builds one command
 * from the pair.
 *
 * `execute` writes the after-state, which the viewport already shows, so
 * pushing this command after a drag is visually a no-op — the reason
 * {@link Command} requires `execute` to be idempotent.
 */
export class TransformObjectCommand implements Command {
  readonly label: string;

  private readonly store: ObjectStore;
  private readonly objects: readonly SceneObject[];
  private readonly before: readonly TransformSnapshot[];
  private readonly after: readonly TransformSnapshot[];

  /**
   * @param store Registry used to announce the change.
   * @param objects Objects that moved, in the same order as the snapshots.
   * @param before State captured when the gesture began.
   * @param after State captured when the gesture ended.
   * @param label Description shown in the history, e.g. `Move`, `Rotate`.
   */
  constructor(
    store: ObjectStore,
    objects: readonly SceneObject[],
    before: readonly TransformSnapshot[],
    after: readonly TransformSnapshot[],
    label: string,
  ) {
    this.store = store;
    this.objects = objects;
    this.before = before;
    this.after = after;
    this.label = objects.length === 1 ? `${label} ${objects[0].name}` : `${label} ${objects.length} objects`;
  }

  /**
   * True when the gesture actually changed something.
   *
   * A click that grazes a gizmo handle produces identical snapshots; pushing
   * that would leave the user with an undo step that does nothing visible.
   */
  static isMeaningful(before: readonly TransformSnapshot[], after: readonly TransformSnapshot[]): boolean {
    return before.some((snapshot, index) => {
      const next = after[index];
      if (!next) return true;
      return (
        snapshot.position.some((value, axis) => Math.abs(value - next.position[axis]) > 1e-4) ||
        snapshot.rotation.some((value, axis) => Math.abs(value - next.rotation[axis]) > 1e-5) ||
        snapshot.dimensions.some((value, axis) => Math.abs(value - next.dimensions[axis]) > 1e-4)
      );
    });
  }

  execute(): void {
    this.apply(this.after);
  }

  undo(): void {
    this.apply(this.before);
  }

  /** Restores one set of snapshots and announces every affected object. */
  private apply(snapshots: readonly TransformSnapshot[]): void {
    this.objects.forEach((object, index) => {
      const snapshot = snapshots[index];
      if (!snapshot) return;
      object.restore(snapshot);
      this.store.notifyChanged(object, 'transform');
    });
  }
}
