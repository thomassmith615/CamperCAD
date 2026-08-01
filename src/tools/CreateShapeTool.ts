import * as THREE from 'three';
import type { CameraManager } from '@/core/CameraManager';
import type { SceneManager } from '@/core/SceneManager';
import type { GridManager } from '@/scene/GridManager';
import type { CommandStack } from '@/commands/CommandStack';
import { AddObjectCommand } from '@/commands/AddObjectCommand';
import type { ObjectFactory } from '@/objects/ObjectFactory';
import type { ObjectStore } from '@/objects/ObjectStore';
import { KIND_DEFAULT_SIZE, type ObjectKind } from '@/objects/ObjectTypes';
import { geometryRegistry } from '@/objects/SceneObject';
import { KIND_INFO } from '@/geometry/GeometryRegistry';
import { PROFILE_PRESETS } from '@/geometry/ProfileShapes';
import type { SelectionManager } from '@/selection/SelectionManager';
import type { ToolManager } from './ToolManager';
import type { Tool, ToolId } from './ToolTypes';

/**
 * Places new primitives on the van floor.
 *
 * Replaces the box-only tool: because every kind honours the same unit-box
 * contract, one tool covers all of them and the only thing that changes between
 * a box and a cylinder is which geometry the ghost shows.
 *
 * A translucent ghost follows the cursor at the position the object would take,
 * snapped to the grid, so placement is committed to only after the user can see
 * the result. Placement is on the floor plane rather than on whatever surface
 * happens to be under the cursor; stacking onto other objects is what the
 * library's `surface` placement rule does, and duplicating it here would give
 * two subtly different behaviours for the same gesture.
 *
 * The tool returns to selection after one placement, which is what makes the
 * new object immediately editable — the overwhelmingly common next action.
 */
export class CreateShapeTool implements Tool {
  readonly id: ToolId = 'create-shape';
  readonly cursor = 'crosshair';

  private readonly canvas: HTMLCanvasElement;
  private readonly cameras: CameraManager;
  private readonly grid: GridManager;
  private readonly factory: ObjectFactory;
  private readonly store: ObjectStore;
  private readonly stack: CommandStack;
  private readonly selection: SelectionManager;
  private readonly tools: ToolManager;

  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ghost: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly point = new THREE.Vector3();
  private readonly ownedGhostGeometry = new Set<THREE.BufferGeometry>();

  private kind: ObjectKind = 'box';

  constructor(
    canvas: HTMLCanvasElement,
    scene: SceneManager,
    cameras: CameraManager,
    grid: GridManager,
    factory: ObjectFactory,
    store: ObjectStore,
    stack: CommandStack,
    selection: SelectionManager,
    tools: ToolManager,
  ) {
    this.canvas = canvas;
    this.cameras = cameras;
    this.grid = grid;
    this.factory = factory;
    this.store = store;
    this.stack = stack;
    this.selection = selection;
    this.tools = tools;

    this.ghost = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0xe2a44a,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        roughness: 0.6,
      }),
    );
    this.ghost.name = 'Placement ghost';
    this.ghost.visible = false;
    scene.helperGroup.add(this.ghost);

    this.applyKind('box');
  }

  /** Label reflects the kind, so the toolbar and status bar stay accurate. */
  get label(): string {
    return `Add ${KIND_INFO[this.kind].label.toLowerCase()}`;
  }

  /** The kind that will be created on the next click. */
  get activeKind(): ObjectKind {
    return this.kind;
  }

  /** Arms the tool with a kind and activates it. */
  beginCreating(kind: ObjectKind): void {
    this.applyKind(kind);
    this.tools.activate('create-shape');
  }

  activate(): void {
    this.ghost.visible = false;
  }

  deactivate(): void {
    this.ghost.visible = false;
  }

  onPointerMove(event: PointerEvent): void {
    const hit = this.floorPoint(event);
    this.ghost.visible = hit;
    if (hit) this.ghost.position.copy(this.point);
  }

  onPointerUp(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (!this.floorPoint(event)) return;

    const object = this.factory.create(this.kind);
    object.mesh.position.copy(this.point);
    object.mesh.updateMatrixWorld(true);

    this.stack.execute(new AddObjectCommand(this.store, [object]));
    this.selection.select([object], 'replace');
    this.tools.activate('select');
  }

  onCancel(): void {
    this.tools.activate('select');
  }

  /** Frees any ghost geometry this tool owns. */
  dispose(): void {
    for (const geometry of this.ownedGhostGeometry) geometry.dispose();
    this.ownedGhostGeometry.clear();
    this.ghost.material.dispose();
  }

  /** Points the ghost at a kind's geometry and default proportions. */
  private applyKind(kind: ObjectKind): void {
    this.kind = kind;

    const profile = KIND_INFO[kind].hasProfile ? PROFILE_PRESETS[0].build() : undefined;
    const { geometry, owned } = geometryRegistry().create(kind, profile);

    if (this.ownedGhostGeometry.has(this.ghost.geometry)) {
      this.ownedGhostGeometry.delete(this.ghost.geometry);
      this.ghost.geometry.dispose();
    }

    this.ghost.geometry = geometry;
    if (owned) this.ownedGhostGeometry.add(geometry);

    this.ghost.scale.set(...KIND_DEFAULT_SIZE[kind]);
  }

  /**
   * Intersects the pointer ray with the floor and snaps the result.
   *
   * @returns True when the ray met the floor; the point is left in `this.point`.
   */
  private floorPoint(event: PointerEvent): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    this.raycaster.setFromCamera(ndc, this.cameras.camera);
    if (!this.raycaster.ray.intersectPlane(this.floor, this.point)) return false;

    const step = this.grid.spacing;
    this.point.x = Math.round(this.point.x / step) * step;
    this.point.z = Math.round(this.point.z / step) * step;
    this.point.y = 0;
    return true;
  }
}
