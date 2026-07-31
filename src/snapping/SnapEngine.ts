import * as THREE from 'three';
import type { GridManager } from '@/scene/GridManager';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { VehicleModel } from '@/vehicle/VehicleModel';
import {
  DEFAULT_SNAP_SETTINGS,
  SNAP_PRIORITY,
  type AppliedSnap,
  type SnapAnchor,
  type SnapAxis,
  type SnapCandidate,
  type SnapResult,
  type SnapSettings,
} from './SnapTypes';

/** Axes in solve order. */
const AXES: SnapAxis[] = ['x', 'y', 'z'];

/** The three features of a moving object that can be aligned. */
const ANCHORS: SnapAnchor[] = ['min', 'center', 'max'];

/**
 * Resolves snapping for a moving selection.
 *
 * The solver works one axis at a time. It collects every coordinate the moving
 * object could plausibly want to land on, discards those further away than the
 * tolerance, and applies the best remaining one. Because the axes are
 * independent, aligning two of them is edge snapping and aligning three is
 * corner snapping — neither needs its own code path.
 *
 * Wall snapping asks the vehicle for the narrowest half-width across the
 * object's own height range rather than at a single point. A tall cabinet has to
 * clear the wall where the wall is tightest, which on a ProMaster is near the
 * floor and again at the shoulder, not at the cabinet's midpoint.
 */
export class SnapEngine {
  settings: SnapSettings = { ...DEFAULT_SNAP_SETTINGS };

  private readonly store: ObjectStore;
  private readonly grid: GridManager;
  private vehicle: VehicleModel | null = null;
  private suspended = false;

  constructor(store: ObjectStore, grid: GridManager) {
    this.store = store;
    this.grid = grid;
  }

  /** Points the engine at the loaded vehicle, or at none. */
  setVehicle(vehicle: VehicleModel | null): void {
    this.vehicle = vehicle;
  }

  /**
   * Temporarily disables snapping without changing the user's setting.
   * Bound to holding Alt, the universal "let me place this freely" gesture.
   */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  /** True when a solve would currently do anything. */
  get isActive(): boolean {
    return this.settings.enabled && !this.suspended;
  }

  /**
   * Solves snapping for a set of moving objects.
   *
   * @param moving Objects being dragged. They are excluded from object-to-object
   * candidates, since an object cannot snap to itself or to its drag partners.
   * @param bounds Combined world bounds of the moving objects at their proposed
   * position.
   * @returns The correction to apply and the candidates behind it.
   */
  solve(moving: readonly SceneObject[], bounds: THREE.Box3): SnapResult {
    const result: SnapResult = { delta: [0, 0, 0], applied: [] };
    if (!this.isActive || bounds.isEmpty()) return result;

    const movingIds = new Set(moving.map((object) => object.id));
    const candidates = [...this.vehicleCandidates(bounds), ...this.objectCandidates(movingIds)];

    AXES.forEach((axis, index) => {
      // Discrete geometry first; the grid is a continuous fallback for any axis
      // that real geometry did not claim.
      const best = this.bestForAxis(axis, bounds, candidates) ?? this.resolveGrid(axis, bounds);
      if (!best) return;
      result.delta[index] = best.delta;
      result.applied.push(best);
    });

    return result;
  }

  /**
   * Snaps a dimension triple to the grid.
   *
   * Used while the scale gizmo is dragging, so a cabinet lands on a round
   * number the same way a moved one lands on a round position.
   */
  solveDimensions(dimensions: THREE.Vector3): THREE.Vector3 {
    if (!this.isActive) return dimensions;

    const step = this.grid.spacing;
    const snapAxis = (value: number): number => {
      const target = Math.round(value / step) * step;
      return Math.abs(target - value) <= this.settings.tolerance && target > 0 ? target : value;
    };

    return dimensions.set(snapAxis(dimensions.x), snapAxis(dimensions.y), snapAxis(dimensions.z));
  }

  /**
   * Picks the winning candidate for one axis.
   *
   * Candidates are ranked by source priority first and distance second, so a
   * wall an inch away beats a grid line a tenth of an inch away.
   */
  private bestForAxis(axis: SnapAxis, bounds: THREE.Box3, candidates: SnapCandidate[]): AppliedSnap | null {
    const anchorValue: Record<SnapAnchor, number> = {
      min: bounds.min[axis],
      center: (bounds.min[axis] + bounds.max[axis]) / 2,
      max: bounds.max[axis],
    };

    let best: AppliedSnap | null = null;
    let bestRank = Infinity;

    for (const candidate of candidates) {
      if (candidate.axis !== axis) continue;

      const delta = candidate.value - anchorValue[candidate.anchor];
      const distance = Math.abs(delta);
      if (distance > this.settings.tolerance) continue;

      const rank = SNAP_PRIORITY[candidate.source] * 1000 + distance;
      if (rank < bestRank) {
        bestRank = rank;
        best = { ...candidate, delta };
      }
    }

    return best;
  }

  /** Vehicle-derived candidates: floor, ceiling, side walls and both ends. */
  private vehicleCandidates(bounds: THREE.Box3): SnapCandidate[] {
    const vehicle = this.vehicle;
    if (!vehicle) return [];

    const halfWidth = vehicle.narrowestHalfWidth(bounds.min.y, bounds.max.y);
    const ceiling = vehicle.ceilingHeightOver(bounds.min.x, bounds.max.x);

    const candidates: SnapCandidate[] = [
      { axis: 'y', value: 0, anchor: 'min', source: 'floor', label: 'Floor' },
      { axis: 'y', value: ceiling, anchor: 'max', source: 'ceiling', label: 'Ceiling' },
      { axis: 'z', value: vehicle.frontZ, anchor: 'min', source: 'bulkhead', label: 'Cab bulkhead' },
      { axis: 'z', value: vehicle.rearZ, anchor: 'max', source: 'rear', label: 'Rear doors' },
    ];

    if (halfWidth > 0) {
      candidates.push(
        { axis: 'x', value: halfWidth, anchor: 'max', source: 'wall', label: 'Passenger wall' },
        { axis: 'x', value: -halfWidth, anchor: 'min', source: 'wall', label: 'Driver wall' },
        { axis: 'x', value: 0, anchor: 'center', source: 'wall', label: 'Centreline' },
      );
    }

    return candidates;
  }

  /**
   * Object-to-object candidates.
   *
   * Each stationary object contributes its minimum, centre and maximum on every
   * axis. Paired against the moving object's own three anchors this yields both
   * flush placement (my min to your max) and alignment (my min to your min),
   * which are the two things a van build needs constantly.
   */
  private objectCandidates(movingIds: Set<string>): SnapCandidate[] {
    const candidates: SnapCandidate[] = [];

    for (const object of this.store.all()) {
      if (movingIds.has(object.id) || !object.mesh.visible) continue;

      const box = object.boundingBox();
      for (const axis of AXES) {
        const values: Array<[number, string]> = [
          [box.min[axis], 'edge'],
          [(box.min[axis] + box.max[axis]) / 2, 'centre'],
          [box.max[axis], 'edge'],
        ];

        for (const [value, kind] of values) {
          for (const anchor of ANCHORS) {
            candidates.push({
              axis,
              value,
              anchor,
              source: 'object',
              label: `${object.name} ${kind}`,
            });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Rounds one coordinate to the grid if that lands inside the tolerance.
   *
   * Kept separate from the ranked candidates because the grid is continuous: it
   * has no finite list to rank, and it should only claim an axis that no real
   * geometry wanted.
   */
  private resolveGrid(axis: SnapAxis, bounds: THREE.Box3): AppliedSnap | null {
    if (!this.isActive || !this.grid.visible) return null;

    const step = this.grid.spacing;
    let best: AppliedSnap | null = null;

    for (const anchor of ANCHORS) {
      const current =
        anchor === 'min' ? bounds.min[axis] : anchor === 'max' ? bounds.max[axis] : (bounds.min[axis] + bounds.max[axis]) / 2;

      const target = Math.round(current / step) * step;
      const delta = target - current;
      if (Math.abs(delta) > this.settings.tolerance) continue;
      if (best && Math.abs(delta) >= Math.abs(best.delta)) continue;

      best = { axis, value: target, anchor, source: 'grid', label: 'Grid', delta };
    }

    return best;
  }
}
