import type * as THREE from 'three';

/** A label to draw this frame. */
export interface ScreenLabel {
  text: string;
  /** World-space anchor point, in inches. */
  position: THREE.Vector3;
  /** Optional modifier class, e.g. `screen-label--measure`. */
  variant?: string;
}

/**
 * Draws text labels over the viewport at projected world positions.
 *
 * HTML rather than sprites or canvas textures: dimension text has to stay
 * pin-sharp at any zoom and match the rest of the interface's typography, and a
 * texture-based label does neither without a lot of work. The cost is one
 * projection per label per frame, which is nothing next to a draw call.
 *
 * Elements are pooled and reused. Labels move every frame during a drag, so
 * creating and destroying nodes would churn the DOM continuously.
 */
export class ScreenLabelLayer {
  private readonly host: HTMLElement;
  private readonly pool: HTMLElement[] = [];

  /**
   * @param host Positioned element the labels are placed inside, normally the
   * viewport's pointer-transparent overlay.
   */
  constructor(host: HTMLElement) {
    this.host = host;
  }

  /**
   * Positions labels for this frame.
   *
   * Labels behind the camera project to nonsense coordinates, so anything with
   * a normalised depth outside the near/far range is hidden rather than drawn
   * at a mirrored position.
   *
   * @param labels Labels to show. Passing an empty array hides all of them.
   * @param camera Camera to project through.
   * @param width Viewport width in CSS pixels.
   * @param height Viewport height in CSS pixels.
   */
  render(labels: readonly ScreenLabel[], camera: THREE.Camera, width: number, height: number): void {
    this.ensureCapacity(labels.length);

    labels.forEach((label, index) => {
      const element = this.pool[index];
      const projected = label.position.clone().project(camera);

      if (projected.z < -1 || projected.z > 1) {
        element.hidden = true;
        return;
      }

      element.hidden = false;
      element.className = label.variant ? `screen-label ${label.variant}` : 'screen-label';
      element.textContent = label.text;
      element.style.transform = `translate(-50%, -50%) translate(${((projected.x + 1) / 2) * width}px, ${
        ((1 - projected.y) / 2) * height
      }px)`;
    });

    for (let i = labels.length; i < this.pool.length; i += 1) {
      this.pool[i].hidden = true;
    }
  }

  /** Hides every label. */
  clear(): void {
    for (const element of this.pool) element.hidden = true;
  }

  /** Removes every pooled element from the DOM. */
  dispose(): void {
    for (const element of this.pool) element.remove();
    this.pool.length = 0;
  }

  /** Grows the pool to hold at least `count` labels. */
  private ensureCapacity(count: number): void {
    while (this.pool.length < count) {
      const element = document.createElement('div');
      element.className = 'screen-label';
      element.hidden = true;
      this.host.append(element);
      this.pool.push(element);
    }
  }
}
