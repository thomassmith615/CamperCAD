import * as THREE from 'three';
import type { VehicleWeightSpec } from '@/analysis/WeightTypes';

/** Instrument cyan for axles; amber for the centre of gravity. */
const AXLE_COLOR = 0x4fd0d8;
const CG_COLOR = 0xe2a44a;
const CG_OVER_COLOR = 0xe2685a;

/** Half-width of the drawn axle lines, in inches. */
const AXLE_HALF_WIDTH = 42;

/** Radius of the centre-of-gravity marker sphere, in inches. */
const CG_RADIUS = 1.6;

/**
 * Draws the axle lines and the build's centre of gravity.
 *
 * The number in the panel says the rear axle is at 96% of its rating; this
 * shows *why*. Seeing the CG marker sitting a foot behind the rear axle line
 * makes the fix obvious in a way a percentage does not, and it moves live as
 * the user drags the water tank.
 *
 * A vertical drop line runs from the marker to the floor, because a point
 * floating in a 3D view has no readable position on its own — the drop line is
 * what lets the eye compare it against the axle.
 */
export class BalanceOverlay {
  readonly group = new THREE.Group();

  private readonly axleLines: THREE.LineSegments;
  private readonly axleMaterial: THREE.LineBasicMaterial;
  private readonly marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly dropLine: THREE.Line;
  private readonly dropMaterial: THREE.LineBasicMaterial;

  constructor() {
    this.group.name = 'Balance';
    this.group.renderOrder = 996;
    this.group.visible = false;

    this.axleMaterial = new THREE.LineBasicMaterial({
      color: AXLE_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.75,
    });
    this.axleLines = new THREE.LineSegments(new THREE.BufferGeometry(), this.axleMaterial);
    this.axleLines.frustumCulled = false;
    this.axleLines.renderOrder = 996;

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(CG_RADIUS, 16, 12),
      new THREE.MeshBasicMaterial({ color: CG_COLOR, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.marker.renderOrder = 996;
    this.marker.visible = false;

    this.dropMaterial = new THREE.LineBasicMaterial({
      color: CG_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.55,
    });
    this.dropLine = new THREE.Line(new THREE.BufferGeometry(), this.dropMaterial);
    this.dropLine.frustumCulled = false;
    this.dropLine.renderOrder = 996;
    this.dropLine.visible = false;

    this.group.add(this.axleLines, this.marker, this.dropLine);
  }

  /** True while the overlay is drawn. */
  get visible(): boolean {
    return this.group.visible;
  }

  /** Shows or hides the whole overlay. */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** Rebuilds the axle lines for a vehicle's geometry. */
  setAxles(spec: VehicleWeightSpec): void {
    const points: number[] = [];

    for (const z of [spec.frontAxleZ, spec.rearAxleZ]) {
      points.push(-AXLE_HALF_WIDTH, 0.2, z, AXLE_HALF_WIDTH, 0.2, z);
      // Short vertical ticks at each end, so the line reads as an axle rather
      // than as another grid line.
      points.push(-AXLE_HALF_WIDTH, 0.2, z, -AXLE_HALF_WIDTH, 6, z);
      points.push(AXLE_HALF_WIDTH, 0.2, z, AXLE_HALF_WIDTH, 6, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.axleLines.geometry.dispose();
    this.axleLines.geometry = geometry;
  }

  /**
   * Positions the centre-of-gravity marker.
   *
   * @param centre Build centre of gravity, or null when nothing is placed.
   * @param over True when any rating is exceeded, which turns the marker red.
   */
  setCentre(centre: { x: number; y: number; z: number } | null, over: boolean): void {
    if (!centre) {
      this.marker.visible = false;
      this.dropLine.visible = false;
      return;
    }

    this.marker.visible = true;
    this.dropLine.visible = true;
    this.marker.position.set(centre.x, centre.y, centre.z);

    const color = over ? CG_OVER_COLOR : CG_COLOR;
    this.marker.material.color.setHex(color);
    this.dropMaterial.color.setHex(color);

    this.dropLine.geometry.setFromPoints([
      new THREE.Vector3(centre.x, 0, centre.z),
      new THREE.Vector3(centre.x, centre.y, centre.z),
    ]);
    this.dropLine.geometry.computeBoundingSphere();
  }

  /** Releases geometry and materials. */
  dispose(): void {
    this.axleLines.geometry.dispose();
    this.axleMaterial.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.dropLine.geometry.dispose();
    this.dropMaterial.dispose();
  }
}
