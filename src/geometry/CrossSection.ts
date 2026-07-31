import * as THREE from 'three';

/**
 * A vehicle's interior cross-section, sampled into a polyline.
 *
 * Control points run from the **right** (passenger side) floor edge, up the
 * wall, across the ceiling and down to the **left** floor edge. They are
 * interpolated with a centripetal Catmull-Rom spline, which reproduces the
 * ProMaster's bulged sidewalls and crowned roof from a handful of measured
 * points without the overshoot a uniform spline produces at the shoulder.
 *
 * The class exists because the sweep needs three things a raw point list cannot
 * give: cumulative arc length (the parameter openings are cut in), the ability
 * to guarantee a vertex exists exactly at an opening edge, and a mapping from a
 * height above the floor to that parameter.
 */
export class CrossSection {
  private points: THREE.Vector2[];
  private lengths: number[];
  private apexIndex = 0;

  /**
   * @param controlPoints Measured section points, right floor edge first.
   * @param samples Number of polyline vertices to generate.
   */
  constructor(controlPoints: readonly THREE.Vector2[], samples = 96) {
    if (controlPoints.length < 3) {
      throw new Error('CrossSection requires at least three control points');
    }

    const curve = new THREE.CatmullRomCurve3(
      controlPoints.map((p) => new THREE.Vector3(p.x, p.y, 0)),
      false,
      'centripetal',
      0.5,
    );

    this.points = curve.getSpacedPoints(samples).map((p) => new THREE.Vector2(p.x, p.y));
    this.lengths = [];
    this.recomputeLengths();
  }

  /** Polyline vertices, ordered right floor edge to left floor edge. */
  get vertices(): readonly THREE.Vector2[] {
    return this.points;
  }

  /** Cumulative arc length at each vertex, in inches. */
  get arcLengths(): readonly number[] {
    return this.lengths;
  }

  /** Total developed length of the section, in inches. */
  get totalLength(): number {
    return this.lengths[this.lengths.length - 1];
  }

  /** Highest point of the section — the interior standing height. */
  get peakHeight(): number {
    return this.points[this.apexIndex].y;
  }

  /** Widest interior dimension and the height it occurs at. */
  maximumWidth(): { width: number; height: number } {
    let best = this.points[0];
    for (const point of this.points) {
      if (Math.abs(point.x) > Math.abs(best.x)) best = point;
    }
    return { width: Math.abs(best.x) * 2, height: best.y };
  }

  /** Interior width at a given height above the floor, in inches. */
  widthAtHeight(height: number): number {
    const right = this.pointAtHeight('right', height);
    const left = this.pointAtHeight('left', height);
    if (!right || !left) return 0;
    return right.point.x - left.point.x;
  }

  /**
   * Arc length at which the given wall reaches `height`.
   *
   * @param side Which wall to walk — 'right' is +X, 'left' is -X.
   * @param height Height above the floor in inches.
   * @returns Arc length in inches, or null when the wall never reaches it.
   */
  arcLengthAtHeight(side: 'left' | 'right', height: number): number | null {
    return this.pointAtHeight(side, height)?.arcLength ?? null;
  }

  /**
   * Guarantees a vertex exists at `arcLength`, inserting an interpolated one if
   * necessary. Openings call this for each of their edges so cut boundaries land
   * exactly on the requested height rather than the nearest sample.
   *
   * @returns The index of the vertex at that arc length.
   */
  insertAtArcLength(arcLength: number): number {
    const total = this.totalLength;
    if (arcLength <= 0) return 0;
    if (arcLength >= total) return this.points.length - 1;

    for (let i = 0; i < this.lengths.length; i += 1) {
      if (Math.abs(this.lengths[i] - arcLength) < 1e-4) return i;
      if (this.lengths[i] > arcLength) {
        const previous = i - 1;
        const span = this.lengths[i] - this.lengths[previous];
        const t = span === 0 ? 0 : (arcLength - this.lengths[previous]) / span;
        const point = this.points[previous].clone().lerp(this.points[i], t);
        this.points.splice(i, 0, point);
        this.lengths.splice(i, 0, arcLength);
        this.updateApex();
        return i;
      }
    }
    return this.points.length - 1;
  }

  /**
   * Inward-facing unit normal at each vertex.
   *
   * Segment normals are the tangent rotated a quarter turn; because the profile
   * is traversed right-to-left over the top, that rotation always points into
   * the cabin. Vertex normals average their adjacent segments so the swept
   * surface shades smoothly around the shoulder.
   */
  inwardNormals(): THREE.Vector2[] {
    const segments: THREE.Vector2[] = [];
    for (let i = 0; i < this.points.length - 1; i += 1) {
      const tangent = this.points[i + 1].clone().sub(this.points[i]).normalize();
      segments.push(new THREE.Vector2(-tangent.y, tangent.x));
    }

    return this.points.map((_, i) => {
      const before = segments[Math.max(0, i - 1)];
      const after = segments[Math.min(segments.length - 1, i)];
      return before.clone().add(after).normalize();
    });
  }

  /**
   * Closed outline of the section including the floor, ordered for use as a
   * `THREE.Shape`. Used for the rear and bulkhead panels.
   */
  outline(): THREE.Vector2[] {
    return this.points.map((p) => p.clone());
  }

  /** Finds the vertex-interpolated point where a wall reaches `height`. */
  private pointAtHeight(
    side: 'left' | 'right',
    height: number,
  ): { point: THREE.Vector2; arcLength: number } | null {
    const start = side === 'right' ? 0 : this.apexIndex;
    const end = side === 'right' ? this.apexIndex : this.points.length - 1;

    for (let i = start; i < end; i += 1) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const low = Math.min(a.y, b.y);
      const high = Math.max(a.y, b.y);
      if (height < low || height > high) continue;

      const span = b.y - a.y;
      const t = Math.abs(span) < 1e-6 ? 0 : (height - a.y) / span;
      return {
        point: a.clone().lerp(b, t),
        arcLength: THREE.MathUtils.lerp(this.lengths[i], this.lengths[i + 1], t),
      };
    }
    return null;
  }

  /** Rebuilds cumulative arc lengths and the apex index from scratch. */
  private recomputeLengths(): void {
    this.lengths = [0];
    for (let i = 1; i < this.points.length; i += 1) {
      this.lengths.push(this.lengths[i - 1] + this.points[i].distanceTo(this.points[i - 1]));
    }
    this.updateApex();
  }

  /** Records which vertex is highest; it separates the right wall from left. */
  private updateApex(): void {
    let index = 0;
    for (let i = 1; i < this.points.length; i += 1) {
      if (this.points[i].y > this.points[index].y) index = i;
    }
    this.apexIndex = index;
  }
}
