import type { Application } from '@/core/Application';
import type { ElectricalReport } from '@/analysis/ElectricalTypes';
import { SUN_HOURS, USABLE_FRACTION, type SystemVoltage } from '@/analysis/ElectricalTypes';
import { FileTransfer } from './FileTransfer';
import { Modal } from './Modal';

/** Tabs in the dialog. */
type ElectricalTab = 'budget' | 'loads' | 'wiring';

/** Escapes one CSV field. */
function field(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The electrical dialog.
 *
 * Three questions in the order a builder asks them: will my battery last, what
 * is using the power, and what wire do I need. The wiring tab is the one that
 * can prevent a fire, so it names the constraint that decided each gauge —
 * knowing that a run is voltage-drop limited rather than thermally limited
 * tells you that moving the appliance is a cheaper fix than buying cable.
 */
export class ElectricalDialog {
  private readonly app: Application;
  private readonly modal: Modal;
  private readonly tabBar: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<ElectricalTab, HTMLButtonElement>();

  private tab: ElectricalTab = 'budget';
  private report: ElectricalReport | null = null;

  constructor(app: Application) {
    this.app = app;
    this.modal = new Modal('Electrical');

    this.tabBar = document.createElement('div');
    this.tabBar.className = 'bom-tabs';

    for (const [tab, label] of [
      ['budget', 'Power budget'],
      ['loads', 'Loads'],
      ['wiring', 'Wiring'],
    ] as Array<[ElectricalTab, string]>) {
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

    const voltage = document.createElement('select');
    voltage.className = 'field-select bom-tabs__aside';
    for (const value of [12, 24] as SystemVoltage[]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value} V system`;
      voltage.append(option);
    }
    voltage.value = String(app.electrical.systemVoltage);
    voltage.addEventListener('change', () => {
      app.setSystemVoltage(Number(voltage.value) as SystemVoltage);
      this.report = app.electrical.report();
      this.render();
    });
    this.tabBar.append(voltage);

    this.body = document.createElement('div');
    this.body.className = 'bom-body';

    this.modal.setContent(this.tabBar, this.body);
    this.modal.addButton('Export CSV', () => this.exportCurrent(), 'primary');
    this.modal.addButton('Close', () => this.modal.close());
  }

  /** Recomputes and shows the dialog. */
  open(): void {
    this.report = this.app.electrical.report();
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
      case 'budget':
        this.body.replaceChildren(this.buildBudget(report));
        break;
      case 'loads':
        this.body.replaceChildren(this.buildLoads(report));
        break;
      case 'wiring':
        this.body.replaceChildren(this.buildWiring(report));
        break;
    }
  }

  /** The energy balance. */
  private buildBudget(report: ElectricalReport): HTMLElement {
    const wrapper = document.createElement('div');
    const { budget } = report;

    if (budget.dailyWattHours === 0 && budget.batteryAmpHours === 0) {
      wrapper.append(
        ElectricalDialog.note(
          'No electrical components in the design yet. Add a battery, some solar and a few appliances from the library.',
        ),
      );
      return wrapper;
    }

    const table = ElectricalDialog.table(['', 'Value']);
    const rows: Array<[string, string]> = [
      ['Daily consumption', `${Math.round(budget.dailyWattHours)} Wh`],
      ['  as amp-hours', `${Math.round(budget.dailyWattHours / budget.systemVoltage)} Ah`],
      ['Battery bank', `${Math.round(budget.batteryAmpHours)} Ah (${Math.round(budget.batteryAmpHours * budget.systemVoltage)} Wh)`],
      ['Usable energy', `${Math.round(budget.usableWattHours)} Wh at ${Math.round(USABLE_FRACTION * 100)}% depth`],
      ['Reserve, no charging', budget.daysOfAutonomy > 0 ? `${budget.daysOfAutonomy.toFixed(1)} days` : '—'],
      ['Solar installed', `${Math.round(budget.solarWatts)} W`],
      ['  summer harvest', `${Math.round(budget.solarSummer)} Wh/day`],
      ['  winter harvest', `${Math.round(budget.solarWinter)} Wh/day`],
      ['Inverter', budget.inverterWatts > 0 ? `${Math.round(budget.inverterWatts)} W` : 'none'],
      ['Peak AC load', `${Math.round(budget.peakAcWatts)} W`],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement('tr');
      row.append(ElectricalDialog.cell(label), ElectricalDialog.cell(value, 'numeric'));
      table.tBodies[0].append(row);
    }

    wrapper.append(table);

    if (budget.warnings.length > 0) {
      const list = document.createElement('ul');
      list.className = 'bom-problems';
      for (const text of budget.warnings) {
        const item = document.createElement('li');
        item.textContent = text;
        list.append(item);
      }
      wrapper.append(list);
    }

    wrapper.append(
      ElectricalDialog.note(
        `Solar assumes flat roof mounting at ${SUN_HOURS.summer} peak sun hours in summer and ${SUN_HOURS.winter} in winter, ` +
          'derated 30% for controller losses, heat and shade. A tilted array does considerably better; a shaded one does far worse.',
      ),
    );

    return wrapper;
  }

  /** The load inventory. */
  private buildLoads(report: ElectricalReport): HTMLElement {
    const wrapper = document.createElement('div');

    if (report.loads.length === 0) {
      wrapper.append(ElectricalDialog.note('No loads in the design.'));
      return wrapper;
    }

    const table = ElectricalDialog.table(['Load', 'Type', 'Watts', 'Hrs/day', 'Wh/day', 'Amps']);

    for (const load of report.loads) {
      const row = document.createElement('tr');
      row.append(
        ElectricalDialog.cell(load.name),
        ElectricalDialog.cell(load.kind.toUpperCase(), load.kind === 'ac' ? 'numeric muted' : 'numeric'),
        ElectricalDialog.cell(String(Math.round(load.watts)), 'numeric'),
        ElectricalDialog.cell(load.hoursPerDay.toFixed(1), 'numeric'),
        ElectricalDialog.cell(String(Math.round(load.dailyWattHours)), 'numeric'),
        ElectricalDialog.cell(load.batteryAmps.toFixed(1), 'numeric'),
      );
      table.tBodies[0].append(row);
    }

    const total = document.createElement('tr');
    total.className = 'is-total';
    total.append(
      ElectricalDialog.cell('Total'),
      ElectricalDialog.cell(''),
      ElectricalDialog.cell(''),
      ElectricalDialog.cell(''),
      ElectricalDialog.cell(String(Math.round(report.budget.dailyWattHours)), 'numeric'),
      ElectricalDialog.cell(''),
    );
    table.tBodies[0].append(total);

    wrapper.append(table);
    wrapper.append(
      ElectricalDialog.note(
        'Hours per day is duty cycle, not runtime. A fridge compressor cycles roughly a third of the time; edit any value in the object inspector.',
      ),
    );
    return wrapper;
  }

  /** The wiring plan. */
  private buildWiring(report: ElectricalReport): HTMLElement {
    const wrapper = document.createElement('div');

    if (!report.hasBattery) {
      wrapper.append(
        ElectricalDialog.note(
          'Place a battery to size the wiring. Run lengths are measured from the battery to each load, so its position matters.',
        ),
      );
      return wrapper;
    }

    if (report.circuits.length === 0) {
      wrapper.append(ElectricalDialog.note('No loads to wire.'));
      return wrapper;
    }

    const table = ElectricalDialog.table(['Circuit', 'Amps', 'Run', 'Wire', 'Drop', 'Fuse', 'Limited by']);

    for (const circuit of report.circuits) {
      const row = document.createElement('tr');
      if (circuit.problem) row.className = 'is-problem';

      row.append(
        ElectricalDialog.cell(circuit.load.name),
        ElectricalDialog.cell(circuit.load.batteryAmps.toFixed(1), 'numeric'),
        ElectricalDialog.cell(`${Math.round(circuit.runFeet)} ft`, 'numeric'),
        ElectricalDialog.cell(circuit.size ? `${circuit.size} AWG` : '—', 'numeric'),
        ElectricalDialog.cell(`${(circuit.actualDrop * 100).toFixed(1)}%`, 'numeric'),
        ElectricalDialog.cell(`${circuit.fuseAmps} A`, 'numeric'),
        ElectricalDialog.cell(
          circuit.limitedBy === 'voltage-drop' ? 'drop' : circuit.limitedBy === 'ampacity' ? 'ampacity' : '—',
          'numeric muted',
        ),
      );
      table.tBodies[0].append(row);
    }

    wrapper.append(table);

    const problems = report.circuits.filter((circuit) => circuit.problem);
    if (problems.length > 0) {
      const list = document.createElement('ul');
      list.className = 'bom-problems';
      for (const circuit of problems) {
        const item = document.createElement('li');
        item.textContent = `${circuit.load.name}: ${circuit.problem}`;
        list.append(item);
      }
      wrapper.append(list);
    }

    wrapper.append(
      ElectricalDialog.note(
        'Ampacity from ABYC E-11 for 105 °C insulation outside engine spaces. Drop budget is 3% of system voltage, ' +
          'measured over the round trip. Run lengths add 40% over the straight-line distance for routing plus 2 ft of slack. ' +
          'Fuses are sized at 125% of continuous load and protect the wire, not the appliance. ' +
          'Have any installation checked by someone qualified before you energise it.',
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

    if (this.tab === 'wiring') {
      suffix = 'wiring';
      rows = [['Circuit', 'Amps', 'Run (ft)', 'Wire (AWG)', 'Drop (%)', 'Fuse (A)', 'Limited by', 'Problem']];
      for (const circuit of report.circuits) {
        rows.push([
          circuit.load.name,
          circuit.load.batteryAmps.toFixed(1),
          circuit.runFeet.toFixed(1),
          circuit.size ?? '',
          (circuit.actualDrop * 100).toFixed(1),
          circuit.fuseAmps,
          circuit.limitedBy,
          circuit.problem ?? '',
        ]);
      }
    } else if (this.tab === 'loads') {
      suffix = 'loads';
      rows = [['Load', 'Type', 'Watts', 'Hours/day', 'Wh/day', 'Battery amps']];
      for (const load of report.loads) {
        rows.push([
          load.name,
          load.kind,
          load.watts,
          load.hoursPerDay,
          load.dailyWattHours.toFixed(0),
          load.batteryAmps.toFixed(1),
        ]);
      }
    } else {
      suffix = 'power-budget';
      const b = report.budget;
      rows = [
        ['Metric', 'Value', 'Unit'],
        ['System voltage', b.systemVoltage, 'V'],
        ['Daily consumption', b.dailyWattHours.toFixed(0), 'Wh'],
        ['Battery bank', b.batteryAmpHours.toFixed(0), 'Ah'],
        ['Usable energy', b.usableWattHours.toFixed(0), 'Wh'],
        ['Days of autonomy', b.daysOfAutonomy.toFixed(1), 'days'],
        ['Solar installed', b.solarWatts.toFixed(0), 'W'],
        ['Solar summer', b.solarSummer.toFixed(0), 'Wh/day'],
        ['Solar winter', b.solarWinter.toFixed(0), 'Wh/day'],
        ['Inverter', b.inverterWatts.toFixed(0), 'W'],
        ['Peak AC load', b.peakAcWatts.toFixed(0), 'W'],
      ];
      for (const warning of b.warnings) rows.push(['Warning', warning, '']);
    }

    const csv = `${rows.map((row) => row.map(field).join(',')).join('\n')}\n`;
    FileTransfer.download(`${name}-${suffix}.csv`, csv, 'text/csv');
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
