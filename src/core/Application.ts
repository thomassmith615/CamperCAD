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
import { ObjectFactory } from '@/objects/ObjectFactory';
import { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { ObjectProperties, ObjectPropertyKey } from '@/objects/ObjectTypes';
import { CommandStack } from '@/commands/CommandStack';
import { AddObjectCommand } from '@/commands/AddObjectCommand';
import { RemoveObjectCommand } from '@/commands/RemoveObjectCommand';
import { SetPropertyCommand } from '@/commands/SetPropertyCommand';
import { SelectionManager } from '@/selection/SelectionManager';
import { SelectionOutline } from '@/selection/SelectionOutline';
import { TransformGizmo, type GizmoMode } from '@/selection/TransformGizmo';
import { ToolManager } from '@/tools/ToolManager';
import { SelectTool } from '@/tools/SelectTool';
import { CreateBoxTool } from '@/tools/CreateBoxTool';
import { MeasureTool } from '@/tools/MeasureTool';
import type { ToolId } from '@/tools/ToolTypes';
import { SnapEngine } from '@/snapping/SnapEngine';
import { SnapIndicator } from '@/snapping/SnapIndicator';
import { MeasurementService } from '@/measure/MeasurementService';
import { DimensionOverlay } from '@/measure/DimensionOverlay';
import { ScreenLabelLayer } from '@/ui/ScreenLabels';
import { ProjectService } from '@/project/ProjectService';
import { ObjectLibrary } from '@/library/ObjectLibrary';
import { PlacementSolver } from '@/library/PlacementSolver';
import type { LibraryItem } from '@/library/LibraryTypes';
import { PlaceItemTool } from '@/tools/PlaceItemTool';
import type { AppEvents } from './AppEvents';
import type { DisplayUnit } from '@/math/Units';

/** Offset applied to duplicated objects so a copy is visible, in inches. */
const DUPLICATE_OFFSET = 6;

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

  readonly objects: ObjectStore;
  readonly factory = new ObjectFactory();
  readonly history: CommandStack;
  readonly selection: SelectionManager;
  readonly gizmo: TransformGizmo;
  readonly tools: ToolManager;
  readonly snapping: SnapEngine;
  readonly measurements: MeasurementService;
  readonly projects: ProjectService;
  readonly library = new ObjectLibrary();
  readonly placement: PlacementSolver;

  private readonly outline = new SelectionOutline();
  private readonly snapIndicator = new SnapIndicator();
  private readonly dimensions = new DimensionOverlay();
  private readonly labels: ScreenLabelLayer;
  private readonly measureTool: MeasureTool;
  private readonly placeTool: PlaceItemTool;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointer = new THREE.Vector2();
  private readonly disposers: Array<() => void> = [];

  private vehicleModel: VehicleModel | null = null;
  private displayUnit: DisplayUnit = 'in';
  private frameHandle = 0;
  private smoothedFps = 60;
  private cameraWasAnimating = false;

  /**
   * @param host Element the viewport canvas is mounted into. It must be a
   * positioned element, since overlay UI such as the marquee is placed inside it.
   */
  constructor(host: HTMLElement) {
    this.renderer = new RendererManager(host);
    this.scene = new SceneManager();
    this.cameras = new CameraManager(this.renderer.aspect);
    this.controls = new ControlsManager(this.cameras, this.renderer.domElement);
    this.grid = new GridManager(1);

    this.scene.add('helpers', this.grid.group);
    this.scene.add('helpers', this.outline.group);
    this.scene.add('helpers', this.snapIndicator.group);
    this.scene.add('helpers', this.dimensions.group);

    this.objects = new ObjectStore(this.scene, this.bus);
    this.history = new CommandStack(this.bus);
    this.selection = new SelectionManager(this.bus);
    this.snapping = new SnapEngine(this.objects, this.grid);
    this.measurements = new MeasurementService(this.objects);
    this.placement = new PlacementSolver(this.objects);

    // Labels live in their own pointer-transparent layer above the canvas so
    // they never intercept a click meant for the model.
    const labelHost = document.createElement('div');
    labelHost.className = 'label-layer';
    host.append(labelHost);
    this.labels = new ScreenLabelLayer(labelHost);

    this.gizmo = new TransformGizmo(
      this.scene,
      this.cameras,
      this.controls,
      this.renderer.domElement,
      this.selection,
      this.objects,
      this.history,
      this.bus,
      this.snapping,
      this.snapIndicator,
    );

    this.tools = new ToolManager(this.renderer.domElement, this.bus);
    this.tools.register(
      new SelectTool(host, this.renderer.domElement, this.cameras, this.objects, this.selection, this.gizmo),
    );
    this.tools.register(
      new CreateBoxTool(
        this.renderer.domElement,
        this.scene,
        this.cameras,
        this.grid,
        this.factory,
        this.objects,
        this.history,
        this.selection,
        this.tools,
      ),
    );

    this.placeTool = new PlaceItemTool(
      this.renderer.domElement,
      this.scene,
      this.cameras,
      this.grid,
      this.factory,
      this.objects,
      this.history,
      this.selection,
      this.placement,
      this.tools,
    );
    this.tools.register(this.placeTool);

    this.measureTool = new MeasureTool(
      this.renderer.domElement,
      this.scene,
      this.cameras,
      this.grid,
      this.objects,
      this.bus,
    );
    this.tools.register(this.measureTool);

    this.bus.on('selection:changed', ({ objects }) => {
      this.outline.setSelection(objects);
      this.dimensions.setTarget(objects.length === 1 ? objects[0] : null);
    });

    this.disposers.push(this.renderer.onResize((width, height) => this.cameras.setAspect(width / height)));
    this.disposers.push(this.controls.onUserInteract(() => this.onUserMovedCamera()));

    this.bindPointer();
    this.bindKeyboard();

    // Constructed last: it subscribes to every other subsystem's events and
    // reads their state when capturing, so all of them must already exist.
    this.projects = new ProjectService(this);
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

    this.snapping.setVehicle(model);
    this.measurements.setVehicle(model);
    this.placement.setVehicle(model);

    this.bus.emit('vehicle:loaded', { vehicle: model });
    return model;
  }

  /** Moves the camera to a named view. */
  applyView(preset: ViewPreset): void {
    this.cameras.applyView(preset);
    this.beginCameraMove();
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
    this.beginCameraMove();
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

  /** Activates a tool by identifier. */
  setTool(tool: ToolId): void {
    this.tools.activate(tool);
  }

  /** Arms the placement tool with a library item and activates it. */
  beginPlacing(item: LibraryItem): void {
    this.placeTool.beginPlacing(item);
  }

  /** Turns snapping on or off. */
  setSnapEnabled(enabled: boolean): void {
    this.snapping.settings.enabled = enabled;
    if (!enabled) {
      this.snapIndicator.clear();
      this.bus.emit('snap:active', { applied: [] });
    }
    this.bus.emit('snap:settings', {
      enabled,
      tolerance: this.snapping.settings.tolerance,
    });
  }

  /** Switches the transform gizmo between move, rotate and scale. */
  setGizmoMode(mode: GizmoMode): void {
    this.gizmo.setMode(mode);
  }

  /**
   * Edits one property of one object through the history.
   *
   * No-op edits are discarded rather than pushed, so clicking into a field and
   * out again does not create an undo step.
   */
  setObjectProperty<K extends ObjectPropertyKey>(
    object: SceneObject,
    key: K,
    value: ObjectProperties[K],
  ): void {
    if (!SetPropertyCommand.changes(object, key, value)) return;
    this.history.execute(new SetPropertyCommand(this.objects, object, key, value));
  }

  /** Deletes every unlocked object in the selection. */
  deleteSelection(): void {
    const removable = this.selection.objects.filter((object) => !object.isLocked);
    if (removable.length === 0) return;
    this.history.execute(new RemoveObjectCommand(this.objects, removable));
  }

  /** Copies the selection, offsets the copies, and selects them. */
  duplicateSelection(): void {
    const sources = this.selection.objects;
    if (sources.length === 0) return;

    const copies = sources.map((object) => this.factory.duplicate(object, DUPLICATE_OFFSET));
    this.history.execute(new AddObjectCommand(this.objects, copies, `Duplicate ${sources.length} object(s)`));
    this.selection.select(copies, 'replace');
  }

  /** Reverses the most recent edit. */
  undo(): void {
    this.history.undo();
  }

  /** Re-applies the most recently undone edit. */
  redo(): void {
    this.history.redo();
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
    this.tools.dispose();
    this.gizmo.dispose();
    this.outline.dispose();
    this.snapIndicator.dispose();
    this.dimensions.dispose();
    this.labels.dispose();
    this.controls.dispose();
    this.grid.dispose();
    this.renderer.dispose();
    this.bus.clear();
  }

  /**
   * Advances and draws one frame.
   *
   * Order matters: the camera tween runs first so controls never fight it,
   * controls damping second, then the gizmo and selection outlines follow
   * whatever moved, and statistics are read after the draw call so they describe
   * the frame just presented rather than the previous one.
   */
  private update(): void {
    const delta = Math.min(this.clock.getDelta(), 0.1);

    const animating = this.cameras.update(delta);
    if (this.cameraWasAnimating && !animating) {
      this.controls.resume('camera-tween');
    }
    this.cameraWasAnimating = animating;

    this.controls.update();
    this.gizmo.update(this.cameras.camera);
    this.outline.update();
    this.dimensions.update(this.displayUnit);
    this.measureTool.update(this.displayUnit);

    const { width, height } = this.renderer.size;
    this.labels.render(
      [...this.dimensions.screenLabels, ...this.measureTool.screenLabels],
      this.cameras.camera,
      width,
      height,
    );

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

  /** Holds the camera still for the duration of a programmatic move. */
  private beginCameraMove(): void {
    this.controls.suspend('camera-tween');
    this.cameraWasAnimating = true;
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
   * Keyboard shortcuts.
   *
   * Keys are ignored while a text field has focus, so typing a cabinet name
   * never deletes the selection or flips the camera. Editing shortcuts that use
   * a modifier are handled before the plain-key shortcuts, since the latter
   * deliberately bail out on any modifier.
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

    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;

      // Holding Alt releases snapping for the duration of a drag.
      if (event.key === 'Alt') this.snapping.setSuspended(true);

      const accel = event.metaKey || event.ctrlKey;
      if (accel) {
        switch (event.code) {
          case 'KeyZ':
            if (event.shiftKey) this.redo();
            else this.undo();
            event.preventDefault();
            return;
          case 'KeyY':
            this.redo();
            event.preventDefault();
            return;
          case 'KeyD':
            this.duplicateSelection();
            event.preventDefault();
            return;
          case 'KeyS':
            this.projects.save();
            event.preventDefault();
            return;
          case 'KeyO':
            this.bus.emit('project:open-requested', undefined);
            event.preventDefault();
            return;
          default:
            return;
        }
      }

      if (event.altKey) return;

      const preset = presets[event.code];
      if (preset) {
        this.applyView(preset);
        event.preventDefault();
        return;
      }

      switch (event.code) {
        case 'KeyF':
          this.fitView();
          break;
        case 'KeyG':
          this.setGridVisible(!this.grid.visible);
          break;
        case 'KeyO':
          this.setProjection(this.cameras.projection === 'perspective' ? 'orthographic' : 'perspective');
          break;
        case 'KeyQ':
          this.setTool('select');
          break;
        case 'KeyB':
          this.setTool('create-box');
          break;
        case 'KeyM':
          this.setTool('measure');
          break;
        case 'KeyL':
          this.bus.emit('library:requested', undefined);
          break;
        case 'KeyW':
          this.setGizmoMode('translate');
          break;
        case 'KeyE':
          this.setGizmoMode('rotate');
          break;
        case 'KeyR':
          this.setGizmoMode('scale');
          break;
        case 'Delete':
        case 'Backspace':
          this.deleteSelection();
          break;
        case 'Escape':
          this.tools.cancel();
          this.selection.clear();
          break;
        case 'Space':
          this.controls.setOrbitOnLeft(true);
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') this.controls.setOrbitOnLeft(false);
      if (event.key === 'Alt') this.snapping.setSuspended(false);
    };

    // A held modifier is lost when the window loses focus, so clear both rather
    // than leaving the app stuck in a temporary mode the user cannot see.
    const onBlur = () => {
      this.controls.setOrbitOnLeft(false);
      this.snapping.setSuspended(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.disposers.push(() => window.removeEventListener('keydown', onKeyDown));
    this.disposers.push(() => window.removeEventListener('keyup', onKeyUp));
    this.disposers.push(() => window.removeEventListener('blur', onBlur));
  }
}
