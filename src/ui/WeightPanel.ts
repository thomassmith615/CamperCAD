import type { Application } from '@/core/Application';
import type { LoadCheck, WeightReport } from '@/analysis/WeightTypes';
import { formatLength } from '@/math/Units';
import { Panel } from './Panel';

/** Formats a weight for display, in pounds or kilograms. */
function formatWeight(pounds: number, metric: boolean): string {
  return metric ? `${Math.round(pounds * 0.4536)} kg` : `${Math.round(pounds)} lb`;
}

/**
 * The weight and balance panel.
 *
 * This is the panel that can tell a builder their design does not work. Every
 * other readout in the application describes what they drew; this one checks it
 * against limits that exist whether or not anyone consults them.
 *
 * It is shown when nothing is selected, alongside the vehicle summary, because
 * weight is a property of the whole build rather than of any one object. The
 * load bars are the primary display: a number next to a limit requires
 * arithmetic, a bar filling toward a marked line does not.
 */
export class WeightPanel {
  readonly panel: Panel;

  private readonly app: Application;
  private readonly bars = new Map<string, { fill: HTMLElement; value: HTMLElement; row: HTMLElement }>();
  private readonly summaryRows = new Map<string, HTMLElement>();
  private readonly warningList: HTMLElement;
  private readonly centreRow: HTMLElement;
  private readonly curbNote: HTMLElement;

  constructor(app: Application) {
    this.app = app;
    this.panel = new Panel('Weight & balance');

    this.summaryRows.set('build', this.panel.addReadout('Build weight', '', true));
    this.summaryRows.set('fluid', this.panel.addReadout('  of which fluid', '', true));
    this.summaryRows.set('curb', this.panel.addReadout('Empty van', '', true));
    this.summaryRows.set('gross', this.panel.addReadout('Loaded', '', true));
    this.summaryRows.set('remaining', this.panel.addReadout('Payload left', '', true));

    const bars = document.createElement('div');
    bars.className = 'load-bars';
    for (const label of ['Gross weight', 'Front axle', 'Rear axle']) {
      bars.append(this.buildBar(label));
    }
    this.panel.append(bars);

    this.centreRow = this.panel.addReadout('Build CG', '—', true);

    this.warningList = document.createElement('ul');
    this.warningList.className = 'weight-warnings';
    this.panel.append(this.warningList);

    const measure = document.createElement('button');
    measure.type = 'button';
    measure.className = 'panel-button';
    measure.textContent = 'Enter scale weights';
    measure.title = 'Use measured axle weights from a scale ticket';
    measure.addEventListener('click', () => this.promptForScaleWeights());
    this.panel.append(measure);

    this.curbNote = document.createElement('p');
    this.curbNote.className = 'hint';
    this.panel.append(this.curbNote);

    this.panel.addHint(
      'Crew, fuel, food and gear are <strong>not</strong> included. Weigh them separately and subtract from the payload left.',
    );

    for (const event of ['objects:added', 'objects:removed', 'object:changed', 'units:changed'] as const) {
      app.bus.on(event, () => this.refresh());
    }
    app.bus.on('vehicle:loaded', () => this.refresh());
    app.bus.on('weight:changed', ({ report }) => this.apply(report));
  }

  /** Recomputes and redraws. */
  refresh(): void {
    this.apply(this.app.weights.report());
  }

  /** Renders a report, or blanks the panel when there is no vehicle. */
  private apply(report: WeightReport | null): void {
    if (!report) return;

    const metric = this.app.unit === 'mm' || this.app.unit === 'cm' || this.app.unit === 'm';

    this.summaryRows.get('build')!.textContent = formatWeight(report.buildWeight, metric);
    this.summaryRows.get('fluid')!.textContent = formatWeight(report.fluidWeight, metric);
    this.summaryRows.get('curb')!.textContent = formatWeight(report.curbWeight, metric);
    this.summaryRows.get('gross')!.textContent = formatWeight(report.grossWeight, metric);

    const remaining = this.summaryRows.get('remaining')!;
    remaining.textContent = formatWeight(report.remainingPayload, metric);
    remaining.classList.toggle('row__value--warn', report.remainingPayload < 0);

    for (const check of report.checks) this.applyBar(check, metric);

    if (report.buildCentre) {
      const unit = this.app.unit;
      const { z, y } = report.buildCentre;
      this.centreRow.textContent = `${formatLength(z, unit)} aft · ${formatLength(y, unit)} up`;
    } else {
      this.centreRow.textContent = '—';
    }

    this.warningList.replaceChildren(
      ...report.warnings.map((text) => {
        const item = document.createElement('li');
        item.textContent = text;
        return item;
      }),
    );

    const override = this.app.weights.override;
    this.curbNote.innerHTML = override
      ? `Using your measured axle weights: ${Math.round(override.front)} lb front, ${Math.round(override.rear)} lb rear.`
      : 'Empty van weight is a published estimate for a base configuration. Weigh yours at a truck scale for a real number.';
  }

  /** Builds one load bar row. */
  private buildBar(label: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'load-bar';

    const caption = document.createElement('span');
    caption.className = 'load-bar__label';
    caption.textContent = label;

    const value = document.createElement('span');
    value.className = 'load-bar__value';

    const track = document.createElement('div');
    track.className = 'load-bar__track';

    const fill = document.createElement('div');
    fill.className = 'load-bar__fill';
    track.append(fill);

    row.append(caption, value, track);
    this.bars.set(label, { fill, value, row });
    return row;
  }

  /**
   * Updates one bar.
   *
   * The fill is capped at 100% of the track so an overloaded axle does not
   * render past the panel, but the caption still reports the true figure — the
   * bar is the alarm, the number is the answer.
   */
  private applyBar(check: LoadCheck, metric: boolean): void {
    const bar = this.bars.get(check.label);
    if (!bar) return;

    bar.fill.style.width = `${Math.min(100, check.utilisation * 100)}%`;
    bar.value.textContent = `${formatWeight(check.actual, metric)} / ${formatWeight(check.limit, metric)}`;

    bar.row.classList.toggle('is-caution', check.status === 'caution');
    bar.row.classList.toggle('is-over', check.status === 'over');
  }

  /**
   * Collects measured axle weights.
   *
   * A prompt rather than a dialog: this is entered once per build, from a scale
   * ticket already in hand, and a two-field form would be more machinery than
   * the task deserves.
   */
  private promptForScaleWeights(): void {
    const current = this.app.weights.override;

    const front = window.prompt('Front axle weight from the scale, in pounds (blank to clear)', 
      current ? String(Math.round(current.front)) : '');
    if (front === null) return;

    if (front.trim() === '') {
      this.app.setMeasuredCurb(null);
      return;
    }

    const rear = window.prompt('Rear axle weight from the scale, in pounds', 
      current ? String(Math.round(current.rear)) : '');
    if (rear === null) return;

    const frontValue = Number.parseFloat(front);
    const rearValue = Number.parseFloat(rear);
    if (!Number.isFinite(frontValue) || !Number.isFinite(rearValue)) return;

    this.app.setMeasuredCurb(frontValue, rearValue);
  }
}
