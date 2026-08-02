import * as THREE from 'three';
import { LightingRig } from './LightingRig';

/** Top-level partitions of the scene graph. */
export type SceneLayer = 'vehicle' | 'design' | 'helpers';

/**
 * Owns the `Scene` and its fixed top-level structure.
 *
 * Everything added to the scene belongs to exactly one of three groups. The
 * split is not cosmetic: raycasting for selection only ever tests `design`,
 * shadow and framing bounds only consider `vehicle` and `design`, and `helpers`
 * (grid, gizmos, dimension lines) are excluded from both. Keeping that
 * invariant here means later subsystems do not each reinvent a filter.
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly lighting = new LightingRig();

  /** The van shell: floor, walls, ceiling, wheel wells, door frames. */
  readonly vehicleGroup = new THREE.Group();
  /** User-placed objects — cabinets, appliances, tanks. */
  readonly designGroup = new THREE.Group();
  /** Non-exported visual aids that must never be selected or measured. */
  readonly helperGroup = new THREE.Group();

  constructor() {
    this.scene.name = 'CamperCAD';
    this.scene.background = new THREE.Color(0x14171c);
    this.scene.fog = new THREE.Fog(0x14171c, 900, 2600);

    this.vehicleGroup.name = 'Vehicle';
    this.designGroup.name = 'Design';
    this.helperGroup.name = 'Helpers';

    this.scene.add(this.lighting.group, this.vehicleGroup, this.designGroup, this.helperGroup);
  }

  /**
   * Applies a background colour and fog range.
   *
   * Fog is disabled entirely rather than pushed far away when a preset asks for
   * none: distant fog still tints large surfaces, which is wrong for a flat
   * technical view.
   */
  applyEnvironment(background: number, fog: [number, number] | null): void {
    (this.scene.background as THREE.Color).setHex(background);

    if (!fog) {
      this.scene.fog = null;
      return;
    }

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(background);
      this.scene.fog.near = fog[0];
      this.scene.fog.far = fog[1];
    } else {
      this.scene.fog = new THREE.Fog(background, fog[0], fog[1]);
    }
  }

  /** Returns the group backing a layer. */
  layer(layer: SceneLayer): THREE.Group {
    switch (layer) {
      case 'vehicle':
        return this.vehicleGroup;
      case 'design':
        return this.designGroup;
      case 'helpers':
        return this.helperGroup;
    }
  }

  /** Adds an object to a layer. */
  add(layer: SceneLayer, object: THREE.Object3D): void {
    this.layer(layer).add(object);
  }

  /**
   * Bounds of everything meaningful in the scene — vehicle plus design, never
   * helpers. Used for camera framing and shadow fitting.
   *
   * Falls back to a van-sized box when the scene is empty so the camera has
   * something sane to frame during startup.
   */
  contentBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    box.expandByObject(this.vehicleGroup);
    box.expandByObject(this.designGroup);

    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-40, 0, -90), new THREE.Vector3(40, 80, 90));
    }
    return box;
  }

  /**
   * Removes an object from the scene and frees its GPU resources.
   *
   * Materials are disposed only when they are not shared, which the caller
   * signals with `disposeMaterials`. Shared library materials outlive the
   * objects that use them.
   */
  remove(object: THREE.Object3D, disposeMaterials = true): void {
    object.removeFromParent();
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
      child.geometry.dispose();
      if (!disposeMaterials) return;
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    });
  }
}
