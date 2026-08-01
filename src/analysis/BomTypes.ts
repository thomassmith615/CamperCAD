/**
 * Bill of materials and cut list vocabulary.
 *
 * The model already knows every object's size, weight and price. This
 * subsystem turns that into the two documents a build actually runs on: a
 * shopping list of things to buy, and a cut list of pieces to make.
 *
 * Lengths are inches, weights pounds, money US dollars.
 */

/** Materials a panel can be cut from. */
export type SheetMaterial = 'birch-ply' | 'baltic-birch' | 'sande-ply' | 'mdf' | 'aluminium' | 'other';

/** A stock sheet as sold. */
export interface StockSheet {
  material: SheetMaterial;
  label: string;
  /** Nominal sheet size in inches. */
  width: number;
  length: number;
  /** Thicknesses commonly stocked, in inches. */
  thicknesses: readonly number[];
  /** Typical price for one sheet at the most common thickness. */
  price: number;
  /** Pounds per square foot at 3/4", scaled linearly for other thicknesses. */
  weightPerSquareFootAt075: number;
}

/**
 * Stock sheets a conversion is realistically built from.
 *
 * Sizes are the North American 4 × 8 standard, except Baltic birch, which is
 * sold in 5 × 5 sheets — a difference that changes what fits and is worth
 * modelling rather than glossing over, since a 60" cabinet side is impossible
 * from a 5-foot sheet with grain running the wrong way.
 */
export const STOCK_SHEETS: readonly StockSheet[] = [
  {
    material: 'birch-ply',
    label: 'Birch plywood',
    width: 48,
    length: 96,
    thicknesses: [0.25, 0.5, 0.75],
    price: 75,
    weightPerSquareFootAt075: 2.2,
  },
  {
    material: 'baltic-birch',
    label: 'Baltic birch',
    width: 60,
    length: 60,
    thicknesses: [0.25, 0.5, 0.75],
    price: 95,
    weightPerSquareFootAt075: 2.4,
  },
  {
    material: 'sande-ply',
    label: 'Sande plywood',
    width: 48,
    length: 96,
    thicknesses: [0.25, 0.5, 0.75],
    price: 45,
    weightPerSquareFootAt075: 2.0,
  },
  {
    material: 'mdf',
    label: 'MDF',
    width: 48,
    length: 96,
    thicknesses: [0.5, 0.75],
    price: 40,
    weightPerSquareFootAt075: 3.6,
  },
  {
    material: 'aluminium',
    label: 'Aluminium sheet',
    width: 48,
    length: 96,
    thicknesses: [0.063, 0.125],
    price: 240,
    weightPerSquareFootAt075: 10.6,
  },
  {
    material: 'other',
    label: 'Other / unspecified',
    width: 48,
    length: 96,
    thicknesses: [0.75],
    price: 0,
    weightPerSquareFootAt075: 2.2,
  },
];

/** Display labels for the material picker. */
export const MATERIAL_LABELS: Record<SheetMaterial, string> = {
  'birch-ply': 'Birch plywood',
  'baltic-birch': 'Baltic birch',
  'sande-ply': 'Sande plywood',
  mdf: 'MDF',
  aluminium: 'Aluminium',
  other: 'Other',
};

/** Looks up a stock sheet by material. */
export function stockFor(material: SheetMaterial): StockSheet {
  return STOCK_SHEETS.find((sheet) => sheet.material === material) ?? STOCK_SHEETS[STOCK_SHEETS.length - 1];
}

/** One purchasable line in the bill of materials. */
export interface BomLine {
  /** What it is, taken from the object name with any copy numbering stripped. */
  name: string;
  quantity: number;
  /** Weight of one, including fluid if it holds any. */
  unitWeight: number;
  /** Price of one. Zero when unknown. */
  unitPrice: number;
  totalWeight: number;
  totalPrice: number;
  /** True when at least one object in this line has no price set. */
  priceUnknown: boolean;
}

/** One piece to be cut. */
export interface CutPiece {
  /** Source object name. */
  name: string;
  /** Long dimension, in inches. */
  length: number;
  /** Short dimension, in inches. */
  width: number;
  thickness: number;
  material: SheetMaterial;
  quantity: number;
}

/** A piece placed on a sheet by the nester. */
export interface PlacedPiece {
  piece: CutPiece;
  /** Position of the piece's corner on the sheet, in inches. */
  x: number;
  y: number;
  /** Placed dimensions, which differ from the piece when it was rotated. */
  width: number;
  length: number;
  rotated: boolean;
}

/** One stock sheet with pieces nested onto it. */
export interface NestedSheet {
  material: SheetMaterial;
  thickness: number;
  width: number;
  length: number;
  pieces: PlacedPiece[];
  /** Fraction of the sheet's area covered by pieces. */
  utilisation: number;
}

/** Everything the sheet-goods calculation produced. */
export interface SheetPlan {
  sheets: NestedSheet[];
  /** Pieces that fit no sheet at all, with why. */
  oversized: Array<{ piece: CutPiece; reason: string }>;
  /** Total cost of the sheets required. */
  cost: number;
  /** Total area of all pieces, in square feet. */
  pieceArea: number;
  /** Total area of the sheets consumed, in square feet. */
  sheetArea: number;
}

/** A complete bill of materials. */
export interface BomReport {
  lines: BomLine[];
  cutList: CutPiece[];
  sheets: SheetPlan;
  /** Total price of bought items, excluding sheet goods. */
  componentCost: number;
  /** Total weight of everything in the design. */
  totalWeight: number;
  /** True when any line is missing a price, so totals understate. */
  hasUnknownPrices: boolean;
}

/**
 * Saw kerf, in inches.
 *
 * A track saw or table saw removes about an eighth of an inch per cut. Ignoring
 * it is how a cut plan that works on paper leaves the last piece an eighth
 * short.
 */
export const KERF = 0.125;
