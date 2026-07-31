import * as THREE from 'three';

/** Grid spacings offered in imperial mode, in inches. */
export const IMPERIAL_SPACINGS = [1, 2, 5, 10] as const;

/** Grid spacings offered in metric mode, expressed in inches internally. */
export const METRIC_SPACINGS = [10 / 25.4, 25 / 25.4, 50 / 25.4, 100 / 25.4] as const;

/** Colour of the darkest grid lines and the fade destination. */
const BACKGROUND = new THREE.Color(0x14171c);
const MINOR_COLOR = new THREE.Color(0x2c333d);
const MAJOR_COLOR = new THREE.Color(0x414b58);
const AXIS_X_COLOR = new THREE.Color(0xa8574f);
const AXIS_Z_COLOR = new THREE.Color(0x4a7f6a);

/**
 * The ground-plane construction grid.
 *
 * Lines are generated into two batched `LineSegments` — minor and major — plus
 * a third for the two origin axes, so changing spacing costs one geometry
 * rebuild rather than thousands of objects. Colour is baked per vertex and
 * faded toward the background near the edges, which removes the hard rectangular
 * boundary a plain `GridHelper` shows without needing a custom shader.
 *
 * The grid sits marginally above the van floor so it remains visible inside the
 * vehicle while never z-fighting with it.
 */
export class GridManager {
  readonly group = new THREE.Group();

  private readonly minor: THREE.LineSegments;
  private readonly major: THREE.LineSegments;
  private readonly axes: THREE.LineSegments;

  private spacingValue: number;
  private extent: number;

  /**
   * @param spacing Initial line spacing in inches.
   * @param extent Half-width of the grid in inches; it spans ±extent on X and Z.
   */
  constructor(spacing = 1, extent = 240) {
    this.spacingValue = spacing;
    this.extent = extent;

    this.group.name = 'Grid';
    this.group.position.y = 0.05;
    this.group.renderOrder = -1;

    const material = () =>
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });

    this.minor = new THREE.LineSegments(new THREE.BufferGeometry(), material());
    this.major = new THREE.LineSegments(new THREE.BufferGeometry(), material());
    this.axes = new THREE.LineSegments(new THREE.BufferGeometry(), material());

    this.minor.frustumCulled = false;
    this.major.frustumCulled = false;
    this.axes.frustumCulled = false;

    this.group.add(this.minor, this.major, this.axes);
    this.rebuild();
  }

  /** Current spacing in inches. */
  get spacing(): number {
    return this.spacingValue;
  }

  /** Whether the grid is currently drawn. */
  get visible(): boolean {
    return this.group.visible;
  }

  /** Shows or hides the whole grid including axes. */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Changes line spacing.
   *
   * Very fine spacings over a large extent produce unreadable moiré and heavy
   * geometry, so the extent is reduced for spacings below 2 inches — the grid
   * stays useful for close-in work without covering forty feet of ground.
   */
  setSpacing(spacing: number): void {
    if (spacing <= 0 || spacing === this.spacingValue) return;
    this.spacingValue = spacing;
    this.extent = spacing < 2 ? 144 : 240;
    this.rebuild();
  }

  /** Releases geometry and materials. */
  dispose(): void {
    for (const line of [this.minor, this.major, this.axes]) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
  }

  /**
   * Regenerates all three line batches for the current spacing and extent.
   *
   * Every tenth line is promoted to the major batch; with 1, 2, 5 and 10 inch
   * imperial spacings that lands major lines on 10", 20", 50" and 100"
   * respectively, all of which are round numbers on a tape measure.
   */
  private rebuild(): void {
    const step = this.spacingValue;
    const count = Math.floor(this.extent / step);

    const minorPositions: number[] = [];
    const minorColors: number[] = [];
    const majorPositions: number[] = [];
    const majorColors: number[] = [];

    const push = (
      positions: number[],
      colors: number[],
      base: THREE.Color,
      x1: number,
      z1: number,
      x2: number,
      z2: number,
    ) => {
      positions.push(x1, 0, z1, x2, 0, z2);
      this.pushFadedColor(colors, base, x1, z1);
      this.pushFadedColor(colors, base, x2, z2);
    };

    for (let i = -count; i <= count; i += 1) {
      if (i === 0) continue;
      const offset = i * step;
      const isMajor = i % 10 === 0;
      const positions = isMajor ? majorPositions : minorPositions;
      const colors = isMajor ? majorColors : minorColors;
      const color = isMajor ? MAJOR_COLOR : MINOR_COLOR;

      push(positions, colors, color, offset, -this.extent, offset, this.extent);
      push(positions, colors, color, -this.extent, offset, this.extent, offset);
    }

    this.applyGeometry(this.minor, minorPositions, minorColors);
    this.applyGeometry(this.major, majorPositions, majorColors);

    const axisPositions: number[] = [];
    const axisColors: number[] = [];
    push(axisPositions, axisColors, AXIS_X_COLOR, -this.extent, 0, this.extent, 0);
    push(axisPositions, axisColors, AXIS_Z_COLOR, 0, -this.extent, 0, this.extent);
    this.applyGeometry(this.axes, axisPositions, axisColors);
  }

  /** Writes a vertex colour faded toward the background with radial distance. */
  private pushFadedColor(colors: number[], base: THREE.Color, x: number, z: number): void {
    const distance = Math.min(1, Math.hypot(x, z) / this.extent);
    const fade = Math.min(1, Math.max(0, (distance - 0.45) / 0.55));
    const color = base.clone().lerp(BACKGROUND, fade);
    colors.push(color.r, color.g, color.b);
  }

  /** Replaces a line batch's buffers with new data. */
  private applyGeometry(line: THREE.LineSegments, positions: number[], colors: number[]): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    line.geometry.dispose();
    line.geometry = geometry;
  }
}
