import type { StructureRegistry } from '@/objects/StructureRegistry';
import type { SceneObject } from '@/objects/SceneObject';
import type { GroupData } from '@/objects/StructureTypes';
import type { Command } from './Command';

/**
 * Binds objects into a group.
 *
 * Undo restores each object's **previous** group rather than clearing it, so
 * grouping objects that were already grouped elsewhere and then undoing puts
 * them back where they were instead of loose.
 */
export class GroupCommand implements Command {
  readonly label: string;

  private readonly registry: StructureRegistry;
  private readonly objects: readonly SceneObject[];
  private readonly previousGroups: readonly string[];
  private group: GroupData | null = null;
  private name: string | undefined;

  constructor(registry: StructureRegistry, objects: readonly SceneObject[], name?: string) {
    this.registry = registry;
    this.objects = objects;
    this.previousGroups = objects.map((object) => object.get('groupId'));
    this.name = name;
    this.label = `Group ${objects.length} objects`;
  }

  execute(): void {
    // Redo must reuse the original name so the outliner does not renumber.
    this.group = this.registry.createGroup(this.objects, this.name ?? this.group?.name);
    if (this.group) this.name = this.group.name;
  }

  undo(): void {
    if (this.group) this.registry.removeGroup(this.group.id);

    this.objects.forEach((object, index) => {
      const previous = this.previousGroups[index];
      if (previous !== '') object.set('groupId', previous);
    });
  }
}

/**
 * Dissolves a group.
 *
 * Undo recreates it from the same members. The group's identifier changes,
 * which nothing outside the registry depends on — objects reference it, and
 * they are updated together.
 */
export class UngroupCommand implements Command {
  readonly label = 'Ungroup';

  private readonly registry: StructureRegistry;
  private readonly members: readonly SceneObject[];
  private readonly name: string;
  private groupId: string;

  constructor(registry: StructureRegistry, groupId: string) {
    this.registry = registry;
    this.groupId = groupId;
    this.members = registry.objectsInGroup(groupId);
    this.name = registry.group(groupId)?.name ?? 'Group';
  }

  execute(): void {
    this.registry.removeGroup(this.groupId);
  }

  undo(): void {
    const restored = this.registry.createGroup(this.members, this.name);
    if (restored) this.groupId = restored.id;
  }
}

/**
 * Moves objects onto a layer.
 *
 * Each object's previous layer is recorded individually, because a selection
 * spanning three layers must return to three layers on undo.
 */
export class AssignLayerCommand implements Command {
  readonly label: string;

  private readonly registry: StructureRegistry;
  private readonly objects: readonly SceneObject[];
  private readonly previousLayers: readonly string[];
  private readonly layerId: string;

  constructor(registry: StructureRegistry, objects: readonly SceneObject[], layerId: string) {
    this.registry = registry;
    this.objects = objects;
    this.layerId = layerId;
    this.previousLayers = objects.map((object) => object.get('layerId'));
    this.label = `Move to ${registry.layer(layerId)?.name ?? 'layer'}`;
  }

  execute(): void {
    this.registry.assignLayer(this.objects, this.layerId);
  }

  undo(): void {
    // Grouped by destination so each distinct previous layer is restored in one
    // call rather than one call per object.
    const byLayer = new Map<string, SceneObject[]>();
    this.objects.forEach((object, index) => {
      const layerId = this.previousLayers[index];
      const bucket = byLayer.get(layerId);
      if (bucket) bucket.push(object);
      else byLayer.set(layerId, [object]);
    });

    for (const [layerId, objects] of byLayer) this.registry.assignLayer(objects, layerId);
  }
}
