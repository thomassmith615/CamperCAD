/**
 * Data model for user-placed objects.
 *
 * Two representations exist deliberately. {@link ObjectProperties} is a **flat**
 * map of scalar values used by the inspector and by the undo system: because
 * every editable thing about an object is one named scalar, a single property
 * command and a single field widget cover the entire inspector, and adding a
 * property later means adding one entry here rather than a new command class.
 *
 * {@link ObjectData} is the serialisation shape. It is nested and versioned,
 * because a saved project must stay readable across releases while the flat
 * property map is free to change with the UI.
 */

/**
 * Kinds of object the factory can create.
 *
 * A kind is a *geometry* distinction, not a semantic one. A water tank and a
 * cabinet are both boxes; a round tank and a pipe are both cylinders. Semantics
 * come from the library item that created the object, not from its kind.
 */
export type ObjectKind = 'box' | 'cylinder' | 'panel' | 'extrusion';

/** Every kind, in menu order. */
export const OBJECT_KINDS: readonly ObjectKind[] = ['box', 'cylinder', 'panel', 'extrusion'];

/**
 * Every editable property of an object, flattened to scalars.
 *
 * Lengths are inches, angles are radians, and colours are `#rrggbb` strings.
 * These are internal units: conversion for display happens in the field widget.
 */
export interface ObjectProperties {
  name: string;
  color: string;
  width: number;
  height: number;
  depth: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  weight: number;
  price: number;
  /**
   * Fluid capacity in US gallons. Zero for anything that is not a tank.
   *
   * Kept separate from weight because a tank has two weights that matter — dry
   * and full — and conflating them is how a build ends up over its rear axle
   * rating on the first trip.
   */
  capacityGallons: number;
  /** How full the tank currently is, in US gallons. Never exceeds capacity. */
  fillGallons: number;
  notes: string;
  locked: boolean;
  visible: boolean;
  /** Layer the object belongs to. Always a valid layer id. */
  layerId: string;
  /** Group the object belongs to, or an empty string when ungrouped. */
  groupId: string;
}

/**
 * Default proportions per kind, in inches.
 *
 * A panel defaults to three-quarter ply thickness because that is what almost
 * every partition, shelf and cabinet side in a conversion is cut from.
 */
export const KIND_DEFAULT_SIZE: Record<ObjectKind, [number, number, number]> = {
  box: [24, 30, 24],
  cylinder: [14, 20, 14],
  panel: [36, 24, 0.75],
  extrusion: [36, 30, 20],
};

/** Name of any editable property. */
export type ObjectPropertyKey = keyof ObjectProperties;

/** The value types a property can hold. */
export type ObjectPropertyValue = string | number | boolean;

/**
 * Serialisable form of an object.
 *
 * `schema` is written on save and checked on load. It is bumped only when the
 * shape changes incompatibly, so old projects can be migrated rather than
 * rejected.
 */
export interface ObjectData {
  schema: 1;
  id: string;
  kind: ObjectKind;
  name: string;
  /** Width, height, depth in inches. */
  dimensions: [number, number, number];
  /** Position of the object's origin: bottom face centre, in inches. */
  position: [number, number, number];
  /** Euler XYZ rotation in radians. */
  rotation: [number, number, number];
  color: string;
  weight: number;
  price: number;
  /** Fluid capacity in US gallons. Absent in projects saved before tanks. */
  capacityGallons?: number;
  /** Current fill in US gallons. */
  fillGallons?: number;
  notes: string;
  locked: boolean;
  visible: boolean;
  /** Layer membership. Optional so projects saved before layers still load. */
  layerId?: string;
  /** Group membership, empty when ungrouped. */
  groupId?: string;
  /**
   * Polygon profile for extrusions, as `[x, z]` pairs in inches. Absent for
   * every other kind.
   */
  profile?: Array<[number, number]>;
}

/**
 * The part of an object's state that a gizmo drag changes.
 *
 * Captured on drag start and drag end so the whole gesture becomes one undo
 * step rather than one per frame.
 */
export interface TransformSnapshot {
  position: [number, number, number];
  rotation: [number, number, number];
  dimensions: [number, number, number];
}

/** Smallest dimension an object may be scaled to, in inches. */
export const MIN_DIMENSION = 0.25;
