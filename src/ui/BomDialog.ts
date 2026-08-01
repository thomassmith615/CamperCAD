import type { Application } from '@/core/Application';
import type { BomReport, NestedSheet } from '@/analysis/BomTypes';
import { MATERIAL_LABELS } from '@/analysis/BomTypes';
import { CsvExport } from '@/export/CsvExport';
import { FileTransfer } from './FileTransfer';
import { Modal } from './Modal';

/** Tabs in the dialog. */
type BomTab = 'components' | 'cuts' | 'sheets';

/** Width the sheet diagrams are drawn at, in pixels. */
const DIAGRAM_WIDTH = 440;

/**
 * The bill of materials dialog.
 *
 * Three views of the same design, because they answer different questions at
 * different times: what to buy, what to cut, and how to lay the cuts out on a
 * sheet. Each exports to CSV separately rather than as one file, since they get
 * used on different days by different people.
 *
 * The sheet diagrams are drawn rather than tabulated. A table of coordinates is
 * unreadable next to a saw; a picture of a sheet with rectangles on it is what
 * a cut plan looks like everywhere else, and the whole point is that it can be
 * checked at a glance before any plywood is bought.
 */
export class BomDialog {
  private readonly app: Application;
  private readonly modal: Modal;
  private readonly tabBar: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<BomTab, HTMLButtonElement>();

  private tab: BomTab = 'components';
  private report: BomReport | null = null;

  constructor(app: Application) {
    this.app = app;
    this.modal = new Modal('Bill of materials');

    this.tabBar = document.createElement('div');
    this.tabBar.className = 'bom-tabs';

    for (const [tab, label] of [
      ['components', 'Buy'],
      ['cuts', 'Cut list'],
      ['sheets', 'Sheet layout'],
    ] as Array<[BomTab, string]>) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bom-tab';
      button.textContent = label;
      button.addEventListener('click', () => {
        this.tab = tab;
        this.render();
      });
      this.tabBar.append(button);
      this.tabButtons.set(tab, button);
    }

    this.body = document.createElement('div');
    this.body.className = 'bom-body';

    this.modal.setContent(this.tabBar, this.body);
    this.modal.addButton('Export CSV', () => this.exportCurrent(), 'primary');
    this.modal.addButton('Close', () => this.modal.close());
  }

  /** Recomputes and shows the dialog. */
  open(): void {
    this.report = this.app.bom.report();
    this.render();
    this.modal.open();
  }

  /** Draws the active tab. */
  private render(): void {
    for (const [tab, button] of this.tabButtons) {
      button.classList.toggle('is-active', tab === this.tab);
    }

    const report = this.report;
    if (!report) return;

    switch (this.tab) {
      case 'components':
        this.body.replaceChildren(this.buildComponents(report));
        break;
      case 'cuts':
        this.body.replaceChildren(this.buildCutList(report));
        break;
      case 'sheets':
        this.body.replaceChildren(this.buildSheets(report));
        break;
    }
  }

  /** The purchase list. */
  private buildComponents(report: BomReport): HTMLElement {
    const wrapper = document.createElement('div');

    if (report.lines.length === 0) {
      wrapper.append(BomDialog.emptyState('Nothing to buy yet. Place some components first.'));
      return wrapper;
    }

    const table = BomDialog.table(['Item', 'Qty', 'Weight', 'Price']);

    for (const line of report.lines) {
      const row = document.createElement('tr');
      row.append(
        BomDialog.cell(line.name),
        BomDialog.cell(String(line.quantity), 'numeric'),
        BomDialog.cell(`${Math.round(line.totalWeight)} lb`, 'numeric'),
        BomDialog.cell(
          line.priceUnknown ? '—' : `$${line.totalPrice.toFixed(0)}`,
          line.priceUnknown ? 'numeric muted' : 'numeric',
        ),
      );
      table.tBodies[0].append(row);
    }

    const totals = document.createElement('tr');
    totals.className = 'is-total';
    totals.append(
      BomDialog.cell('Components'),
      BomDialog.cell(''),
      BomDialog.cell(`${Math.round(report.totalWeight)} lb`, 'numeric'),
      BomDialog.cell(`$${report.componentCost.toFixed(0)}`, 'numeric'),
    );
    table.tBodies[0].append(totals);

    const sheets = document.createElement('tr');
    sheets.className = 'is-total';
    sheets.append(
      BomDialog.cell(`Sheet goods (${report.sheets.sheets.length} sheets)`),
      BomDialog.cell(''),
      BomDialog.cell(''),
      BomDialog.cell(`$${report.sheets.cost.toFixed(0)}`, 'numeric'),
    );
    table.tBodies[0].append(sheets);

    wrapper.append(table);

    if (report.hasUnknownPrices) {
      wrapper.append(
        BomDialog.note(
          'Some items have no price set, shown as a dash. The total is what is known so far, not the real cost.',
        ),
      );
    }

    return wrapper;
  }

  /** The cut list. */
  private buildCutList(report: BomReport): HTMLElement {
    const wrapper = document.createElement('div');

    if (report.cutList.length === 0) {
      wrapper.append(
        BomDialog.emptyState('No panels in this design. Place panel objects to build a cut list.'),
      );
      return wrapper;
    }

    const table = BomDialog.table(['Piece', 'Qty', 'Length', 'Width', 'Thick', 'Material']);

    for (const piece of report.cutList) {
      const row = document.createElement('tr');
      row.append(
        BomDialog.cell(piece.name),
        BomDialog.cell(String(piece.quantity), 'numeric'),
        BomDialog.cell(`${piece.length}"`, 'numeric'),
        BomDialog.cell(`${piece.width}"`, 'numeric'),
        BomDialog.cell(`${piece.thickness}"`, 'numeric'),
        BomDialog.cell(MATERIAL_LABELS[piece.material] ?? piece.material),
      );
      table.tBodies[0].append(row);
    }

    wrapper.append(table);

    if (report.sheets.oversized.length > 0) {
      const list = document.createElement('ul');
      list.className = 'bom-problems';
      for (const entry of report.sheets.oversized) {
        const item = document.createElement('li');
        item.textContent = entry.reason;
        list.append(item);
      }
      wrapper.append(list);
    }

    return wrapper;
  }

  /** The nesting diagrams. */
  private buildSheets(report: BomReport): HTMLElement {
    const wrapper = document.createElement('div');
    const { sheets, pieceArea, sheetArea } = report.sheets;

    if (sheets.length === 0) {
      wrapper.append(BomDialog.emptyState('No sheet goods needed.'));
      return wrapper;
    }

    const waste = sheetArea > 0 ? 1 - pieceArea / sheetArea : 0;
    wrapper.append(
      BomDialog.note(
        `${sheets.length} sheets · ${pieceArea.toFixed(1)} sq ft of pieces from ${sheetArea.toFixed(1)} sq ft of stock · ` +
          `${Math.round(waste * 100)}% offcut. This layout is a good estimate, not an optimal one — lay out the real cuts at the saw.`,
      ),
    );

    sheets.forEach((sheet, index) => wrapper.append(this.buildSheetDiagram(sheet, index)));
    return wrapper;
  }

  /** Draws one sheet with its pieces as an SVG. */
  private buildSheetDiagram(sheet: NestedSheet, index: number): HTMLElement {
    const figure = document.createElement('figure');
    figure.className = 'sheet-figure';

    const caption = document.createElement('figcaption');
    caption.className = 'sheet-figure__caption';
    caption.textContent =
      `Sheet ${index + 1} · ${MATERIAL_LABELS[sheet.material]} ${sheet.thickness}" · ` +
      `${sheet.width}" × ${sheet.length}" · ${Math.round(sheet.utilisation * 100)}% used`;

    const scale = DIAGRAM_WIDTH / sheet.length;
    const height = sheet.width * scale;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${sheet.length} ${sheet.width}`);
    svg.setAttribute('width', String(DIAGRAM_WIDTH));
    svg.setAttribute('height', String(height));
    svg.setAttribute('class', 'sheet-svg');

    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', String(sheet.length));
    background.setAttribute('height', String(sheet.width));
    background.setAttribute('class', 'sheet-svg__stock');
    svg.append(background);

    for (const placed of sheet.pieces) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(placed.x));
      rect.setAttribute('y', String(placed.y));
      rect.setAttribute('width', String(placed.length));
      rect.setAttribute('height', String(placed.width));
      rect.setAttribute('class', 'sheet-svg__piece');

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${placed.piece.name} — ${placed.piece.length}" × ${placed.piece.width}"${
        placed.rotated ? ' (rotated)' : ''
      }`;
      rect.append(title);
      svg.append(rect);
    }

    figure.append(svg, caption);
    return figure;
  }

  /** Downloads the active tab as CSV. */
  private exportCurrent(): void {
    const report = this.report;
    if (!report) return;

    const name = this.app.projects.project.name.replace(/[^\w.-]+/g, '-') || 'project';

    switch (this.tab) {
      case 'components':
        FileTransfer.download(`${name}-bom.csv`, CsvExport.bom(report), 'text/csv');
        break;
      case 'cuts':
        FileTransfer.download(`${name}-cutlist.csv`, CsvExport.cutList(report), 'text/csv');
        break;
      case 'sheets':
        FileTransfer.download(`${name}-sheets.csv`, CsvExport.sheetPlan(report), 'text/csv');
        break;
    }
  }

  private static table(headers: readonly string[]): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'bom-table';

    const head = table.createTHead();
    const headRow = head.insertRow();
    for (const header of headers) {
      const cell = document.createElement('th');
      cell.textContent = header;
      headRow.append(cell);
    }

    table.createTBody();
    return table;
  }

  private static cell(text: string, className = ''): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  private static note(text: string): HTMLElement {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = text;
    return note;
  }

  private static emptyState(text: string): HTMLElement {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = text;
    return empty;
  }
}
