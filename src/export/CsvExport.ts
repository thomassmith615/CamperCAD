import type { BomReport } from '@/analysis/BomTypes';
import { MATERIAL_LABELS } from '@/analysis/BomTypes';

/**
 * Escapes one CSV field.
 *
 * Quoting is applied whenever the value contains a comma, a quote or a
 * newline. Object names routinely contain commas — `Base cabinet, 24"` — so
 * this is the common case rather than a defensive edge.
 */
function field(value: string | number): string {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Joins rows into a CSV document with a trailing newline. */
function toCsv(rows: Array<Array<string | number>>): string {
  return `${rows.map((row) => row.map(field).join(',')).join('\n')}\n`;
}

/**
 * Renders reports as CSV.
 *
 * CSV rather than a formatted PDF because these documents get used, not read:
 * a cut list goes into a spreadsheet where the builder adds their own columns,
 * ticks pieces off, and adjusts sizes after the first dry fit. A rigid layout
 * would be prettier and less useful.
 */
export class CsvExport {
  /** The purchase list: everything bought rather than made. */
  static bom(report: BomReport): string {
    const rows: Array<Array<string | number>> = [
      ['Item', 'Qty', 'Unit weight (lb)', 'Total weight (lb)', 'Unit price', 'Total price', 'Price known'],
    ];

    for (const line of report.lines) {
      rows.push([
        line.name,
        line.quantity,
        line.unitWeight.toFixed(1),
        line.totalWeight.toFixed(1),
        line.unitPrice > 0 ? line.unitPrice.toFixed(2) : '',
        line.totalPrice > 0 ? line.totalPrice.toFixed(2) : '',
        line.priceUnknown ? 'no' : 'yes',
      ]);
    }

    rows.push([]);
    rows.push(['Components subtotal', '', '', '', '', report.componentCost.toFixed(2), '']);
    rows.push(['Sheet goods', '', '', '', '', report.sheets.cost.toFixed(2), '']);
    rows.push([
      'Total',
      '',
      '',
      report.totalWeight.toFixed(1),
      '',
      (report.componentCost + report.sheets.cost).toFixed(2),
      '',
    ]);

    if (report.hasUnknownPrices) {
      rows.push([]);
      rows.push(['Note', 'Some items have no price set, so the totals understate the real cost.']);
    }

    return toCsv(rows);
  }

  /** The cut list: every piece to be made, with its material and thickness. */
  static cutList(report: BomReport): string {
    const rows: Array<Array<string | number>> = [
      ['Piece', 'Qty', 'Length (in)', 'Width (in)', 'Thickness (in)', 'Material'],
    ];

    for (const piece of report.cutList) {
      rows.push([
        piece.name,
        piece.quantity,
        piece.length,
        piece.width,
        piece.thickness,
        MATERIAL_LABELS[piece.material] ?? piece.material,
      ]);
    }

    rows.push([]);
    rows.push(['Sheets required', report.sheets.sheets.length]);
    rows.push(['Piece area (sq ft)', report.sheets.pieceArea.toFixed(1)]);
    rows.push(['Sheet area (sq ft)', report.sheets.sheetArea.toFixed(1)]);

    if (report.sheets.oversized.length > 0) {
      rows.push([]);
      rows.push(['Does not fit a sheet', 'Reason']);
      for (const entry of report.sheets.oversized) rows.push([entry.piece.name, entry.reason]);
    }

    return toCsv(rows);
  }

  /** The nesting plan: which piece goes where on which sheet. */
  static sheetPlan(report: BomReport): string {
    const rows: Array<Array<string | number>> = [
      ['Sheet', 'Material', 'Thickness (in)', 'Piece', 'X (in)', 'Y (in)', 'Placed L', 'Placed W', 'Rotated'],
    ];

    report.sheets.sheets.forEach((sheet, index) => {
      for (const placed of sheet.pieces) {
        rows.push([
          index + 1,
          MATERIAL_LABELS[sheet.material] ?? sheet.material,
          sheet.thickness,
          placed.piece.name,
          placed.x.toFixed(2),
          placed.y.toFixed(2),
          placed.length.toFixed(2),
          placed.width.toFixed(2),
          placed.rotated ? 'yes' : 'no',
        ]);
      }
    });

    return toCsv(rows);
  }
}
