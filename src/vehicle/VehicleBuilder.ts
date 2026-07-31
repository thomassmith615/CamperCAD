import * as THREE from 'three';
import { CrossSection } from '@/geometry/CrossSection';
import { openingOutline, sweepCrossSection, type SweepOpening } from '@/geometry/SweptSurface';
import { VehicleModel } from './VehicleModel';
import type { PanelOpeningSpec, VehicleDefinition } from './VehicleTypes';

/** Shared appearance for the van shell. */
const SHELL_COLOR = 0xd7dade;
const PANEL_COLOR = 0xcbd0d6;
const FLOOR_COLOR = 0x7f858c;
const WELL_COLOR = 0x9aa0a7;
const FEATURE_LINE_COLOR = 0x8fa0b4;

/**
 * Builds scene geometry for a {@link VehicleDefinition}.
 *
 * The shell is generated as a **single-sided surface with inward-facing
 * normals**. This one decision does most of the work in the viewport: the van is
 * solid when viewed from inside, invisible from outside, and so the user can
 * orbit freely and always see the interior without a "hide walls" toggle or a
 * clipping plane. It also halves the triangle count compared to a solid shell.
 *
 * Every mesh is registered as a named part so the inspector can toggle it and
 * later subsystems can find it without walking the scene graph.
 */
export class VehicleBuilder {
  /**
   * Builds a complete vehicle.
   *
   * @param definition Measured data for the vehicle.
   * @returns A model whose `group` is ready to add to the scene.
   */
  static build(definition: VehicleDefinition): VehicleModel {
    const section = new CrossSection(
      definition.sectionPoints.map(([x, y]) => new THREE.Vector2(x, y)),
      128,
    );
    const model = new VehicleModel(definition, section);

    const openings = VehicleBuilder.resolveOpenings(definition, section);

    VehicleBuilder.addShell(model, openings);
    VehicleBuilder.addFloor(model);
    VehicleBuilder.addWheelWells(model);
    VehicleBuilder.addEndPanel(model, 'rear');
    VehicleBuilder.addEndPanel(model, 'front');
    VehicleBuilder.addOpeningOutlines(model, openings);

    return model;
  }

  /**
   * Converts openings specified as heights above the floor into the sweep's
   * arc-length parameter space.
   *
   * Openings whose top edge sits above the wall are clamped to the roof rather
   * than dropped, so a mis-measured definition still produces visible geometry
   * that can be corrected instead of silently vanishing.
   */
  private static resolveOpenings(definition: VehicleDefinition, section: CrossSection): SweepOpening[] {
    const openings: SweepOpening[] = [];

    for (const spec of definition.sideOpenings) {
      const bottom = section.arcLengthAtHeight(spec.side, spec.bottomHeight);
      const top = section.arcLengthAtHeight(spec.side, spec.topHeight);
      if (bottom === null || top === null) {
        console.warn(`[VehicleBuilder] opening "${spec.id}" does not fit the section; skipped.`);
        continue;
      }
      openings.push({
        sMin: Math.min(bottom, top),
        sMax: Math.max(bottom, top),
        zMin: Math.min(spec.zStart, spec.zEnd),
        zMax: Math.max(spec.zStart, spec.zEnd),
      });
    }

    return openings;
  }

  /** Sweeps the cross-section into walls and ceiling. */
  private static addShell(model: VehicleModel, openings: SweepOpening[]): void {
    const geometry = sweepCrossSection(model.section, {
      zStart: model.frontZ,
      zEnd: model.rearZ,
      segments: 72,
      openings,
    });

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: SHELL_COLOR,
        roughness: 0.92,
        metalness: 0.04,
        side: THREE.FrontSide,
      }),
    );
    mesh.name = 'Shell';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    model.addPart({ id: 'shell', label: 'Walls & ceiling', object: mesh });
  }

  /** Adds the subfloor slab, with its top surface at y = 0. */
  private static addFloor(model: VehicleModel): void {
    const { interior, floorThickness } = model.definition;
    const geometry = new THREE.BoxGeometry(interior.floorWidth, floorThickness, interior.length);
    geometry.translate(0, -floorThickness / 2, 0);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.78, metalness: 0.18 }),
    );
    mesh.name = 'Floor';
    mesh.receiveShadow = true;

    model.addPart({ id: 'floor', label: 'Factory floor', object: mesh });
  }

  /**
   * Adds the two wheel well boxes.
   *
   * The arch profile is drawn in a length/height plane and extruded across the
   * van, then rotated into place. Extruding across the van rather than along it
   * is what gives the rounded top edge that bed platforms have to clear.
   */
  private static addWheelWells(model: VehicleModel): void {
    const { wheelWells, interior } = model.definition;
    const { length, height, protrusion, centerZ, cornerRadius } = wheelWells;
    const radius = Math.min(cornerRadius, height / 2, length / 2);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0, height - radius);
    shape.quadraticCurveTo(0, height, radius, height);
    shape.lineTo(length - radius, height);
    shape.quadraticCurveTo(length, height, length, height - radius);
    shape.lineTo(length, 0);
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: protrusion,
      bevelEnabled: false,
      curveSegments: 8,
    });
    // Extrusion runs along +Z in shape space; rotate so it runs across the van.
    // A point (u, v, w) becomes (w, v, -u), giving x ∈ [0, protrusion] and
    // z ∈ [-length, 0], which the translations below move into position.
    geometry.rotateY(Math.PI / 2);
    geometry.translate(0, 0, centerZ + length / 2);

    const material = new THREE.MeshStandardMaterial({ color: WELL_COLOR, roughness: 0.85, metalness: 0.1 });
    const halfWidth = interior.floorWidth / 2;

    const right = new THREE.Mesh(geometry, material);
    right.position.x = halfWidth - protrusion;
    right.name = 'Wheel well (passenger)';

    const left = new THREE.Mesh(geometry.clone(), material);
    left.position.x = -halfWidth;
    left.name = 'Wheel well (driver)';

    for (const mesh of [right, left]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    const group = new THREE.Group();
    group.name = 'Wheel wells';
    group.add(right, left);

    model.addPart({ id: 'wheel-wells', label: 'Wheel wells', object: group });
  }

  /**
   * Adds the rear panel or the cab bulkhead.
   *
   * A doorway sitting on the floor is cut by routing the outline around it,
   * which triangulates reliably; a raised opening becomes a true hole. Both
   * panels face into the cabin, matching the shell, so neither obstructs the
   * view from outside.
   */
  private static addEndPanel(model: VehicleModel, end: 'front' | 'rear'): void {
    const isRear = end === 'rear';
    const spec: PanelOpeningSpec = isRear ? model.definition.rearOpening : model.definition.cabOpening;
    const shape = VehicleBuilder.panelShape(model, spec, isRear);

    const geometry = new THREE.ShapeGeometry(shape, 8);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: PANEL_COLOR, roughness: 0.9, metalness: 0.05 }),
    );

    mesh.position.z = isRear ? model.rearZ : model.frontZ;
    // The rear panel's shape is authored mirrored in X so that this half turn
    // leaves world geometry unchanged while pointing its normals into the cabin.
    if (isRear) mesh.rotation.y = Math.PI;

    mesh.name = isRear ? 'Rear panel' : 'Cab bulkhead';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    model.addPart({
      id: isRear ? 'rear-panel' : 'bulkhead',
      label: isRear ? 'Rear panel' : 'Cab bulkhead',
      object: mesh,
    });
  }

  /** Builds an end panel outline, routed around a floor-level doorway. */
  private static panelShape(model: VehicleModel, spec: PanelOpeningSpec, mirrorX: boolean): THREE.Shape {
    const sign = mirrorX ? -1 : 1;
    const outline = model.section.outline().map((p) => new THREE.Vector2(p.x * sign, p.y));
    const sitsOnFloor = spec.sillHeight <= 0.01;

    // An opening wider than the section at its top edge would produce a
    // self-intersecting outline and garbage triangulation. Clamp instead, so a
    // mis-measured definition shows a slightly narrow door and logs why.
    const available = model.widthAtHeight(spec.sillHeight + spec.height) / 2 - 0.5;
    const halfOpening = Math.max(1, Math.min(spec.width / 2, available));
    if (halfOpening < spec.width / 2 - 1e-3) {
      console.warn(
        `[VehicleBuilder] "${spec.label}" is wider than the body at ${spec.sillHeight + spec.height}"; ` +
          `clamped to ${(halfOpening * 2).toFixed(1)}".`,
      );
    }

    if (!sitsOnFloor) {
      const shape = new THREE.Shape(outline);
      const hole = new THREE.Path();
      hole.moveTo(-halfOpening, spec.sillHeight);
      hole.lineTo(halfOpening, spec.sillHeight);
      hole.lineTo(halfOpening, spec.sillHeight + spec.height);
      hole.lineTo(-halfOpening, spec.sillHeight + spec.height);
      hole.closePath();
      shape.holes.push(hole);
      return shape;
    }

    // Outline runs from one floor edge over the roof to the other; continue
    // along the floor, up and over the doorway, and back to the start.
    const last = outline[outline.length - 1];
    const doorwaySide = Math.sign(last.x) || -1;
    const points = [...outline];
    points.push(new THREE.Vector2(halfOpening * doorwaySide, 0));
    points.push(new THREE.Vector2(halfOpening * doorwaySide, spec.height));
    points.push(new THREE.Vector2(-halfOpening * doorwaySide, spec.height));
    points.push(new THREE.Vector2(-halfOpening * doorwaySide, 0));

    return new THREE.Shape(points);
  }

  /** Draws frame lines around every side opening. */
  private static addOpeningOutlines(model: VehicleModel, openings: SweepOpening[]): void {
    if (openings.length === 0) return;

    const material = new THREE.LineBasicMaterial({ color: FEATURE_LINE_COLOR, transparent: true, opacity: 0.85 });
    const group = new THREE.Group();
    group.name = 'Opening frames';

    for (const opening of openings) {
      const line = new THREE.Line(openingOutline(model.section, opening), material);
      line.name = 'Opening frame';
      group.add(line);
    }

    model.addPart({ id: 'opening-frames', label: 'Door openings', object: group });
  }
}
