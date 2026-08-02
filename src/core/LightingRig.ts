import * as THREE from 'three';
import { findPreset, type RenderPreset } from '@/render/RenderPresets';

/**
 * Lighting for the design viewport.
 *
 * The problem this solves is specific: a van interior is a deep box open at one
 * end, so a single sun leaves most of the cargo bay unreadable. The rig uses a
 * hemisphere fill for ambient shape, one shadow-casting key from the front
 * quarter, a cool rim from the opposite side to separate cabinets from walls,
 * and a soft overhead fill standing in for a roof fan and ceiling lights.
 *
 * All four are driven by a {@link RenderPreset}, so switching from workshop
 * light to night interior is one call rather than four coordinated ones.
 * Intensities assume `ACESFilmicToneMapping`; changing tone mapping means
 * retuning a whole preset rather than individual lights.
 */
export class LightingRig {
  readonly group = new THREE.Group();

  private readonly key: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly hemisphere: THREE.HemisphereLight;

  private preset: RenderPreset = findPreset('workshop');
  private lastBounds: THREE.Box3 | null = null;

  constructor() {
    this.group.name = 'Lighting';

    this.hemisphere = new THREE.HemisphereLight(0xbcd2e8, 0x2a2620, 0.85);
    this.group.add(this.hemisphere);

    this.key = new THREE.DirectionalLight(0xfff2e0, 2.1);
    this.key.position.set(-160, 260, -220);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.6;
    this.group.add(this.key);
    this.group.add(this.key.target);

    this.rim = new THREE.DirectionalLight(0x9fc4e8, 0.9);
    this.rim.position.set(240, 120, 200);
    this.group.add(this.rim);

    this.fill = new THREE.DirectionalLight(0xffffff, 0.45);
    this.fill.position.set(0, 300, 40);
    this.group.add(this.fill);

    this.applyPreset(this.preset);
  }

  /** The preset currently in force. */
  get activePreset(): RenderPreset {
    return this.preset;
  }

  /**
   * Applies a lighting preset.
   *
   * Positions are left to {@link fitToBounds}, which knows the scene's size;
   * this sets only colour, intensity, direction and shadow casting.
   */
  applyPreset(preset: RenderPreset): void {
    this.preset = preset;

    this.hemisphere.color.setHex(preset.hemisphereSky);
    this.hemisphere.groundColor.setHex(preset.hemisphereGround);
    this.hemisphere.intensity = preset.hemisphereIntensity;

    this.key.color.setHex(preset.keyColor);
    this.key.intensity = preset.keyIntensity;
    this.key.castShadow = preset.shadows;

    this.rim.color.setHex(preset.rimColor);
    this.rim.intensity = preset.rimIntensity;

    this.fill.color.setHex(preset.fillColor);
    this.fill.intensity = preset.fillIntensity;

    // Direction changed, so the shadow camera has to be re-aimed.
    if (this.lastBounds) this.fitToBounds(this.lastBounds);
  }

  /**
   * Sizes the key light's shadow camera to the content being designed.
   *
   * Directional shadows need an orthographic frustum that tightly bounds the
   * scene; too large and shadows turn blocky, too small and they clip. Call
   * this whenever the vehicle changes or large objects are added.
   *
   * @param bounds World-space bounds of everything that should cast shadows.
   */
  fitToBounds(bounds: THREE.Box3): void {
    this.lastBounds = bounds.clone();

    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1);

    this.key.target.position.copy(sphere.center);
    this.key.target.updateMatrixWorld();

    const direction = new THREE.Vector3(...this.preset.keyDirection).normalize();
    this.key.position.copy(sphere.center).addScaledVector(direction, radius * 2.6);

    const shadowCamera = this.key.shadow.camera;
    shadowCamera.left = -radius * 1.2;
    shadowCamera.right = radius * 1.2;
    shadowCamera.top = radius * 1.2;
    shadowCamera.bottom = -radius * 1.2;
    shadowCamera.near = radius * 0.2;
    shadowCamera.far = radius * 5.5;
    shadowCamera.updateProjectionMatrix();

    this.rim.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.6, radius * 0.8, radius * 1.3));
    this.fill.position.copy(sphere.center).add(new THREE.Vector3(0, radius * 2.2, radius * 0.3));
  }
}
