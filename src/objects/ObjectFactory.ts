import { SceneObject } from './SceneObject';
import { KIND_DEFAULT_SIZE, type ObjectData, type ObjectKind } from './ObjectTypes';
import { PROFILE_PRESETS } from '@/geometry/ProfileShapes';
import type { LibraryItem } from '@/library/LibraryTypes';

/** Default colour for new objects: birch plywood, the usual carcass material. */
const DEFAULT_COLOR = '#c9a227';

/** Per-kind display names, used to name objects as they are created. */
const KIND_LABELS: Record<ObjectKind, string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  panel: 'Panel',
  extrusion: 'Extrusion',
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
  private libraryCounters = new Map<string, number>();

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
    object.mesh.scale.set(...KIND_DEFAULT_SIZE[kind]);

    // An extrusion with no profile has nothing to extrude, so it starts from
    // the first preset rather than as an invisible object.
    if (object.hasProfile) {
      const preset = PROFILE_PRESETS[0];
      object.setProfile(preset.build());
      object.mesh.scale.y = KIND_DEFAULT_SIZE[kind][1];
    }

    object.mesh.updateMatrixWorld(true);
    return object;
  }

  /**
   * Creates an object from a library item.
   *
   * The item's values are copied onto the object rather than referenced, so the
   * object is fully independent afterwards: editing a cabinet's dimensions must
   * not alter the catalog, and a saved project must not depend on the catalog
   * still containing that entry when it is reopened.
   *
   * Names are numbered per item type, so placing three fridges gives
   * `Fridge, 12V 50 L 1` through `3` rather than three identical names.
   */
  fromLibrary(item: LibraryItem): SceneObject {
    const index = (this.libraryCounters.get(item.id) ?? 0) + 1;
    this.libraryCounters.set(item.id, index);

    const object = new SceneObject(
      ObjectFactory.createId(),
      item.kind,
      index === 1 ? item.name : `${item.name} ${index}`,
      item.color,
    );

    // An extrusion from the library needs a starting outline before its
    // dimensions mean anything, since setProfile rewrites width and depth.
    if (object.hasProfile) {
      object.setProfile(PROFILE_PRESETS[0].build());
    }

    object.mesh.scale.set(...item.dimensions);
    object.set('weight', item.weight);
    object.set('price', item.price);

    if (item.capacityGallons) {
      object.set('capacityGallons', item.capacityGallons);
      object.set('fillGallons', item.startsFull === false ? 0 : item.capacityGallons);
    }

    object.set('notes', item.notes);
    if (item.material) object.set('material', item.material);

    if (item.electrical) {
      const e = item.electrical;
      if (e.watts) object.set('loadWatts', e.watts);
      if (e.hoursPerDay) object.set('loadHoursPerDay', e.hoursPerDay);
      if (e.ac) object.set('loadIsAc', true);
      if (e.batteryAmpHours) object.set('batteryAmpHours', e.batteryAmpHours);
      if (e.solarWatts) object.set('solarWatts', e.solarWatts);
      if (e.inverterWatts) object.set('inverterWatts', e.inverterWatts);
    }
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

  /**
   * Seeds the name counters from existing objects.
   *
   * Called after loading a project so the next box created is `Box 4` rather
   * than `Box 1`, which would collide with what the user already has.
   *
   * @param names Names of the objects now in the design.
   */
  adoptNames(names: readonly string[]): void {
    this.counters.clear();
    this.libraryCounters.clear();

    for (const [kind, label] of Object.entries(KIND_LABELS) as Array<[ObjectKind, string]>) {
      let highest = 0;
      const pattern = new RegExp(`^${label} (\\d+)$`);

      for (const name of names) {
        const match = name.match(pattern);
        if (match) highest = Math.max(highest, Number.parseInt(match[1], 10));
      }

      if (highest > 0) this.counters.set(kind, highest);
    }
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
