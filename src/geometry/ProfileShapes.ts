import * as THREE from 'three';

/**
 * A closed polygon in the horizontal plane, in inches.
 *
 * Points are `[x, z]` pairs in the van's own axes — `x` across the vehicle, `z`
 * fore and aft — so a profile drawn here reads the same way it does in top
 * view. Winding is not significant; the builder triangulates either direction.
 *
 * Profiles are stored in **inches rather than normalised units** because they
 * are authored: a user types "24 by 36 with a 6 inch notch", and round-tripping
 * that through a 0..1 space would leave them editing numbers that mean nothing.
 * Normalisation happens when the geometry is built.
 */
export type ProfilePoint = [number, number];

/** A named profile the user can start from. */
export interface ProfilePreset {
  id: string;
  name: string;
  /** One line on what this shape is for in a van build. */
  description: string;
  /** Builds the polygon at a nominal size. */
  build(): ProfilePoint[];
}

/** Minimum number of points a usable profile needs. */
export const MIN_PROFILE_POINTS = 3;

/**
 * Signed area of a polygon, doubled.
 *
 * Used to reject degenerate profiles — three collinear points have zero area
 * and would triangulate into nothing, leaving an invisible object the user
 * cannot select or delete.
 */
export function profileArea(points: readonly ProfilePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    sum += x1 * z2 - x2 * z1;
  }
  return Math.abs(sum) / 2;
}

/** True when a profile can produce visible geometry. */
export function isProfileUsable(points: readonly ProfilePoint[]): boolean {
  return points.length >= MIN_PROFILE_POINTS && profileArea(points) > 0.01;
}

/** Bounding extent of a profile, in inches. */
export function profileBounds(points: readonly ProfilePoint[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

/**
 * Builds extrusion geometry normalised into the unit box.
 *
 * The profile is centred and scaled so the result spans −0.5 to 0.5 on X and Z
 * and 0 to 1 on Y, matching every other object kind. That is what lets the
 * object's mesh scale continue to mean width, height and depth: the caller sets
 * scale from the profile's own bounds, and the geometry stretches to fit.
 *
 * @param points Closed polygon in inches.
 * @returns Geometry, or null when the profile is degenerate.
 */
export function buildExtrusionGeometry(points: readonly ProfilePoint[]): THREE.BufferGeometry | null {
  if (!isProfileUsable(points)) return null;

  const bounds = profileBounds(points);
  const width = bounds.width || 1;
  const depth = bounds.depth || 1;
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;

  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => {
    const u = (x - centreX) / width;
    const v = (z - centreZ) / depth;
    if (index === 0) shape.moveTo(u, v);
    else shape.lineTo(u, v);
  });
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 4 });

  // ExtrudeGeometry builds in the XY plane and extrudes along +Z. Rotating a
  // quarter turn about X puts the profile in XZ and the extrusion along +Y,
  // then the translate restores the bottom-face-centre origin every kind uses.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const box = geometry.boundingBox;
  if (box) geometry.translate(0, -box.min.y, 0);

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Rectangle helper used by several presets. */
function rectangle(width: number, depth: number): ProfilePoint[] {
  return [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ];
}

/**
 * Profiles a van build actually needs.
 *
 * Every one of these exists because a rectangle cannot express it: a galley
 * that wraps a corner, a counter that clears a wheel well, a base that follows
 * the tumblehome of the wall. These are the shapes that force people out of CAD
 * and onto cardboard templates.
 */
export const PROFILE_PRESETS: readonly ProfilePreset[] = [
  {
    id: 'rectangle',
    name: 'Rectangle',
    description: 'Plain rectangular footprint.',
    build: () => rectangle(36, 20),
  },
  {
    id: 'l-shape',
    name: 'L-shape',
    description: 'Galley that wraps a corner, or a counter returning along the bulkhead.',
    build: () => [
      [0, 0],
      [60, 0],
      [60, 20],
      [20, 20],
      [20, 44],
      [0, 44],
    ],
  },
  {
    id: 'wheel-well-notch',
    name: 'Wheel-well notch',
    description: 'Rectangle with a corner cut away to clear a wheel well.',
    build: () => [
      [0, 0],
      [48, 0],
      [48, 24],
      [10, 24],
      [10, 9],
      [0, 9],
    ],
  },
  {
    id: 'angled-front',
    name: 'Angled front',
    description: 'Chamfered corner that keeps a walkway clear past a galley end.',
    build: () => [
      [0, 0],
      [36, 0],
      [36, 14],
      [26, 22],
      [0, 22],
    ],
  },
  {
    id: 'tapered-wall',
    name: 'Tapered',
    description: 'Narrower at one end, to follow the wall as it curves inward.',
    build: () => [
      [0, 0],
      [40, 0],
      [40, 22],
      [0, 17],
    ],
  },
];

/** Looks up a preset by id. */
export function findProfilePreset(id: string): ProfilePreset | undefined {
  return PROFILE_PRESETS.find((preset) => preset.id === id);
}
