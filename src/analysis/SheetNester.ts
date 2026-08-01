import {
  KERF,
  stockFor,
  type CutPiece,
  type NestedSheet,
  type PlacedPiece,
  type SheetMaterial,
  type SheetPlan,
} from './BomTypes';

/** One row of pieces across a sheet. */
interface Shelf {
  /** Distance from the sheet's edge to the bottom of this shelf. */
  y: number;
  /** Height of the tallest piece on the shelf. */
  height: number;
  /** How far along the shelf is filled. */
  used: number;
}

/**
 * Nests cut pieces onto stock sheets.
 *
 * ## The algorithm, and what it does not claim
 *
 * This is **first-fit decreasing with shelves**: pieces are sorted largest
 * first, laid in rows across the sheet, and rotated if that makes them fit.
 * It is not optimal — optimal 2D bin packing is NP-hard, and the exact answer
 * for forty panels would take longer than a builder is willing to wait.
 *
 * Shelf packing typically lands within about ten to fifteen percent of optimal
 * on the mix of sizes a van build produces, which is close enough to answer the
 * question that matters: how many sheets to buy. The utilisation figure is
 * reported so the user can see how much is being wasted rather than trusting
 * the number blindly, and a real cut plan should still be laid out at the saw.
 *
 * ## Kerf
 *
 * Every piece is inflated by one kerf width on each axis before packing. That
 * is slightly conservative — the outermost cut on a sheet does not need kerf on
 * both sides — and conservative is the right direction: the failure mode of
 * under-counting is a trip back to the lumberyard.
 */
export class SheetNester {
  /**
   * Plans sheet usage for a cut list.
   *
   * Pieces are grouped by material and thickness first, because a 3/4" birch
   * panel and a 1/2" birch panel cannot come off the same sheet.
   *
   * @param pieces Cut list, with quantities.
   */
  plan(pieces: readonly CutPiece[]): SheetPlan {
    const groups = new Map<string, CutPiece[]>();
    const oversized: SheetPlan['oversized'] = [];

    for (const piece of pieces) {
      const key = `${piece.material}|${piece.thickness}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(piece);
      else groups.set(key, [piece]);
    }

    const sheets: NestedSheet[] = [];
    let cost = 0;
    let pieceArea = 0;
    let sheetArea = 0;

    for (const [key, group] of groups) {
      const [material, thicknessText] = key.split('|');
      const thickness = Number.parseFloat(thicknessText);
      const stock = stockFor(material as SheetMaterial);

      // Expand quantities into individual pieces, largest first: a big piece
      // placed late has nowhere to go, so the ordering matters more than the
      // packing rule does.
      const expanded: CutPiece[] = [];
      for (const piece of group) {
        for (let i = 0; i < piece.quantity; i += 1) expanded.push({ ...piece, quantity: 1 });
      }
      expanded.sort((a, b) => Math.max(b.length, b.width) - Math.max(a.length, a.width));

      const result = this.packGroup(expanded, stock.width, stock.length);
      oversized.push(...result.oversized);

      for (const sheet of result.sheets) {
        sheets.push({ ...sheet, material: material as SheetMaterial, thickness });
        sheetArea += (stock.width * stock.length) / 144;
        cost += stock.price;
      }

      for (const piece of expanded) pieceArea += (piece.length * piece.width) / 144;
    }

    return { sheets, oversized, cost, pieceArea, sheetArea };
  }

  /** Packs one material-and-thickness group onto as many sheets as it needs. */
  private packGroup(
    pieces: readonly CutPiece[],
    sheetWidth: number,
    sheetLength: number,
  ): { sheets: Array<Omit<NestedSheet, 'material' | 'thickness'>>; oversized: SheetPlan['oversized'] } {
    const sheets: Array<{ shelves: Shelf[]; placed: PlacedPiece[] }> = [];
    const oversized: SheetPlan['oversized'] = [];

    for (const piece of pieces) {
      // Whether a piece fits the sheet *at all* is tested against its raw
      // size, not its kerf-inflated size: a 48" piece can come off a 48" sheet
      // using both factory edges. Kerf still applies between neighbours, which
      // is where the saw actually removes material.
      const fitsUnrotated = piece.length <= sheetLength && piece.width <= sheetWidth;
      const fitsRotated = piece.width <= sheetLength && piece.length <= sheetWidth;

      if (!fitsUnrotated && !fitsRotated) {
        oversized.push({
          piece,
          reason: `${piece.name}: ${piece.length}" × ${piece.width}" does not fit a ${sheetWidth}" × ${sheetLength}" sheet in either orientation. Split it into two pieces and join them.`,
        });
        continue;
      }

      if (!this.placeOnExisting(sheets, piece, sheetWidth, sheetLength)) {
        const sheet = { shelves: [] as Shelf[], placed: [] as PlacedPiece[] };
        sheets.push(sheet);
        this.placeOnSheet(sheet, piece, sheetWidth, sheetLength);
      }
    }

    const sheetArea = sheetWidth * sheetLength;

    return {
      sheets: sheets.map((sheet) => ({
        width: sheetWidth,
        length: sheetLength,
        pieces: sheet.placed,
        utilisation:
          sheet.placed.reduce((sum, placed) => sum + placed.width * placed.length, 0) / sheetArea,
      })),
      oversized,
    };
  }

  /** Tries every open sheet in turn. */
  private placeOnExisting(
    sheets: Array<{ shelves: Shelf[]; placed: PlacedPiece[] }>,
    piece: CutPiece,
    sheetWidth: number,
    sheetLength: number,
  ): boolean {
    for (const sheet of sheets) {
      if (this.placeOnSheet(sheet, piece, sheetWidth, sheetLength)) return true;
    }
    return false;
  }

  /**
   * Places one piece on one sheet.
   *
   * Existing shelves are tried before opening a new one, and both orientations
   * are tried on each. The piece runs along the sheet's length so shelves stack
   * across its width, which suits plywood: it puts long cabinet sides in the
   * same row rather than each opening a shelf of its own.
   */
  private placeOnSheet(
    sheet: { shelves: Shelf[]; placed: PlacedPiece[] },
    piece: CutPiece,
    sheetWidth: number,
    sheetLength: number,
  ): boolean {
    const orientations: Array<{ along: number; across: number; rotated: boolean }> = [
      { along: piece.length, across: piece.width, rotated: false },
      { along: piece.width, across: piece.length, rotated: true },
    ];

    for (const shelf of sheet.shelves) {
      for (const option of orientations) {
        // A neighbour on the same shelf needs a saw cut between them, so kerf
        // is charged here but not against the sheet's own edge.
        if (option.along + KERF > sheetLength - shelf.used) continue;
        if (option.across > shelf.height) continue;

        sheet.placed.push({
          piece,
          x: shelf.used,
          y: shelf.y,
          length: option.along,
          width: option.across,
          rotated: option.rotated,
        });
        shelf.used += option.along + KERF;
        return true;
      }
    }

    const usedHeight = sheet.shelves.reduce((sum, shelf) => Math.max(sum, shelf.y + shelf.height), 0);

    for (const option of orientations) {
      if (option.along > sheetLength) continue;
      // A new shelf below an existing one needs a rip between them.
      const clearance = usedHeight === 0 ? sheetWidth : sheetWidth - usedHeight - KERF;
      if (option.across > clearance) continue;

      const shelf: Shelf = {
        y: usedHeight === 0 ? 0 : usedHeight + KERF,
        height: option.across,
        used: option.along + KERF,
      };
      sheet.shelves.push(shelf);
      sheet.placed.push({
        piece,
        x: 0,
        y: shelf.y,
        length: option.along,
        width: option.across,
        rotated: option.rotated,
      });
      return true;
    }

    return false;
  }
}
