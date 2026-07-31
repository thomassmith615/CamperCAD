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

/** Kinds of object the factory can create. Extended per object-library entry. */
export type ObjectKind = 'box';

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
  notes: string;
  locked: boolean;
  visible: boolean;
}

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
  notes: string;
  locked: boolean;
  visible: boolean;
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

/** Default size of a newly created box, in inches. */
export const DEFAULT_BOX_SIZE: [number, number, number] = [24, 30, 24];
