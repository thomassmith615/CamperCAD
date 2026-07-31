/**
 * Organisational structures layered over the flat object store.
 *
 * Two mechanisms, deliberately different in kind:
 *
 * **Layers** partition the design. Every object belongs to exactly one, and a
 * layer carries visibility and lock state that its members inherit. They answer
 * "show me only the electrical system" and "stop me from nudging the cabinetry
 * while I route wiring".
 *
 * **Groups** bind objects that move together. An object may belong to at most
 * one, and selecting any member selects them all. They answer "this cabinet and
 * its countertop and its sink are one thing now".
 *
 * A group is **not** a scene-graph reparenting. Reparenting would put members
 * into a transformed local space, which this application cannot afford: object
 * dimensions are carried by mesh scale, so a scaled parent would silently scale
 * its children's stated dimensions, and every bounding box, clearance and snap
 * candidate in the codebase reads world space. Modelling a group as a membership
 * set keeps all of that correct and costs only that group transforms are applied
 * per member — which the multi-select gizmo already does.
 */

/** A named partition of the design. */
export interface LayerData {
  /** Stable identifier, referenced by objects. */
  id: string;
  name: string;
  /** Hides every member regardless of their own visibility. */
  visible: boolean;
  /** Prevents transformation of every member. */
  locked: boolean;
  /** Swatch shown in the outliner. Purely a visual aid. */
  color: string;
}

/** A set of objects that select and move together. */
export interface GroupData {
  /** Stable identifier, referenced by objects. */
  id: string;
  name: string;
  /** Whether the outliner shows its members. */
  collapsed: boolean;
}

/** Identifier of the layer new objects join when nothing else applies. */
export const DEFAULT_LAYER_ID = 'layer-default';

/** Layers present in a new project. */
export const DEFAULT_LAYERS: readonly LayerData[] = [
  { id: DEFAULT_LAYER_ID, name: 'Build', visible: true, locked: false, color: '#e2a44a' },
  { id: 'layer-electrical', name: 'Electrical', visible: true, locked: false, color: '#4fd0d8' },
  { id: 'layer-plumbing', name: 'Plumbing', visible: true, locked: false, color: '#4a7fa5' },
  { id: 'layer-reference', name: 'Reference', visible: true, locked: false, color: '#8d97a5' },
];

/** Axis an array duplication runs along. */
export type ArrayAxis = 'x' | 'y' | 'z';

/** Parameters for an array duplication. */
export interface ArrayOptions {
  /** Total copies to create, excluding the original. */
  count: number;
  axis: ArrayAxis;
  /**
   * Distance between successive copies, in inches.
   *
   * Measured centre to centre when `mode` is `spacing`, or as a gap between
   * bounding boxes when it is `gap`. Both are useful: cabinets are laid out by
   * gap, roof fittings by centre spacing.
   */
  distance: number;
  mode: 'spacing' | 'gap';
}
