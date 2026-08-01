import * as THREE from 'three';
import type { CameraManager } from '@/core/CameraManager';
import type { SceneManager } from '@/core/SceneManager';
import type { GridManager } from '@/scene/GridManager';
import type { CommandStack } from '@/commands/CommandStack';
import { AddObjectCommand } from '@/commands/AddObjectCommand';
import type { ObjectFactory } from '@/objects/ObjectFactory';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { SelectionManager } from '@/selection/SelectionManager';
import type { LibraryItem } from '@/library/LibraryTypes';
import type { PlacementSolver } from '@/library/PlacementSolver';
import { geometryRegistry } from '@/objects/SceneObject';
import { KIND_INFO } from '@/geometry/GeometryRegistry';
import { PROFILE_PRESETS } from '@/geometry/ProfileShapes';
import type { ToolManager } from './ToolManager';
import type { Tool, ToolId } from './ToolTypes';

/** Ghost colours: amber when placeable, red when it will not fit. */
const GHOST_OK = 0xe2a44a;
const GHOST_BAD = 0xe2685a;

/**
 * Places a library item.
 *
 * The ghost shows the item at its **solved** position, not at the cursor, so
 * what the user sees before clicking is exactly what they get: a roof fan rides
 * along the ceiling, an upper cabinet snaps flat against whichever wall the
 * pointer is nearer, a countertop rises onto the cabinet beneath it.
 *
 * The ghost also turns red when the item does not fit the cabin at that
 * position. That check runs continuously rather than on drop, because refusing
 * a placement after the click leaves the user guessing why; showing the problem
 * before the click lets them move a few inches and watch it resolve.
 *
 * Unlike the plain box tool this stays active after a placement. Library items
 * are usually placed several at a time — four cabinets, two panels, three
 * batteries — and dropping back to the select tool after each one would mean
 * reopening the browser every time.
 */
export class PlaceItemTool implements Tool {
  readonly id: ToolId = 'place-item';
  readonly label = 'Place';
  readonly cursor = 'crosshair';

  private readonly canvas: HTMLCanvasElement;
  private readonly cameras: CameraManager;
  private readonly grid: GridManager;
  private readonly factory: ObjectFactory;
  private readonly store: ObjectStore;
  private readonly stack: CommandStack;
  private readonly selection: SelectionManager;
  private readonly solver: PlacementSolver;
  private readonly tools: ToolManager;

  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ghost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly ownedGhostGeometry = new Set<THREE.BufferGeometry>();
  private readonly cursorPoint = new THREE.Vector3();

  private item: LibraryItem | null = null;
  private fits = true;

  constructor(
    canvas: HTMLCanvasElement,
    scene: SceneManager,
    cameras: CameraManager,
    grid: GridManager,
    factory: ObjectFactory,
    store: ObjectStore,
    stack: CommandStack,
    selection: SelectionManager,
    solver: PlacementSolver,
    tools: ToolManager,
  ) {
    this.canvas = canvas;
    this.cameras = cameras;
    this.grid = grid;
    this.factory = factory;
    this.store = store;
    this.stack = stack;
    this.selection = selection;
    this.solver = solver;
    this.tools = tools;

    this.ghost = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: GHOST_OK,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        roughness: 0.6,
      }),
    );
    this.ghost.name = 'Library placement ghost';
    this.ghost.visible = false;
    scene.helperGroup.add(this.ghost);
  }

  /** The item currently being placed, if any. */
  get activeItem(): LibraryItem | null {
    return this.item;
  }

  /** Arms the tool with an item and activates it. */
  beginPlacing(item: LibraryItem): void {
    this.item = item;

    // The ghost must be the shape the item actually is: a round tank previewed
    // as a box would be exactly the thing this preview exists to prevent.
    const profile = KIND_INFO[item.kind].hasProfile ? PROFILE_PRESETS[0].build() : undefined;
    const { geometry, owned } = geometryRegistry().create(item.kind, profile);

    if (this.ownedGhostGeometry.has(this.ghost.geometry)) {
      this.ownedGhostGeometry.delete(this.ghost.geometry);
      this.ghost.geometry.dispose();
    }
    this.ghost.geometry = geometry;
    if (owned) this.ownedGhostGeometry.add(geometry);

    this.ghost.scale.set(...item.dimensions);
    this.tools.activate('place-item');
  }

  /** Frees any ghost geometry this tool owns. */
  dispose(): void {
    for (const geometry of this.ownedGhostGeometry) geometry.dispose();
    this.ownedGhostGeometry.clear();
    this.ghost.material.dispose();
  }

  activate(): void {
    this.ghost.visible = false;
  }

  deactivate(): void {
    this.ghost.visible = false;
    this.item = null;
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.item || !this.floorPoint(event)) {
      this.ghost.visible = false;
      return;
    }

    const { position, rotationY } = this.solver.solve(this.item, this.cursorPoint);
    this.ghost.position.copy(position);
    this.ghost.rotation.set(0, rotationY, 0);
    this.ghost.visible = true;
    this.ghost.updateMatrixWorld(true);

    this.fits = this.checkFits();
    this.ghost.material.color.setHex(this.fits ? GHOST_OK : GHOST_BAD);
  }

  onPointerUp(event: PointerEvent): void {
    if (event.button !== 0 || !this.item || !this.floorPoint(event)) return;

    const { position, rotationY } = this.solver.solve(this.item, this.cursorPoint);
    const object = this.factory.fromLibrary(this.item);

    object.mesh.position.copy(position);
    object.mesh.rotation.y = rotationY;
    object.mesh.updateMatrixWorld(true);

    this.stack.execute(new AddObjectCommand(this.store, [object], `Add ${this.item.name}`));
    this.selection.select([object], 'replace');
  }

  onCancel(): void {
    this.item = null;
    this.ghost.visible = false;
    this.tools.activate('select');
  }

  /**
   * True when the ghost sits inside the cabin.
   *
   * Only the horizontal and upper bounds are tested. An object protruding
   * through a wall is a mistake; an object sitting slightly proud of the rear
   * door line usually is not, since that is where a bed platform legitimately
   * ends up.
   */
  private checkFits(): boolean {
    const vehicle = this.solver.target;
    if (!vehicle) return true;

    const box = new THREE.Box3().setFromObject(this.ghost);
    const halfWidth = vehicle.narrowestHalfWidth(box.min.y, box.max.y);
    const ceiling = vehicle.ceilingHeightOver(box.min.x, box.max.x);

    if (halfWidth <= 0) return false;
    if (box.min.x < -halfWidth - 0.01 || box.max.x > halfWidth + 0.01) return false;
    if (box.max.y > ceiling + 0.01) return false;

    return true;
  }

  /** Intersects the pointer ray with the floor and snaps it to the grid. */
  private floorPoint(event: PointerEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.cameras.camera);
    if (!this.raycaster.ray.intersectPlane(this.floor, this.cursorPoint)) return false;

    const step = this.grid.spacing;
    this.cursorPoint.x = Math.round(this.cursorPoint.x / step) * step;
    this.cursorPoint.z = Math.round(this.cursorPoint.z / step) * step;
    this.cursorPoint.y = 0;
    return true;
  }
}
