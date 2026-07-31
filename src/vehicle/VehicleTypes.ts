/**
 * Data model for a supported vehicle.
 *
 * A definition is pure data — no Three.js types — so entries can be authored by
 * hand, fetched from a server, or later generated from imported CAD without
 * touching the builder. {@link VehicleBuilder} is the only consumer.
 *
 * ## Coordinate convention
 *
 * The origin sits at the centre of the cargo floor, on the floor surface.
 *
 * - **+X** toward the passenger (right) side, **-X** toward the driver.
 * - **+Y** up. The floor is `y = 0`; nothing in the cabin has negative Y.
 * - **+Z** toward the rear doors, **-Z** toward the cab bulkhead.
 *
 * All lengths are inches.
 */
export interface VehicleDefinition {
  /** Stable identifier used in saved projects. Never reuse or rename. */
  id: string;
  /** Display name, e.g. "Ram ProMaster 2500". */
  name: string;
  /** Configuration line shown under the name, e.g. `159" WB · High Roof`. */
  variant: string;
  /** Model years this geometry is valid for, for display only. */
  modelYears: string;

  /**
   * Interior cross-section control points as `[x, y]` pairs, ordered from the
   * right floor edge, up and over the roof, to the left floor edge. Interpolated
   * with a centripetal Catmull-Rom spline.
   */
  sectionPoints: readonly (readonly [number, number])[];

  /** Headline interior dimensions, used for readouts and validation. */
  interior: {
    /** Cargo floor length from bulkhead to rear door opening. */
    length: number;
    /** Width between the walls at floor level. */
    floorWidth: number;
    /** Clear width between the wheel well boxes. */
    betweenWheelWells: number;
  };

  /** Subfloor slab thickness drawn below `y = 0`. */
  floorThickness: number;

  /** Wheel well boxes, mirrored automatically about the centreline. */
  wheelWells: {
    /** Fore-aft length of the box. */
    length: number;
    /** Height above the floor. */
    height: number;
    /** How far the box intrudes from the wall toward the centreline. */
    protrusion: number;
    /** Z coordinate of the box centre. */
    centerZ: number;
    /** Radius applied to the two upper corners. */
    cornerRadius: number;
  };

  /** Openings cut into the swept side walls. */
  sideOpenings: readonly SideOpeningSpec[];

  /** Opening in the rear panel. */
  rearOpening: PanelOpeningSpec;

  /** Opening in the cab bulkhead panel. */
  cabOpening: PanelOpeningSpec;

  /** Provenance for every measurement above. Surfaced in the inspector. */
  sourceNotes: readonly string[];
}

/**
 * A doorway or window in a curved side wall.
 *
 * Heights are measured vertically from the floor and converted to arc length
 * along the section by the builder, so the opening follows the wall's curvature.
 */
export interface SideOpeningSpec {
  /** Stable identifier, unique within the vehicle. */
  id: string;
  /** Label shown on the part in the inspector. */
  label: string;
  /** Wall the opening belongs to. */
  side: 'left' | 'right';
  /** Height of the opening's bottom edge above the floor. */
  bottomHeight: number;
  /** Height of the opening's top edge above the floor. */
  topHeight: number;
  /** Forward edge of the opening on the Z axis. */
  zStart: number;
  /** Rear edge of the opening on the Z axis. */
  zEnd: number;
}

/** A rectangular opening in one of the flat end panels. */
export interface PanelOpeningSpec {
  /** Label shown on the part in the inspector. */
  label: string;
  /** Clear width of the opening. */
  width: number;
  /** Clear height of the opening. */
  height: number;
  /** Height of the opening's bottom edge above the floor. */
  sillHeight: number;
}
