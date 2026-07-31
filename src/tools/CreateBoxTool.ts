import * as THREE from 'three';
import type { CameraManager } from '@/core/CameraManager';
import type { SceneManager } from '@/core/SceneManager';
import type { GridManager } from '@/scene/GridManager';
import type { CommandStack } from '@/commands/CommandStack';
import { AddObjectCommand } from '@/commands/AddObjectCommand';
import type { ObjectFactory } from '@/objects/ObjectFactory';
import type { ObjectStore } from '@/objects/ObjectStore';
import { DEFAULT_BOX_SIZE } from '@/objects/ObjectTypes';
import type { SelectionManager } from '@/selection/SelectionManager';
import type { ToolManager } from './ToolManager';
import type { Tool, ToolId } from './ToolTypes';

/**
 * Places new boxes on the van floor.
 *
 * A translucent ghost follows the cursor at the position the object would take,
 * snapped to the grid, so placement is committed to only after the user can see
 * the result. Placement is on the floor plane rather than on whatever surface
 * happens to be under the cursor; stacking onto other objects is surface
 * snapping, which belongs with the rest of the snapping work rather than being
 * half-implemented here.
 *
 * The tool returns to selection after one placement, which is what makes the
 * new object immediately editable — the overwhelmingly common next action.
 */
export class CreateBoxTool implements Tool {
  readonly id: ToolId = 'create-box';
  readonly label = 'Add box';
  readonly cursor = 'crosshair';

  private readonly cameras: CameraManager;
  private readonly grid: GridManager;
  private readonly factory: ObjectFactory;
  private readonly store: ObjectStore;
  private readonly stack: CommandStack;
  private readonly selection: SelectionManager;
  private readonly tools: ToolManager;
  private readonly canvas: HTMLCanvasElement;

  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ghost: THREE.Mesh;
  private readonly point = new THREE.Vector3();

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
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({
        color: 0xe2a44a,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        roughness: 0.6,
      }),
    );
    this.ghost.name = 'Placement ghost';
    this.ghost.scale.set(...DEFAULT_BOX_SIZE);
    this.ghost.visible = false;
    scene.helperGroup.add(this.ghost);
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

    const object = this.factory.create('box');
    object.mesh.position.copy(this.point);
    object.mesh.updateMatrixWorld(true);

    this.stack.execute(new AddObjectCommand(this.store, [object]));
    this.selection.select([object], 'replace');
    this.tools.activate('select');
  }

  onCancel(): void {
    this.tools.activate('select');
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
