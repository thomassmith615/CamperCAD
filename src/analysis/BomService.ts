import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import { KIND_INFO } from '@/geometry/GeometryRegistry';
import { WeightService } from './WeightService';
import { SheetNester } from './SheetNester';
import type { BomLine, BomReport, CutPiece, SheetMaterial } from './BomTypes';

/**
 * Builds the bill of materials and cut list.
 *
 * ## The split
 *
 * Objects fall into two documents. Panels — the kind flagged as sheet goods in
 * {@link KIND_INFO} — become **cut pieces**, because they are made rather than
 * bought. Everything else becomes a **purchase line**, because a fridge is
 * bought whole and no amount of plywood arithmetic helps.
 *
 * That distinction is exactly why `panel` was made its own kind back when
 * shapes were added, rather than inferring "this box is thin, it must be
 * plywood". A 3/4" thick object might be a shelf or it might be a solar panel,
 * and guessing wrong puts a photovoltaic module on the cut list.
 *
 * ## Grouping
 *
 * Lines are grouped by name with copy numbering stripped, so eight identical
 * cabinets appear once with a quantity rather than as eight lines. Objects the
 * user renamed individually stay separate, which is correct: renaming
 * something is how they said it was different.
 */
export class BomService {
  private readonly store: ObjectStore;
  private readonly nester = new SheetNester();

  constructor(store: ObjectStore) {
    this.store = store;
  }

  /** Builds a complete report from the current design. */
  report(): BomReport {
    const purchases: SceneObject[] = [];
    const panels: SceneObject[] = [];

    for (const object of this.store.all()) {
      if (KIND_INFO[object.kind].isSheet) panels.push(object);
      else purchases.push(object);
    }

    const lines = BomService.buildLines(purchases);
    const cutList = BomService.buildCutList(panels);
    const sheets = this.nester.plan(cutList);

    const componentCost = lines.reduce((sum, line) => sum + line.totalPrice, 0);
    const totalWeight = this.store
      .all()
      .reduce((sum, object) => sum + WeightService.loadedWeight(object), 0);

    return {
      lines,
      cutList,
      sheets,
      componentCost,
      totalWeight,
      hasUnknownPrices: lines.some((line) => line.priceUnknown),
    };
  }

  /**
   * Strips trailing copy numbering from a name.
   *
   * `Base cabinet, 24" 3` and `Base cabinet, 24" copy 2` both collapse to the
   * same line, which is what a shopping list wants. A name the user typed
   * themselves is left alone unless it happens to end in a bare number, which
   * is a rare enough collision to accept for the grouping this buys.
   */
  static baseName(name: string): string {
    return name
      .replace(/\s+copy(\s+\d+)?$/i, '')
      .replace(/\s+\d+$/, '')
      .trim();
  }

  /** Groups bought objects into purchase lines. */
  private static buildLines(objects: readonly SceneObject[]): BomLine[] {
    const groups = new Map<string, SceneObject[]>();

    for (const object of objects) {
      const key = BomService.baseName(object.name);
      const bucket = groups.get(key);
      if (bucket) bucket.push(object);
      else groups.set(key, [object]);
    }

    const lines: BomLine[] = [];

    for (const [name, members] of groups) {
      const unitWeight = WeightService.loadedWeight(members[0]);
      const unitPrice = members[0].get('price');

      lines.push({
        name,
        quantity: members.length,
        unitWeight,
        unitPrice,
        totalWeight: members.reduce((sum, object) => sum + WeightService.loadedWeight(object), 0),
        totalPrice: members.reduce((sum, object) => sum + object.get('price'), 0),
        priceUnknown: members.some((object) => object.get('price') <= 0),
      });
    }

    return lines.sort((a, b) => b.totalPrice - a.totalPrice || a.name.localeCompare(b.name));
  }

  /**
   * Turns panels into cut pieces.
   *
   * A panel's thickness is whichever of its three dimensions is smallest, not
   * necessarily its depth: a shelf is placed flat, so its thin axis is height.
   * Taking the minimum handles every orientation without asking the user to
   * remember which axis they built it on.
   */
  private static buildCutList(objects: readonly SceneObject[]): CutPiece[] {
    const groups = new Map<string, CutPiece>();

    for (const object of objects) {
      const dimensions = [object.get('width'), object.get('height'), object.get('depth')].sort(
        (a, b) => b - a,
      );

      const piece: CutPiece = {
        name: BomService.baseName(object.name),
        length: BomService.round(dimensions[0]),
        width: BomService.round(dimensions[1]),
        thickness: BomService.round(dimensions[2]),
        material: object.get('material') as SheetMaterial,
        quantity: 1,
      };

      const key = `${piece.name}|${piece.length}|${piece.width}|${piece.thickness}|${piece.material}`;
      const existing = groups.get(key);
      if (existing) existing.quantity += 1;
      else groups.set(key, piece);
    }

    return [...groups.values()].sort(
      (a, b) => b.length * b.width - a.length * a.width || a.name.localeCompare(b.name),
    );
  }

  /** Rounds to a sixteenth of an inch, the finest a tape measure reads. */
  private static round(value: number): number {
    return Math.round(value * 16) / 16;
  }
}
