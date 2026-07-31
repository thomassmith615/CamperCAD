import type { EventBus } from '@/core/EventBus';
import type { AppEvents } from '@/core/AppEvents';
import type { ObjectStore } from './ObjectStore';
import type { SceneObject } from './SceneObject';
import { DEFAULT_LAYERS, DEFAULT_LAYER_ID, type GroupData, type LayerData } from './StructureTypes';

/** Colours cycled through when a new layer is created. */
const LAYER_COLORS = ['#e2a44a', '#4fd0d8', '#4a7fa5', '#8fbf6a', '#c98fd4', '#e2685a'];

/**
 * Owns the design's layers and groups.
 *
 * Membership is stored **on the objects**, not here: an object holds its layer
 * id and its group id, and this class indexes over the store to answer
 * membership questions. That direction matters because objects are the things
 * that get serialised, duplicated and undone — keeping a second copy of
 * membership here would give the undo system two places to keep in step and it
 * would eventually fail to.
 *
 * The consequence is that group and layer queries walk the object list. At van
 * scale, a few hundred objects, that is far cheaper than the bookkeeping the
 * alternative would need.
 */
export class StructureRegistry {
  private readonly store: ObjectStore;
  private readonly bus: EventBus<AppEvents>;

  private layerList: LayerData[] = DEFAULT_LAYERS.map((layer) => ({ ...layer }));
  private groupList: GroupData[] = [];
  private counter = 0;

  constructor(store: ObjectStore, bus: EventBus<AppEvents>) {
    this.store = store;
    this.bus = bus;
  }

  /** Every layer, in display order. */
  get layers(): readonly LayerData[] {
    return this.layerList;
  }

  /** Every group, in creation order. */
  get groups(): readonly GroupData[] {
    return this.groupList;
  }

  /** Looks up a layer. */
  layer(id: string): LayerData | undefined {
    return this.layerList.find((layer) => layer.id === id);
  }

  /** Looks up a group. */
  group(id: string): GroupData | undefined {
    return this.groupList.find((group) => group.id === id);
  }

  /**
   * The layer an object belongs to.
   *
   * Falls back to the default layer when an object references a layer that no
   * longer exists, which is what a project saved before a layer was deleted
   * looks like.
   */
  layerOf(object: SceneObject): LayerData {
    return this.layer(object.get('layerId')) ?? this.layerList[0];
  }

  /** Objects belonging to a layer, in store order. */
  objectsInLayer(layerId: string): SceneObject[] {
    return this.store.all().filter((object) => object.get('layerId') === layerId);
  }

  /** Objects belonging to a group, in store order. */
  objectsInGroup(groupId: string): SceneObject[] {
    return this.store.all().filter((object) => object.get('groupId') === groupId);
  }

  /**
   * Expands a selection to whole groups.
   *
   * Used by the selection manager: clicking one member of a group selects the
   * group, because that is what having grouped them meant.
   */
  expandToGroups(objects: readonly SceneObject[]): SceneObject[] {
    const result = new Map<string, SceneObject>();

    for (const object of objects) {
      result.set(object.id, object);

      const groupId = object.get('groupId');
      if (groupId === '') continue;

      for (const member of this.objectsInGroup(groupId)) result.set(member.id, member);
    }

    return [...result.values()];
  }

  /**
   * True when the object cannot be transformed.
   *
   * Lock is inherited: an object in a locked layer is locked even if its own
   * flag is clear. Inheritance runs one way only — unlocking a layer does not
   * unlock an object the user locked individually.
   */
  isLocked(object: SceneObject): boolean {
    return object.get('locked') || this.layerOf(object).locked;
  }

  /** True when the object should currently be drawn. */
  isVisible(object: SceneObject): boolean {
    return object.get('visible') && this.layerOf(object).visible;
  }

  /** Creates a layer and returns it. */
  addLayer(name?: string): LayerData {
    this.counter += 1;
    const layer: LayerData = {
      id: `layer-${Date.now().toString(36)}-${this.counter}`,
      name: name ?? `Layer ${this.layerList.length + 1}`,
      visible: true,
      locked: false,
      color: LAYER_COLORS[this.layerList.length % LAYER_COLORS.length],
    };
    this.layerList.push(layer);
    this.announce();
    return layer;
  }

  /**
   * Deletes a layer, moving its objects to the default layer.
   *
   * Objects are never deleted with their layer. Deleting a layer is an
   * organisational act, and losing a fridge because it was filed under the
   * wrong heading would be indefensible.
   *
   * @returns False when the layer is the last one, which cannot be removed.
   */
  removeLayer(id: string): boolean {
    if (this.layerList.length <= 1) return false;

    const index = this.layerList.findIndex((layer) => layer.id === id);
    if (index === -1) return false;

    const fallback = this.layerList.find((layer) => layer.id !== id) ?? this.layerList[0];
    for (const object of this.objectsInLayer(id)) {
      object.set('layerId', fallback.id);
      this.store.notifyChanged(object, 'layerId');
    }

    this.layerList.splice(index, 1);
    this.announce();
    return true;
  }

  /** Applies a partial update to a layer. */
  updateLayer(id: string, changes: Partial<Omit<LayerData, 'id'>>): void {
    const layer = this.layer(id);
    if (!layer) return;

    Object.assign(layer, changes);
    this.applyLayerState(layer);
    this.announce();
  }

  /** Moves objects onto a layer. */
  assignLayer(objects: readonly SceneObject[], layerId: string): void {
    if (!this.layer(layerId)) return;

    for (const object of objects) {
      object.set('layerId', layerId);
      this.store.notifyChanged(object, 'layerId');
    }
    this.refreshVisibility();
    this.announce();
  }

  /**
   * Groups objects together.
   *
   * Objects already in another group leave it first, so a group is always a
   * partition rather than an overlapping set. Nested groups are not supported:
   * they would need a tree, and a van build has not needed one.
   *
   * @returns The new group, or null when fewer than two objects were given.
   */
  createGroup(objects: readonly SceneObject[], name?: string): GroupData | null {
    if (objects.length < 2) return null;

    this.counter += 1;
    const group: GroupData = {
      id: `group-${Date.now().toString(36)}-${this.counter}`,
      name: name ?? `Group ${this.groupList.length + 1}`,
      collapsed: true,
    };

    this.groupList.push(group);
    for (const object of objects) {
      object.set('groupId', group.id);
      this.store.notifyChanged(object, 'groupId');
    }

    this.announce();
    return group;
  }

  /** Dissolves a group, leaving its members in place. */
  removeGroup(id: string): void {
    const index = this.groupList.findIndex((group) => group.id === id);
    if (index === -1) return;

    for (const object of this.objectsInGroup(id)) {
      object.set('groupId', '');
      this.store.notifyChanged(object, 'groupId');
    }

    this.groupList.splice(index, 1);
    this.announce();
  }

  /** Applies a partial update to a group. */
  updateGroup(id: string, changes: Partial<Omit<GroupData, 'id'>>): void {
    const group = this.group(id);
    if (!group) return;
    Object.assign(group, changes);
    this.announce();
  }

  /**
   * Drops groups that no longer have at least two members.
   *
   * Deleting objects can leave a group with one member or none, which is no
   * longer a group in any meaningful sense.
   */
  pruneGroups(): void {
    const survivors = this.groupList.filter((group) => this.objectsInGroup(group.id).length >= 2);
    if (survivors.length === this.groupList.length) return;

    for (const group of this.groupList) {
      if (survivors.includes(group)) continue;
      for (const object of this.objectsInGroup(group.id)) {
        object.set('groupId', '');
      }
    }

    this.groupList = survivors;
    this.announce();
  }

  /** Reapplies inherited visibility to every object. */
  refreshVisibility(): void {
    for (const layer of this.layerList) this.applyLayerState(layer);
  }

  /** Serialisable snapshot of the structure. */
  toData(): { layers: LayerData[]; groups: GroupData[] } {
    return {
      layers: this.layerList.map((layer) => ({ ...layer })),
      groups: this.groupList.map((group) => ({ ...group })),
    };
  }

  /**
   * Replaces the structure wholesale, used when loading a project.
   *
   * A project with no layers gets the defaults rather than an empty list, since
   * an object must always have a layer to belong to.
   */
  applyData(layers: readonly LayerData[], groups: readonly GroupData[]): void {
    this.layerList = layers.length > 0 ? layers.map((layer) => ({ ...layer })) : DEFAULT_LAYERS.map((l) => ({ ...l }));
    this.groupList = groups.map((group) => ({ ...group }));
    this.refreshVisibility();
    this.announce();
  }

  /** Resets to a new project's defaults. */
  reset(): void {
    this.layerList = DEFAULT_LAYERS.map((layer) => ({ ...layer }));
    this.groupList = [];
    this.announce();
  }

  /** Id of the layer new objects should join. */
  get defaultLayerId(): string {
    return this.layer(DEFAULT_LAYER_ID)?.id ?? this.layerList[0].id;
  }

  /** Pushes a layer's visibility onto the meshes of its members. */
  private applyLayerState(layer: LayerData): void {
    for (const object of this.objectsInLayer(layer.id)) {
      object.mesh.visible = object.get('visible') && layer.visible;
    }
  }

  /** Publishes the current structure. */
  private announce(): void {
    this.bus.emit('structure:changed', {
      layers: this.layerList.map((layer) => ({ ...layer })),
      groups: this.groupList.map((group) => ({ ...group })),
    });
  }
}
