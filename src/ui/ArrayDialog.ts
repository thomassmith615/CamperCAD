import type { Application } from '@/core/Application';
import type { ArrayAxis, ArrayOptions } from '@/objects/StructureTypes';
import { MAX_ARRAY_COUNT } from '@/objects/ArrayBuilder';
import { formatLength, parseLength } from '@/math/Units';
import { Modal } from './Modal';

/** Axis choices, labelled in the van's own terms rather than as bare letters. */
const AXIS_CHOICES: Array<{ axis: ArrayAxis; label: string }> = [
  { axis: 'z', label: 'Front to back' },
  { axis: 'x', label: 'Side to side' },
  { axis: 'y', label: 'Up' },
];

/**
 * The array duplication dialog.
 *
 * Defaults to repeating front to back with a zero gap, which is the single most
 * common operation in a van build: a run of identical base cabinets butted
 * together down one wall.
 */
export class ArrayDialog {
  private readonly app: Application;
  private readonly modal: Modal;

  private readonly countInput: HTMLInputElement;
  private readonly distanceInput: HTMLInputElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly axisSelect: HTMLSelectElement;
  private readonly summary: HTMLElement;

  constructor(app: Application) {
    this.app = app;
    this.modal = new Modal('Array duplicate');

    const form = document.createElement('div');
    form.className = 'array-form';

    this.countInput = ArrayDialog.numberInput('4', '1', String(MAX_ARRAY_COUNT));
    this.distanceInput = ArrayDialog.textInput('0');

    this.modeSelect = document.createElement('select');
    this.modeSelect.className = 'field-select';
    for (const [value, label] of [
      ['gap', 'Gap between'],
      ['spacing', 'Centre spacing'],
    ] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.modeSelect.append(option);
    }

    this.axisSelect = document.createElement('select');
    this.axisSelect.className = 'field-select';
    for (const { axis, label } of AXIS_CHOICES) {
      const option = document.createElement('option');
      option.value = axis;
      option.textContent = label;
      this.axisSelect.append(option);
    }

    form.append(
      ArrayDialog.row('Copies', this.countInput),
      ArrayDialog.row('Direction', this.axisSelect),
      ArrayDialog.row('Measure by', this.modeSelect),
      ArrayDialog.row('Distance', this.distanceInput),
    );

    this.summary = document.createElement('p');
    this.summary.className = 'hint';

    for (const control of [this.countInput, this.distanceInput, this.modeSelect, this.axisSelect]) {
      control.addEventListener('input', () => this.updateSummary());
      control.addEventListener('change', () => this.updateSummary());
    }

    this.modal.setContent(form, this.summary);
    this.modal.addButton('Cancel', () => this.modal.close());
    this.modal.addButton('Create', () => this.commit(), 'primary');
  }

  /** Shows the dialog for the current selection. */
  open(): void {
    if (this.app.selection.size === 0) return;
    this.updateSummary();
    this.modal.open();
  }

  /** Reads the form into array options, or null when the input is unusable. */
  private read(): ArrayOptions | null {
    const count = Number.parseInt(this.countInput.value, 10);
    if (!Number.isFinite(count) || count < 1) return null;

    const distance = parseLength(this.distanceInput.value, this.app.unit);
    if (distance === null) return null;

    return {
      count: Math.min(count, MAX_ARRAY_COUNT),
      axis: this.axisSelect.value as ArrayAxis,
      distance,
      mode: this.modeSelect.value === 'spacing' ? 'spacing' : 'gap',
    };
  }

  /**
   * Describes what will be created.
   *
   * Reporting the total run length is the point: an array of eight cabinets is
   * only useful if it fits the van, and that is a number the user would
   * otherwise work out on paper.
   */
  private updateSummary(): void {
    const options = this.read();
    if (!options) {
      this.summary.textContent = 'Enter a whole number of copies and a valid distance.';
      return;
    }

    const sources = this.app.selection.size;
    const created = options.count * sources;
    const span = this.app.arrayRunLength(options);

    this.summary.textContent =
      `Creates ${created} object${created === 1 ? '' : 's'}. ` +
      `Total run including the original: ${formatLength(span, this.app.unit)}.`;
  }

  /** Creates the array and closes. */
  private commit(): void {
    const options = this.read();
    if (!options) return;

    this.app.arrayDuplicate(options);
    this.modal.close();
  }

  private static row(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';

    const caption = document.createElement('span');
    caption.className = 'row__label';
    caption.textContent = label;

    row.append(caption, control);
    return row;
  }

  private static numberInput(value: string, min: string, max: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'field-input';
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = '1';
    return input;
  }

  private static textInput(value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'field-input';
    input.value = value;
    input.spellcheck = false;
    return input;
  }
}
