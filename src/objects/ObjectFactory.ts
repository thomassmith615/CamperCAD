import { SceneObject } from './SceneObject';
import { DEFAULT_BOX_SIZE, type ObjectData, type ObjectKind } from './ObjectTypes';

/** Default colour for new objects: birch plywood, the usual carcass material. */
const DEFAULT_COLOR = '#c9a227';

/** Per-kind display names, used to name objects as they are created. */
const KIND_LABELS: Record<ObjectKind, string> = {
  box: 'Box',
};

/**
 * Creates objects.
 *
 * Every object in the application is born here, which is what will let the
 * object library drop in later: a cabinet or a water tank is a new `ObjectKind`
 * with its own defaults and geometry, and nothing outside this file needs to
 * learn about it.
 *
 * Identifiers are generated locally rather than with `crypto.randomUUID`, which
 * is unavailable outside a secure context and would fail on a plain-HTTP LAN
 * preview of the dev server.
 */
export class ObjectFactory {
  private counters = new Map<ObjectKind, number>();

  /**
   * Creates an object of the given kind at the origin.
   *
   * @param kind Kind to create.
   * @returns A new object, not yet added to any store.
   */
  create(kind: ObjectKind): SceneObject {
    const index = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, index);

    const object = new SceneObject(ObjectFactory.createId(), kind, `${KIND_LABELS[kind]} ${index}`, DEFAULT_COLOR);
    object.mesh.scale.set(...DEFAULT_BOX_SIZE);
    object.mesh.updateMatrixWorld(true);
    return object;
  }

  /**
   * Rebuilds an object from serialised data, preserving its identifier.
   *
   * Used by project loading and by undo of a deletion, both of which must
   * restore the exact object rather than an equivalent one.
   */
  fromData(data: ObjectData): SceneObject {
    const object = new SceneObject(data.id, data.kind, data.name, data.color);
    object.applyData(data);
    return object;
  }

  /**
   * Copies an object, giving the copy a fresh identifier and a numbered name.
   *
   * @param source Object to copy.
   * @param offset Amount to shift the copy by on X and Z, in inches, so it does
   * not land exactly on top of the original.
   */
  duplicate(source: SceneObject, offset: number): SceneObject {
    const data = source.toData();
    const copy = this.fromData({
      ...data,
      id: ObjectFactory.createId(),
      name: ObjectFactory.nextCopyName(data.name),
    });
    copy.mesh.position.x += offset;
    copy.mesh.position.z += offset;
    copy.mesh.updateMatrixWorld(true);
    return copy;
  }

  /** Generates a collision-resistant identifier without a secure context. */
  private static createId(): string {
    return `obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Turns `Box 1` into `Box 1 copy`, and `Box 1 copy` into `Box 1 copy 2`. */
  private static nextCopyName(name: string): string {
    const numbered = name.match(/^(.*copy)\s+(\d+)$/);
    if (numbered) return `${numbered[1]} ${Number.parseInt(numbered[2], 10) + 1}`;
    if (name.endsWith('copy')) return `${name} 2`;
    return `${name} copy`;
  }
}
