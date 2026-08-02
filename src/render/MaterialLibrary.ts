import * as THREE from 'three';
import { ProceduralTextures } from './ProceduralTextures';

/** Named surface finishes an object can wear. */
export type FinishId =
  | 'flat'
  | 'birch-ply'
  | 'walnut'
  | 'painted-matte'
  | 'painted-gloss'
  | 'laminate'
  | 'stainless'
  | 'aluminium'
  | 'fabric'
  | 'rubber'
  | 'glass';

/** How a finish behaves and how it is described. */
export interface FinishDefinition {
  id: FinishId;
  label: string;
  roughness: number;
  metalness: number;
  /** Opacity below 1 makes the material transparent. */
  opacity: number;
  /** Which procedural map to apply, if any. */
  map: 'none' | 'wood' | 'metal' | 'fabric';
  /** Texture repeats per inch, so grain scales with object size. */
  repeatPerInch: number;
}

/**
 * Every available finish.
 *
 * Roughness and metalness are the two parameters that carry almost all of the
 * visual difference between materials, and they are the two most often set
 * wrongly. Painted plywood is not metallic at all; stainless is fully metallic
 * and quite smooth; anodised aluminium is metallic but rough enough to scatter.
 * Getting those right does more for how a render reads than any amount of
 * lighting work.
 */
export const FINISHES: readonly FinishDefinition[] = [
  { id: 'flat', label: 'Flat colour', roughness: 0.62, metalness: 0.04, opacity: 1, map: 'none', repeatPerInch: 0 },
  { id: 'birch-ply', label: 'Birch plywood', roughness: 0.72, metalness: 0, opacity: 1, map: 'wood', repeatPerInch: 0.05 },
  { id: 'walnut', label: 'Walnut', roughness: 0.55, metalness: 0, opacity: 1, map: 'wood', repeatPerInch: 0.045 },
  { id: 'painted-matte', label: 'Matte paint', roughness: 0.9, metalness: 0, opacity: 1, map: 'none', repeatPerInch: 0 },
  { id: 'painted-gloss', label: 'Gloss paint', roughness: 0.18, metalness: 0.02, opacity: 1, map: 'none', repeatPerInch: 0 },
  { id: 'laminate', label: 'Laminate', roughness: 0.35, metalness: 0.02, opacity: 1, map: 'none', repeatPerInch: 0 },
  { id: 'stainless', label: 'Stainless', roughness: 0.28, metalness: 0.95, opacity: 1, map: 'metal', repeatPerInch: 0.03 },
  { id: 'aluminium', label: 'Aluminium', roughness: 0.45, metalness: 0.9, opacity: 1, map: 'metal', repeatPerInch: 0.03 },
  { id: 'fabric', label: 'Fabric', roughness: 0.95, metalness: 0, opacity: 1, map: 'fabric', repeatPerInch: 0.12 },
  { id: 'rubber', label: 'Rubber / matting', roughness: 0.98, metalness: 0, opacity: 1, map: 'none', repeatPerInch: 0 },
  { id: 'glass', label: 'Glass', roughness: 0.05, metalness: 0, opacity: 0.28, map: 'none', repeatPerInch: 0 },
];

/** Looks up a finish, falling back to flat colour. */
export function findFinish(id: string): FinishDefinition {
  return FINISHES.find((finish) => finish.id === id) ?? FINISHES[0];
}

/**
 * Builds and shares materials.
 *
 * Materials are keyed by finish **and colour**, so twenty birch cabinets in the
 * same tone share one material and one texture. That matters more than it
 * sounds: each unique material is a separate draw call, and a build with forty
 * individually-materialled objects renders at a fraction of the frame rate of
 * one with six shared ones.
 *
 * Objects that were coloured individually before finishes existed keep working:
 * `flat` is the default and behaves exactly as the old plain material did.
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();

  /**
   * Returns a material for a finish and colour.
   *
   * The returned material is **shared**. Callers must not mutate it; to change
   * an object's appearance, ask for a different one.
   *
   * @param finishId Finish key.
   * @param color Base colour as `#rrggbb`.
   * @param sizeInches Largest object dimension, used to scale texture repeats
   * so grain stays a constant physical size rather than stretching with the
   * object.
   */
  get(finishId: string, color: string, sizeInches = 24): THREE.MeshStandardMaterial {
    const finish = findFinish(finishId);
    const repeat = finish.repeatPerInch > 0 ? Math.max(1, Math.round(sizeInches * finish.repeatPerInch)) : 0;
    const key = `${finish.id}|${color}|${repeat}`;

    const cached = this.cache.get(key);
    if (cached) return cached;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: finish.roughness,
      metalness: finish.metalness,
      transparent: finish.opacity < 1,
      opacity: finish.opacity,
      side: finish.opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
    });

    if (finish.map !== 'none') {
      const map = MaterialLibrary.textureFor(finish, color);
      if (repeat > 0) map.repeat.set(repeat, repeat);
      material.map = map;

      // The map already carries the colour, so tinting it again would double
      // the saturation. White lets the texture speak.
      material.color.set('#ffffff');
    }

    this.cache.set(key, material);
    return material;
  }

  /** Frees every shared material and the textures behind them. */
  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
    ProceduralTextures.dispose();
  }

  /** Picks the right procedural map for a finish. */
  private static textureFor(finish: FinishDefinition, color: string): THREE.Texture {
    switch (finish.map) {
      case 'wood':
        return ProceduralTextures.wood(color, finish.id === 'walnut' ? 0.45 : 0.3);
      case 'metal':
        return ProceduralTextures.brushedMetal(color);
      case 'fabric':
        return ProceduralTextures.fabric(color);
      default:
        return ProceduralTextures.wood(color);
    }
  }
}
