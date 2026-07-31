import * as THREE from 'three';
import type { ObjectFactory } from '@/objects/ObjectFactory';
import type { SceneObject } from '@/objects/SceneObject';
import type { ArrayAxis, ArrayOptions } from '@/objects/StructureTypes';

/** Largest array a single operation will produce. */
export const MAX_ARRAY_COUNT = 60;

/**
 * Builds repeated copies of a selection along an axis.
 *
 * Two spacing modes exist because builders think in both. Roof fittings and
 * fasteners are laid out on **centres** — "every 16 inches" — while cabinets and
 * drawers are laid out by the **gap** between them, since the carcass width is
 * whatever it is and the space between is what has to work. Offering only
 * centre spacing would make the second case arithmetic the user has to do
 * themselves, on a number the application already knows.
 *
 * The result is plain objects added through the normal add command, so an
 * array is undone in one step and behaves like anything else afterwards.
 */
export class ArrayBuilder {
  private readonly factory: ObjectFactory;

  constructor(factory: ObjectFactory) {
    this.factory = factory;
  }

  /**
   * Creates the copies.
   *
   * @param sources Objects to repeat. Their combined extent along the axis
   * determines gap spacing, so repeating a cabinet and its countertop together
   * spaces them as one unit rather than overlapping them.
   * @param options Count, axis, distance and mode.
   * @returns The new objects, positioned but not yet added to the store.
   */
  build(sources: readonly SceneObject[], options: ArrayOptions): SceneObject[] {
    const count = Math.max(1, Math.min(MAX_ARRAY_COUNT, Math.floor(options.count)));
    if (sources.length === 0) return [];

    const step = this.stepFor(sources, options);
    if (Math.abs(step) < 1e-6) return [];

    const created: SceneObject[] = [];

    for (let index = 1; index <= count; index += 1) {
      const offset = new THREE.Vector3();
      offset[options.axis] = step * index;

      for (const source of sources) {
        const copy = this.factory.duplicate(source, 0);
        copy.mesh.position.add(offset);
        copy.mesh.updateMatrixWorld(true);
        created.push(copy);
      }
    }

    return created;
  }

  /**
   * Distance between successive copies.
   *
   * In gap mode this is the sources' own extent along the axis plus the
   * requested gap, which is what makes "half an inch between cabinets" produce
   * cabinets half an inch apart regardless of how wide they are.
   */
  private stepFor(sources: readonly SceneObject[], options: ArrayOptions): number {
    if (options.mode === 'spacing') return options.distance;
    return ArrayBuilder.extentAlong(sources, options.axis) + options.distance;
  }

  /** Combined world extent of the sources along one axis. */
  private static extentAlong(sources: readonly SceneObject[], axis: ArrayAxis): number {
    const bounds = new THREE.Box3();
    for (const source of sources) bounds.union(source.boundingBox());
    if (bounds.isEmpty()) return 0;
    return bounds.max[axis] - bounds.min[axis];
  }
}
