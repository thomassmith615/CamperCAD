import * as THREE from 'three';

/** Size of every generated map, in pixels. */
const SIZE = 512;

/**
 * Procedurally generated texture maps.
 *
 * The application ships no image assets and fetches nothing, which is a
 * constraint worth keeping: the whole thing stays a static bundle that works
 * offline in a van with no signal, which is exactly where someone checks a
 * measurement.
 *
 * Drawing the maps into a canvas at load costs a few milliseconds and gives
 * plywood visible grain, metal a brushed direction and fabric a weave. None of
 * these are photographic. They exist because a flat-shaded box reads as a
 * placeholder while a grained one reads as a cabinet, and that difference
 * changes how people judge a layout.
 */
export class ProceduralTextures {
  private static cache = new Map<string, THREE.Texture>();

  /**
   * Wood grain running along the U axis.
   *
   * Built from stacked sine bands with per-row jitter, plus occasional darker
   * streaks for the figure. Real plywood face veneer is far more chaotic, but
   * the eye reads directional banding as wood at the scale a cabinet is viewed.
   *
   * @param base Base colour as a CSS string.
   * @param contrast How pronounced the grain is, 0 to 1.
   */
  static wood(base: string, contrast = 0.35): THREE.Texture {
    return ProceduralTextures.build(`wood:${base}:${contrast}`, (context) => {
      context.fillStyle = base;
      context.fillRect(0, 0, SIZE, SIZE);

      const rings = 42;
      for (let i = 0; i < rings; i += 1) {
        const y = (i / rings) * SIZE;
        const wobble = Math.sin(i * 1.7) * 6 + Math.sin(i * 0.4) * 14;
        const darkness = (0.5 + 0.5 * Math.sin(i * 2.3)) * contrast;

        context.strokeStyle = `rgba(0, 0, 0, ${darkness * 0.35})`;
        context.lineWidth = 1 + (i % 3);
        context.beginPath();

        for (let x = 0; x <= SIZE; x += 8) {
          const offset = Math.sin((x / SIZE) * Math.PI * 2 + i) * wobble * 0.35;
          if (x === 0) context.moveTo(x, y + offset);
          else context.lineTo(x, y + offset);
        }
        context.stroke();
      }

      // A few strong streaks stand in for figure and knots-adjacent grain.
      context.strokeStyle = `rgba(0, 0, 0, ${contrast * 0.28})`;
      context.lineWidth = 3;
      for (let i = 0; i < 6; i += 1) {
        const y = (i / 6) * SIZE + 20;
        context.beginPath();
        context.moveTo(0, y);
        context.bezierCurveTo(SIZE * 0.3, y - 18, SIZE * 0.7, y + 22, SIZE, y - 6);
        context.stroke();
      }
    });
  }

  /** Fine horizontal brushing, for aluminium and stainless. */
  static brushedMetal(base: string): THREE.Texture {
    return ProceduralTextures.build(`metal:${base}`, (context) => {
      context.fillStyle = base;
      context.fillRect(0, 0, SIZE, SIZE);

      for (let i = 0; i < 2600; i += 1) {
        const y = Math.random() * SIZE;
        const length = 40 + Math.random() * 180;
        const x = Math.random() * SIZE;
        const shade = Math.random() > 0.5 ? 255 : 0;

        context.strokeStyle = `rgba(${shade}, ${shade}, ${shade}, ${0.02 + Math.random() * 0.05})`;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + length, y);
        context.stroke();
      }
    });
  }

  /** A plain over-under weave, for upholstery and headliner. */
  static fabric(base: string): THREE.Texture {
    return ProceduralTextures.build(`fabric:${base}`, (context) => {
      context.fillStyle = base;
      context.fillRect(0, 0, SIZE, SIZE);

      const pitch = 6;
      for (let y = 0; y < SIZE; y += pitch) {
        for (let x = 0; x < SIZE; x += pitch) {
          const over = ((x / pitch + y / pitch) | 0) % 2 === 0;
          context.fillStyle = over ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.07)';
          context.fillRect(x, y, pitch - 1, pitch - 1);
        }
      }
    });
  }

  /** Frees every cached texture. */
  static dispose(): void {
    for (const texture of ProceduralTextures.cache.values()) texture.dispose();
    ProceduralTextures.cache.clear();
  }

  /**
   * Renders a map and caches it by key.
   *
   * Caching is essential rather than an optimisation: forty cabinets sharing
   * one finish must share one texture, or the GPU holds forty copies of the
   * same 512-pixel image.
   */
  private static build(key: string, draw: (context: CanvasRenderingContext2D) => void): THREE.Texture {
    const cached = ProceduralTextures.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;

    const context = canvas.getContext('2d');
    if (!context) {
      // Canvas unavailable is survivable: an untextured material still shades.
      const fallback = new THREE.Texture();
      ProceduralTextures.cache.set(key, fallback);
      return fallback;
    }

    draw(context);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    ProceduralTextures.cache.set(key, texture);
    return texture;
  }
}
