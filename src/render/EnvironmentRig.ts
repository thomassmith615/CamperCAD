import * as THREE from 'three';

/**
 * Height of the van's floor above the ground, in inches.
 *
 * A ProMaster's cargo floor sits about 21 inches up. Placing the ground there
 * rather than at y = 0 is what makes an outdoor view read as a van parked
 * somewhere instead of a van sunk into a lawn — and it is the same number that
 * tells you how big a step you need at the side door.
 */
export const GROUND_DROP = 21;

/** Radius of the sky dome and ground disc, in inches. */
const WORLD_RADIUS = 4000;

/** Vertex and fragment shaders for a two-stop vertical sky gradient. */
const SKY_VERTEX = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform float offset;
  uniform float exponent;
  varying vec3 vWorldPosition;

  void main() {
    float h = normalize(vWorldPosition + offset).y;
    float t = pow(max(h, 0.0), exponent);
    gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
  }
`;

/**
 * The outdoor environment: a sky dome and the ground the van is parked on.
 *
 * This exists because the studio presets answer a different question. A grey
 * void with a construction grid is the right backdrop for deciding whether a
 * cabinet fits; it is the wrong one for deciding whether you like the result,
 * because nothing in it resembles anywhere you would ever park.
 *
 * The dome is a large inverted sphere with a gradient shader rather than a
 * texture — a two-stop vertical blend is a handful of instructions, needs no
 * asset, and reads as sky at every camera angle. The ground is a plain disc
 * that receives shadow, which is what actually sells the van as sitting on
 * something rather than floating.
 *
 * Nothing here is selectable, measurable or exportable: the whole rig lives in
 * the helper layer and is skipped by raycasting, framing and the bill of
 * materials.
 */
export class EnvironmentRig {
  readonly group = new THREE.Group();

  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly ground: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;

  constructor() {
    this.group.name = 'Environment';
    this.group.visible = false;

    // Drawn first and never depth-tested against, so it can never occlude the
    // model no matter how the camera is positioned inside the dome.
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(WORLD_RADIUS, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          topColor: { value: new THREE.Color(0x3f7fc4) },
          horizonColor: { value: new THREE.Color(0xc9d8e6) },
          offset: { value: 200 },
          exponent: { value: 0.7 },
        },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.name = 'Sky';
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(WORLD_RADIUS * 0.6, 64),
      new THREE.MeshStandardMaterial({ color: 0x6f7a52, roughness: 0.96, metalness: 0 }),
    );
    this.ground.name = 'Ground';
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -GROUND_DROP;
    this.ground.receiveShadow = true;

    this.group.add(this.sky, this.ground);
  }

  /** True while the outdoor rig is drawn. */
  get visible(): boolean {
    return this.group.visible;
  }

  /** Shows or hides sky and ground together. */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Recolours the environment.
   *
   * @param skyTop Colour at the zenith.
   * @param skyHorizon Colour at the horizon, where the gradient lands.
   * @param groundColor Colour of the surface the van is parked on.
   */
  setColors(skyTop: number, skyHorizon: number, groundColor: number): void {
    this.sky.material.uniforms.topColor.value.setHex(skyTop);
    this.sky.material.uniforms.horizonColor.value.setHex(skyHorizon);
    this.ground.material.color.setHex(groundColor);
  }

  /** Releases geometry and materials. */
  dispose(): void {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
  }
}
