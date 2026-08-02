import * as THREE from 'three';

/**
 * Owns the `WebGLRenderer` and the canvas element, and is the single authority
 * on viewport size.
 *
 * Sizing is driven by a `ResizeObserver` on the host element rather than by
 * window resize events, so the renderer stays correct when panels are collapsed
 * or the sidebar is resized — situations that never fire a window event.
 */
export class RendererManager {
  readonly renderer: THREE.WebGLRenderer;
  private readonly host: HTMLElement;
  private readonly observer: ResizeObserver;
  private readonly resizeHandlers = new Set<(width: number, height: number) => void>();
  private width = 1;
  private height = 1;

  /**
   * @param host Element the canvas is appended to and sized against.
   */
  constructor(host: HTMLElement) {
    this.host = host;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x14171c, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    host.appendChild(this.renderer.domElement);

    this.observer = new ResizeObserver(() => this.syncSize());
    this.observer.observe(host);
    this.syncSize();
  }

  /** The canvas the renderer draws into. Pointer handlers attach here. */
  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Current drawing buffer aspect ratio, never zero. */
  get aspect(): number {
    return this.width / this.height;
  }

  /** Current CSS pixel size of the viewport. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Registers a callback invoked whenever the viewport size changes.
   *
   * @returns An unsubscribe function.
   */
  onResize(handler: (width: number, height: number) => void): () => void {
    this.resizeHandlers.add(handler);
    handler(this.width, this.height);
    return () => this.resizeHandlers.delete(handler);
  }

  /** Draws one frame. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  /** Sets tone mapping exposure, used by the render presets. */
  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  /**
   * Captures the current frame as a PNG data URL.
   *
   * The renderer runs without `preserveDrawingBuffer`, so the back buffer is
   * cleared as soon as the browser composites. The caller must therefore render
   * immediately before calling this, in the same tick — which is what
   * `Application.captureScreenshot` does. Enabling buffer preservation instead
   * would cost a full-frame copy on every frame of a viewport that is usually
   * not being screenshotted.
   *
   * @param scene Scene to draw.
   * @param camera Camera to draw from.
   */
  capture(scene: THREE.Scene, camera: THREE.Camera): string {
    this.renderer.render(scene, camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** Draw call and triangle counts for the most recent frame. */
  stats(): { drawCalls: number; triangles: number } {
    const { render } = this.renderer.info;
    return { drawCalls: render.calls, triangles: render.triangles };
  }

  /** Releases GPU resources and stops observing the host element. */
  dispose(): void {
    this.observer.disconnect();
    this.resizeHandlers.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /**
   * Matches the drawing buffer to the host element. Device pixel ratio is
   * capped at 2: beyond that the cost of shading a CAD viewport outweighs any
   * visible improvement on high-density displays.
   */
  private syncSize(): void {
    const width = Math.max(1, Math.floor(this.host.clientWidth));
    const height = Math.max(1, Math.floor(this.host.clientHeight));
    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);

    for (const handler of this.resizeHandlers) handler(width, height);
  }
}
