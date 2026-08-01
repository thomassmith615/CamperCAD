import * as THREE from 'three';
import type { ObjectKind } from '@/objects/ObjectTypes';
import { buildExtrusionGeometry, type ProfilePoint } from './ProfileShapes';

/** Radial segments used for cylinders. */
const CYLINDER_SEGMENTS = 32;

/**
 * Descriptive metadata about a kind, for the UI and for later systems.
 */
export interface KindInfo {
  /** Label shown in menus and the inspector. */
  label: string;
  /** What the three scale axes mean for this kind. */
  dimensionLabels: [string, string, string];
  /** True when the kind carries an editable polygon profile. */
  hasProfile: boolean;
  /**
   * True when the kind is a flat sheet good — plywood, ply panel, worktop.
   * The cut list in a later milestone keys off this.
   */
  isSheet: boolean;
}

/** Metadata for every kind. */
export const KIND_INFO: Record<ObjectKind, KindInfo> = {
  box: {
    label: 'Box',
    dimensionLabels: ['Width', 'Height', 'Depth'],
    hasProfile: false,
    isSheet: false,
  },
  cylinder: {
    label: 'Cylinder',
    dimensionLabels: ['Diameter', 'Height', 'Diameter'],
    hasProfile: false,
    isSheet: false,
  },
  panel: {
    label: 'Panel',
    dimensionLabels: ['Width', 'Height', 'Thickness'],
    hasProfile: false,
    isSheet: true,
  },
  extrusion: {
    label: 'Extrusion',
    dimensionLabels: ['Width', 'Height', 'Depth'],
    hasProfile: true,
    isSheet: false,
  },
};

/**
 * Owns the unit geometry every object kind is built from.
 *
 * ## The unit-box contract
 *
 * Every geometry produced here spans **−0.5 to 0.5 on X and Z, and 0 to 1 on
 * Y**. That single rule is what lets an object's mesh scale continue to mean
 * width, height and depth no matter what shape it is: a cylinder scaled to
 * `(12, 30, 12)` is a 12 inch diameter, 30 inch tall cylinder, and a cabinet
 * scaled the same way is a 12 by 30 by 12 box. Snapping, clearances, bounding
 * boxes and the inspector all keep working without learning about shapes.
 *
 * Origin at the bottom face centre carries over too, so `position.y === 0`
 * still means "on the floor" for every kind.
 *
 * ## Sharing
 *
 * Kinds with fixed geometry share one instance across every object, so a
 * hundred cylinders cost one buffer. Extrusions cannot share — each carries its
 * own polygon — so they build per object and dispose with it.
 */
export class GeometryRegistry {
  private readonly shared = new Map<ObjectKind, THREE.BufferGeometry>();
  private readonly sharedEdges = new Map<ObjectKind, THREE.BufferGeometry>();

  /**
   * Returns geometry for a kind.
   *
   * @param kind Kind to build.
   * @param profile Polygon for extrusions, ignored by other kinds.
   * @returns The geometry, and whether the caller owns it. Owned geometry must
   * be disposed with the object; shared geometry must never be.
   */
  create(kind: ObjectKind, profile?: readonly ProfilePoint[]): { geometry: THREE.BufferGeometry; owned: boolean } {
    if (kind === 'extrusion') {
      const geometry = (profile && buildExtrusionGeometry(profile)) ?? GeometryRegistry.fallbackBox();
      return { geometry, owned: true };
    }

    return { geometry: this.sharedFor(kind), owned: false };
  }

  /**
   * Returns edge geometry for the selection outline.
   *
   * Extrusions build their own from the supplied profile; everything else
   * shares. A cylinder's edges are its two rims plus the silhouette-defining
   * verticals, which is what `EdgesGeometry` produces at this segment count and
   * reads correctly as a selected cylinder.
   */
  createEdges(
    kind: ObjectKind,
    profile?: readonly ProfilePoint[],
  ): { geometry: THREE.BufferGeometry; owned: boolean } {
    if (kind === 'extrusion') {
      const source = (profile && buildExtrusionGeometry(profile)) ?? GeometryRegistry.fallbackBox();
      const edges = new THREE.EdgesGeometry(source, 20);
      source.dispose();
      return { geometry: edges, owned: true };
    }

    let edges = this.sharedEdges.get(kind);
    if (!edges) {
      edges = new THREE.EdgesGeometry(this.sharedFor(kind), 20);
      this.sharedEdges.set(kind, edges);
    }
    return { geometry: edges, owned: false };
  }

  /** Releases every shared geometry. */
  dispose(): void {
    for (const geometry of this.shared.values()) geometry.dispose();
    for (const geometry of this.sharedEdges.values()) geometry.dispose();
    this.shared.clear();
    this.sharedEdges.clear();
  }

  /** Builds or returns the shared geometry for a fixed kind. */
  private sharedFor(kind: ObjectKind): THREE.BufferGeometry {
    let geometry = this.shared.get(kind);
    if (geometry) return geometry;

    switch (kind) {
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, CYLINDER_SEGMENTS).translate(0, 0.5, 0);
        break;
      case 'box':
      case 'panel':
      case 'extrusion':
      default:
        geometry = GeometryRegistry.fallbackBox();
        break;
    }

    this.shared.set(kind, geometry);
    return geometry;
  }

  /**
   * The unit box.
   *
   * Also stands in for an extrusion whose profile is unusable, so a bad polygon
   * produces a visible, selectable, deletable object rather than an invisible
   * one the user cannot get rid of.
   */
  private static fallbackBox(): THREE.BufferGeometry {
    return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  }
}
