import * as THREE from 'three';
import { EventBus } from './EventBus';
import { RendererManager } from './RendererManager';
import { SceneManager } from './SceneManager';
import { CameraManager, type ProjectionMode, type ViewPreset } from './CameraManager';
import { ControlsManager } from './ControlsManager';
import { GridManager } from '@/scene/GridManager';
import { VehicleBuilder } from '@/vehicle/VehicleBuilder';
import type { VehicleModel } from '@/vehicle/VehicleModel';
import type { VehicleDefinition } from '@/vehicle/VehicleTypes';
import type { AppEvents } from './AppEvents';
import type { DisplayUnit } from '@/math/Units';

/**
 * The composition root.
 *
 * `Application` owns every subsystem, wires them together and runs the frame
 * loop. It is deliberately the only class that knows about more than one
 * subsystem: managers talk to the world through their own narrow interfaces and
 * the {@link EventBus}, and the UI talks to the world through the small public
 * API on this class. Adding a subsystem means constructing it here and giving it
 * a slot in `update`, without editing any existing manager.
 */
export class Application {
  readonly bus = new EventBus<AppEvents>();
  readonly renderer: RendererManager;
  readonly scene: SceneManager;
  readonly cameras: CameraManager;
  readonly controls: ControlsManager;
  readonly grid: GridManager;

  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointer = new THREE.Vector2();
  private readonly disposers: Array<() => void> = [];

  private vehicleModel: VehicleModel | null = null;
  private displayUnit: DisplayUnit = 'in';
  private frameHandle = 0;
  private smoothedFps = 60;

  /**
   * @param host Element the viewport canvas is mounted into.
   */
  constructor(host: HTMLElement) {
    this.renderer = new RendererManager(host);
    this.scene = new SceneManager();
    this.cameras = new CameraManager(this.renderer.aspect);
    this.controls = new ControlsManager(this.cameras, this.renderer.domElement);
    this.grid = new GridManager(1);

    this.scene.add('helpers', this.grid.group);

    this.disposers.push(this.renderer.onResize((width, height) => this.cameras.setAspect(width / height)));
    this.disposers.push(this.controls.onUserInteract(() => this.onUserMovedCamera()));

    this.bindPointer();
    this.bindKeyboard();
  }

  /** The vehicle currently loaded, or null before one is set. */
  get vehicle(): VehicleModel | null {
    return this.vehicleModel;
  }

  /** Unit used for every readout and text input. */
  get unit(): DisplayUnit {
    return this.displayUnit;
  }

  /**
   * Builds a vehicle, replaces any previous one, and frames it.
   *
   * @param definition Measured vehicle data.
   */
  loadVehicle(definition: VehicleDefinition): VehicleModel {
    if (this.vehicleModel) {
      this.scene.remove(this.vehicleModel.group);
    }

    const model = VehicleBuilder.build(definition);
    this.vehicleModel = model;
    this.scene.add('vehicle', model.group);

    const bounds = this.scene.contentBounds();
    this.scene.lighting.fitToBounds(bounds);
    this.cameras.frame(bounds, false);
    this.cameras.applyView('iso', false);

    this.bus.emit('vehicle:loaded', { vehicle: model });
    return model;
  }

  /** Moves the camera to a named view. */
  applyView(preset: ViewPreset): void {
    this.cameras.applyView(preset);
    this.controls.setEnabled(false);
    this.bus.emit('view:changed', { preset });
    this.bus.emit('projection:changed', { mode: this.cameras.projection });
  }

  /** Switches projection without changing the viewpoint. */
  setProjection(mode: ProjectionMode): void {
    this.cameras.setProjection(mode);
    this.bus.emit('projection:changed', { mode });
  }

  /** Frames all vehicle and design geometry. */
  fitView(): void {
    this.cameras.frame(this.scene.contentBounds());
    this.controls.setEnabled(false);
  }

  /** Changes grid line spacing, in inches. */
  setGridSpacing(spacing: number): void {
    this.grid.setSpacing(spacing);
    this.bus.emit('grid:changed', { spacing: this.grid.spacing, visible: this.grid.visible });
  }

  /** Shows or hides the construction grid. */
  setGridVisible(visible: boolean): void {
    this.grid.setVisible(visible);
    this.bus.emit('grid:changed', { spacing: this.grid.spacing, visible });
  }

  /** Changes the unit used for display and input across the whole UI. */
  setUnit(unit: DisplayUnit): void {
    if (unit === this.displayUnit) return;
    this.displayUnit = unit;
    this.bus.emit('units:changed', { unit });
  }

  /** Shows or hides one part of the loaded vehicle. */
  setVehiclePartVisible(id: string, visible: boolean): void {
    if (this.vehicleModel?.setPartVisible(id, visible)) {
      this.bus.emit('vehicle:visibility', { part: id, visible });
    }
  }

  /** Starts the frame loop. */
  start(): void {
    if (this.frameHandle !== 0) return;
    this.clock.start();
    const loop = () => {
      this.frameHandle = requestAnimationFrame(loop);
      this.update();
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  /** Stops the frame loop and releases every resource the app owns. */
  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.controls.dispose();
    this.grid.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }

  /**
   * Advances and draws one frame.
   *
   * Order matters: the camera tween runs first so controls never fight it,
   * controls damping second, and statistics are read after the draw call so they
   * describe the frame just presented rather than the previous one.
   */
  private update(): void {
    const delta = Math.min(this.clock.getDelta(), 0.1);

    const animating = this.cameras.update(delta);
    if (!animating && !this.controls.isDragging) this.controls.setEnabled(true);
    this.controls.update();

    this.renderer.render(this.scene.scene, this.cameras.camera);

    if (delta > 0) {
      this.smoothedFps += (1 / delta - this.smoothedFps) * 0.08;
    }
    const stats = this.renderer.stats();
    this.bus.emit('frame:rendered', {
      fps: this.smoothedFps,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
    });
  }

  /** Drops the active view preset once the user takes over the camera. */
  private onUserMovedCamera(): void {
    if (this.cameras.activePreset === null) return;
    this.cameras.clearPreset();
    this.bus.emit('view:changed', { preset: null });
  }

  /**
   * Reports where the pointer sits on the floor plane.
   *
   * The floor plane is used rather than scene geometry because the readout must
   * stay meaningful when the pointer is over empty space — that is exactly when
   * a user is deciding where to place something.
   */
  private bindPointer(): void {
    const canvas = this.renderer.domElement;

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );

      this.raycaster.setFromCamera(this.pointer, this.cameras.camera);
      const point = new THREE.Vector3();
      const hit = this.raycaster.ray.intersectPlane(this.floorPlane, point);
      this.bus.emit('pointer:moved', { point: hit ? point : null });
    };

    const onLeave = () => {
      this.bus.emit('pointer:moved', { point: null });
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    this.disposers.push(() => canvas.removeEventListener('pointermove', onMove));
    this.disposers.push(() => canvas.removeEventListener('pointerleave', onLeave));
  }

  /**
   * View shortcuts.
   *
   * Keys are ignored while a text field has focus, and while the pointer is
   * outside the viewport, so typing a cabinet name never flips the camera.
   */
  private bindKeyboard(): void {
    const presets: Record<string, ViewPreset> = {
      Digit1: 'iso',
      Digit2: 'top',
      Digit3: 'front',
      Digit4: 'rear',
      Digit5: 'left',
      Digit6: 'right',
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const preset = presets[event.code];
      if (preset) {
        this.applyView(preset);
        event.preventDefault();
        return;
      }

      switch (event.code) {
        case 'KeyF':
          this.fitView();
          event.preventDefault();
          break;
        case 'KeyG':
          this.setGridVisible(!this.grid.visible);
          event.preventDefault();
          break;
        case 'KeyO':
          this.setProjection(this.cameras.projection === 'perspective' ? 'orthographic' : 'perspective');
          event.preventDefault();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    this.disposers.push(() => window.removeEventListener('keydown', onKeyDown));
  }
}
