import * as THREE from 'three';
import type { CrossSection } from './CrossSection';

/**
 * A rectangular hole in a swept surface, expressed in the sweep's own
 * parameters: arc length along the cross-section and distance along the sweep
 * axis. Door and window openings are described this way because a van's walls
 * are curved — a hole defined in world X/Y would not follow the surface.
 */
export interface SweepOpening {
  /** Lower arc-length bound, inches from the right floor edge. */
  sMin: number;
  /** Upper arc-length bound, inches from the right floor edge. */
  sMax: number;
  /** Front bound along the sweep axis, inches. */
  zMin: number;
  /** Rear bound along the sweep axis, inches. */
  zMax: number;
}

/** Configuration for {@link sweepCrossSection}. */
export interface SweepOptions {
  /** Sweep start on the Z axis (front of the vehicle). */
  zStart: number;
  /** Sweep end on the Z axis (rear of the vehicle). */
  zEnd: number;
  /** Baseline number of divisions along Z before opening edges are added. */
  segments?: number;
  /** Holes to cut. Their edges are inserted exactly, not snapped to samples. */
  openings?: readonly SweepOpening[];
}

/** Merges a value into a sorted list unless an equal value is already present. */
function insertSorted(values: number[], value: number, epsilon = 1e-4): void {
  for (const existing of values) {
    if (Math.abs(existing - value) < epsilon) return;
  }
  values.push(value);
  values.sort((a, b) => a - b);
}

/**
 * Sweeps a cross-section along the Z axis into a single-sided interior surface.
 *
 * Rather than performing CSG, openings are cut by omitting the quads that fall
 * inside them. Both the profile and the Z sample list are refined so that a
 * vertex line exists exactly on every opening edge, which makes the cut land on
 * the requested dimension — a 48.5" door opening measures 48.5" in the model.
 *
 * Normals face into the cabin, so the shell can be rendered with front-face
 * material and is transparent from outside, letting the user look into the van
 * without hiding walls manually.
 *
 * @param section Profile to sweep. It is refined in place at opening edges.
 * @param options Sweep extent, resolution and openings.
 * @returns An indexed `BufferGeometry` with positions, normals and UVs.
 */
export function sweepCrossSection(section: CrossSection, options: SweepOptions): THREE.BufferGeometry {
  const { zStart, zEnd, segments = 48, openings = [] } = options;

  for (const opening of openings) {
    section.insertAtArcLength(opening.sMin);
    section.insertAtArcLength(opening.sMax);
  }

  const zSamples: number[] = [];
  const divisions = Math.max(2, segments);
  for (let i = 0; i <= divisions; i += 1) {
    insertSorted(zSamples, THREE.MathUtils.lerp(zStart, zEnd, i / divisions));
  }
  for (const opening of openings) {
    if (opening.zMin > zStart && opening.zMin < zEnd) insertSorted(zSamples, opening.zMin);
    if (opening.zMax > zStart && opening.zMax < zEnd) insertSorted(zSamples, opening.zMax);
  }

  const profile = section.vertices;
  const arcLengths = section.arcLengths;
  const normals2d = section.inwardNormals();
  const totalLength = section.totalLength;
  const zSpan = zEnd - zStart || 1;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let j = 0; j < zSamples.length; j += 1) {
    const z = zSamples[j];
    for (let i = 0; i < profile.length; i += 1) {
      positions.push(profile[i].x, profile[i].y, z);
      normals.push(normals2d[i].x, normals2d[i].y, 0);
      uvs.push(arcLengths[i] / totalLength, (z - zStart) / zSpan);
    }
  }

  const rowStride = profile.length;
  const indices: number[] = [];

  const isCut = (s: number, z: number): boolean =>
    openings.some((o) => s > o.sMin && s < o.sMax && z > o.zMin && z < o.zMax);

  for (let j = 0; j < zSamples.length - 1; j += 1) {
    const zMid = (zSamples[j] + zSamples[j + 1]) / 2;
    for (let i = 0; i < rowStride - 1; i += 1) {
      const sMid = (arcLengths[i] + arcLengths[i + 1]) / 2;
      if (isCut(sMid, zMid)) continue;

      const a = j * rowStride + i;
      const b = (j + 1) * rowStride + i;
      const c = (j + 1) * rowStride + i + 1;
      const d = j * rowStride + i + 1;

      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Builds line geometry tracing the border of an opening on the swept surface.
 *
 * The vertical edges follow the curved profile rather than being straight, so
 * the outline sits exactly on the wall. Used to draw door and window frames.
 *
 * @param section Section the opening was cut from, already refined.
 * @param opening Opening to outline.
 */
export function openingOutline(section: CrossSection, opening: SweepOpening): THREE.BufferGeometry {
  const profile = section.vertices;
  const arcLengths = section.arcLengths;

  const spanIndices: number[] = [];
  for (let i = 0; i < profile.length; i += 1) {
    if (arcLengths[i] >= opening.sMin - 1e-4 && arcLengths[i] <= opening.sMax + 1e-4) {
      spanIndices.push(i);
    }
  }
  if (spanIndices.length < 2) return new THREE.BufferGeometry();

  const points: THREE.Vector3[] = [];
  for (const i of spanIndices) points.push(new THREE.Vector3(profile[i].x, profile[i].y, opening.zMin));
  for (const i of [...spanIndices].reverse()) {
    points.push(new THREE.Vector3(profile[i].x, profile[i].y, opening.zMax));
  }
  points.push(points[0].clone());

  return new THREE.BufferGeometry().setFromPoints(points);
}
