import type { Application } from '@/core/Application';
import type { PlumbingReport } from '@/analysis/PlumbingTypes';
import { QUIET_VELOCITY_FPS } from '@/analysis/PlumbingTypes';
import { FileTransfer } from './FileTransfer';
import { Modal } from './Modal';

/** Tabs in the dialog. */
type PlumbingTab = 'water' | 'fixtures' | 'runs';

/** Escapes one CSV field. */
function field(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The plumbing dialog.
 *
 * The water tab leads because endurance is the question that actually shapes a
 * van layout. How many days you can stay somewhere decides tank size, tank size
 * decides weight, and weight decides where the tank can go — a chain this
 * application can now show end to end.
 */
export class PlumbingDialog {
  private readonly app: Application;
  private readonly modal: Modal;
  private readonly tabBar: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<PlumbingTab, HTMLButtonElement>();

  private tab: PlumbingTab = 'water';
  private report: PlumbingReport | null = null;

  constructor(app: Application) {
    this.app = app;
    this.modal = new Modal('Plumbing');

    this.tabBar = document.createElement('div');
    this.tabBar.className = 'bom-tabs';

    for (const [tab, label] of [
      ['water', 'Water balance'],
      ['fixtures', 'Fixtures'],
      ['runs', 'Pipe runs'],
    ] as Array<[PlumbingTab, string]>) {
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
    this.report = this.app.plumbing.report();
    this.render();
    this.modal.open();
  }

  private render(): void {
    for (const [tab, button] of this.tabButtons) {
      button.classList.toggle('is-active', tab === this.tab);
    }

    const report = this.report;
    if (!report) return;

    switch (this.tab) {
      case 'water':
        this.body.replaceChildren(this.buildWater(report));
        break;
      case 'fixtures':
        this.body.replaceChildren(this.buildFixtures(report));
        break;
      case 'runs':
        this.body.replaceChildren(this.buildRuns(report));
        break;
    }
  }

  /** The capacity and endurance summary. */
  private buildWater(report: PlumbingReport): HTMLElement {
    const wrapper = document.createElement('div');
    const { budget } = report;

    if (budget.freshGallons === 0 && budget.dailyUse === 0) {
      wrapper.append(
        PlumbingDialog.note('No water system yet. Add a fresh tank, a pump and a fixture or two from the library.'),
      );
      return wrapper;
    }

    const table = PlumbingDialog.table(['', 'Value']);
    const rows: Array<[string, string]> = [
      ['Fresh capacity', `${budget.freshGallons.toFixed(1)} gal`],
      ['  weight when full', `${Math.round(budget.freshWeightFull)} lb`],
      ['Grey capacity', `${budget.greyGallons.toFixed(1)} gal`],
      ['Black capacity', budget.blackGallons > 0 ? `${budget.blackGallons.toFixed(1)} gal` : '—'],
      ['Daily use', `${budget.dailyUse.toFixed(1)} gal`],
      ['Daily grey produced', `${budget.dailyGrey.toFixed(1)} gal`],
      ['Fresh water lasts', budget.daysOfWater > 0 ? `${budget.daysOfWater.toFixed(1)} days` : '—'],
      ['Grey tank fills in', budget.daysToGreyFull > 0 ? `${budget.daysToGreyFull.toFixed(1)} days` : '—'],
      ['Peak demand', `${budget.peakDemandGpm.toFixed(1)} GPM`],
      ['Pump capacity', budget.pumpGpm > 0 ? `${budget.pumpGpm.toFixed(1)} GPM` : 'none'],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement('tr');
      row.append(PlumbingDialog.cell(label), PlumbingDialog.cell(value, 'numeric'));
      table.tBodies[0].append(row);
    }

    wrapper.append(table);
    wrapper.append(PlumbingDialog.warnings(budget.warnings));

    wrapper.append(
      PlumbingDialog.note(
        'Endurance assumes the tank starts full and nothing is refilled. Peak demand assumes the two thirstiest fixtures run together, ' +
          'which is the realistic worst case in a two-berth van.',
      ),
    );

    return wrapper;
  }

  /** The fixture inventory. */
  private buildFixtures(report: PlumbingReport): HTMLElement {
    const wrapper = document.createElement('div');

    if (report.fixtures.length === 0) {
      wrapper.append(PlumbingDialog.note('No fixtures in the design.'));
      return wrapper;
    }

    const table = PlumbingDialog.table(['Fixture', 'GPM', 'Min/day', 'Gal/day', 'Drains to']);

    for (const fixture of report.fixtures) {
      const row = document.createElement('tr');
      row.append(
        PlumbingDialog.cell(fixture.name),
        PlumbingDialog.cell(fixture.flowGpm.toFixed(1), 'numeric'),
        PlumbingDialog.cell(fixture.minutesPerDay.toFixed(0), 'numeric'),
        PlumbingDialog.cell(fixture.dailyGallons.toFixed(1), 'numeric'),
        PlumbingDialog.cell(fixture.drainsToGrey ? 'grey tank' : 'outside', 'numeric muted'),
      );
      table.tBodies[0].append(row);
    }

    const total = document.createElement('tr');
    total.className = 'is-total';
    total.append(
      PlumbingDialog.cell('Total'),
      PlumbingDialog.cell(''),
      PlumbingDialog.cell(''),
      PlumbingDialog.cell(report.budget.dailyUse.toFixed(1), 'numeric'),
      PlumbingDialog.cell(''),
    );
    table.tBodies[0].append(total);

    wrapper.append(table);
    wrapper.append(
      PlumbingDialog.note(
        'A shower is almost always the largest single draw. Eight minutes at 1.8 GPM is fourteen gallons — most of a small tank in one wash.',
      ),
    );
    return wrapper;
  }

  /** The supply run plan. */
  private buildRuns(report: PlumbingReport): HTMLElement {
    const wrapper = document.createElement('div');

    if (!report.hasFreshTank) {
      wrapper.append(
        PlumbingDialog.note('Place a fresh tank to size the pipe runs. Lengths are measured from the tank to each fixture.'),
      );
      return wrapper;
    }

    if (report.runs.length === 0) {
      wrapper.append(PlumbingDialog.note('No fixtures to supply.'));
      return wrapper;
    }

    const table = PlumbingDialog.table(['Run', 'GPM', 'Length', 'Tubing', 'Velocity', 'Drop']);

    for (const run of report.runs) {
      const row = document.createElement('tr');
      if (run.problem) row.className = 'is-problem';

      row.append(
        PlumbingDialog.cell(run.fixture.name),
        PlumbingDialog.cell(run.fixture.flowGpm.toFixed(1), 'numeric'),
        PlumbingDialog.cell(`${Math.round(run.runFeet)} ft`, 'numeric'),
        PlumbingDialog.cell(run.pipe?.label ?? '—', 'numeric'),
        PlumbingDialog.cell(
          `${run.velocityFps.toFixed(1)} ft/s`,
          run.velocityFps > QUIET_VELOCITY_FPS ? 'numeric' : 'numeric muted',
        ),
        PlumbingDialog.cell(`${run.pressureDropPsi.toFixed(1)} psi`, 'numeric muted'),
      );
      table.tBodies[0].append(row);
    }

    wrapper.append(table);
    wrapper.append(PlumbingDialog.warnings(report.runs.map((run) => run.problem).filter((p): p is string => !!p)));

    const totalFeet = report.runs.reduce((sum, run) => sum + run.runFeet, 0);
    wrapper.append(
      PlumbingDialog.note(
        `About ${Math.round(totalFeet)} ft of supply tubing before the return side and any manifold. ` +
          'Tubing is chosen by flow velocity rather than pressure drop: van runs are short enough that friction barely matters, ' +
          'but water moving faster than about 5 ft/s is audible through a wall you are sleeping against.',
      ),
    );

    return wrapper;
  }

  /** Downloads the active tab as CSV. */
  private exportCurrent(): void {
    const report = this.report;
    if (!report) return;

    const name = this.app.projects.project.name.replace(/[^\w.-]+/g, '-') || 'project';
    let rows: Array<Array<string | number>>;
    let suffix: string;

    if (this.tab === 'runs') {
      suffix = 'pipe-runs';
      rows = [['Run', 'GPM', 'Length (ft)', 'Tubing', 'Velocity (ft/s)', 'Drop (psi)', 'Note']];
      for (const run of report.runs) {
        rows.push([
          run.fixture.name,
          run.fixture.flowGpm.toFixed(1),
          run.runFeet.toFixed(1),
          run.pipe?.label ?? '',
          run.velocityFps.toFixed(1),
          run.pressureDropPsi.toFixed(2),
          run.problem ?? '',
        ]);
      }
    } else if (this.tab === 'fixtures') {
      suffix = 'fixtures';
      rows = [['Fixture', 'GPM', 'Minutes/day', 'Gallons/day', 'Drains to']];
      for (const fixture of report.fixtures) {
        rows.push([
          fixture.name,
          fixture.flowGpm.toFixed(1),
          fixture.minutesPerDay.toFixed(0),
          fixture.dailyGallons.toFixed(2),
          fixture.drainsToGrey ? 'grey' : 'outside',
        ]);
      }
    } else {
      suffix = 'water-balance';
      const b = report.budget;
      rows = [
        ['Metric', 'Value', 'Unit'],
        ['Fresh capacity', b.freshGallons.toFixed(1), 'gal'],
        ['Fresh weight full', b.freshWeightFull.toFixed(0), 'lb'],
        ['Grey capacity', b.greyGallons.toFixed(1), 'gal'],
        ['Black capacity', b.blackGallons.toFixed(1), 'gal'],
        ['Daily use', b.dailyUse.toFixed(2), 'gal'],
        ['Daily grey', b.dailyGrey.toFixed(2), 'gal'],
        ['Days of water', b.daysOfWater.toFixed(1), 'days'],
        ['Days to grey full', b.daysToGreyFull.toFixed(1), 'days'],
        ['Peak demand', b.peakDemandGpm.toFixed(1), 'GPM'],
        ['Pump capacity', b.pumpGpm.toFixed(1), 'GPM'],
      ];
      for (const warning of b.warnings) rows.push(['Warning', warning, '']);
    }

    const csv = `${rows.map((row) => row.map(field).join(',')).join('\n')}\n`;
    FileTransfer.download(`${name}-${suffix}.csv`, csv, 'text/csv');
  }

  private static warnings(messages: readonly string[]): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'bom-problems';
    for (const text of messages) {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    }
    return list;
  }

  private static table(headers: readonly string[]): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'bom-table';

    const headRow = table.createTHead().insertRow();
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
}
