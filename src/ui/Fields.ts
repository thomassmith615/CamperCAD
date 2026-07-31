import { formatAngle, formatLength, parseLength, type DisplayUnit } from '@/math/Units';

/** What a field edits, which decides how it formats and parses. */
export type FieldKind = 'length' | 'angle' | 'number';

/**
 * A validating property field.
 *
 * Fields display in the active unit and accept whatever a builder would type:
 * `36`, `3'`, `3' 6"`, `914mm`. Input is committed on blur or Enter, never on
 * every keystroke, so a partially typed value is not applied to the model.
 *
 * Rejected input restores the previous value rather than writing `NaN`. Silent
 * correction is the right behaviour here — the model must never hold a
 * dimension the user cannot see.
 */
export class NumberField {
  readonly element: HTMLElement;

  private readonly input: HTMLInputElement;
  private readonly kind: FieldKind;
  private readonly onCommit: (value: number) => void;
  private unit: DisplayUnit;
  private value = 0;

  /**
   * @param label Caption shown to the left of the input.
   * @param kind What the value represents.
   * @param unit Initial display unit.
   * @param onCommit Called with the new internal value when input is accepted.
   */
  constructor(label: string, kind: FieldKind, unit: DisplayUnit, onCommit: (value: number) => void) {
    this.kind = kind;
    this.unit = unit;
    this.onCommit = onCommit;

    this.element = document.createElement('div');
    this.element.className = 'row';

    const caption = document.createElement('span');
    caption.className = 'row__label';
    caption.textContent = label;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'field-input';
    this.input.spellcheck = false;

    this.input.addEventListener('focus', () => this.input.select());
    this.input.addEventListener('blur', () => this.commit());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.commit();
        this.input.blur();
      } else if (event.key === 'Escape') {
        this.render();
        this.input.blur();
      }
    });

    this.element.append(caption, this.input);
  }

  /** Sets the value shown, without invoking the commit callback. */
  setValue(value: number): void {
    this.value = value;
    if (document.activeElement !== this.input) this.render();
  }

  /** Changes the display unit and re-renders. */
  setUnit(unit: DisplayUnit): void {
    this.unit = unit;
    this.render();
  }

  /** Greys out the field, e.g. for a locked object. */
  setDisabled(disabled: boolean): void {
    this.input.disabled = disabled;
  }

  /** Formats the internal value into the input. */
  private render(): void {
    switch (this.kind) {
      case 'length':
        this.input.value = formatLength(this.value, this.unit);
        break;
      case 'angle':
        this.input.value = formatAngle(this.value);
        break;
      case 'number':
        this.input.value = String(Math.round(this.value * 100) / 100);
        break;
    }
  }

  /** Parses the input and reports it, or reverts if it cannot be read. */
  private commit(): void {
    const parsed = this.parse(this.input.value);
    if (parsed === null) {
      this.render();
      return;
    }
    if (Math.abs(parsed - this.value) > 1e-6) this.onCommit(parsed);
    this.value = parsed;
    this.render();
  }

  /** Converts typed text into an internal value, or null when unreadable. */
  private parse(text: string): number | null {
    if (this.kind === 'length') return parseLength(text, this.unit);

    const numeric = Number.parseFloat(text.replace(/[^\d.eE+-]/g, ''));
    if (!Number.isFinite(numeric)) return null;
    return this.kind === 'angle' ? (numeric * Math.PI) / 180 : numeric;
  }
}

/**
 * A single-line text field with the same commit semantics as
 * {@link NumberField}, used for names.
 */
export class TextField {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private value = '';

  constructor(label: string, onCommit: (value: string) => void) {
    this.element = document.createElement('div');
    this.element.className = 'row';

    const caption = document.createElement('span');
    caption.className = 'row__label';
    caption.textContent = label;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'field-input field-input--text';
    this.input.spellcheck = false;

    const commit = () => {
      const next = this.input.value.trim();
      if (next === '' || next === this.value) {
        this.input.value = this.value;
        return;
      }
      this.value = next;
      onCommit(next);
    };

    this.input.addEventListener('blur', commit);
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.input.blur();
      if (event.key === 'Escape') {
        this.input.value = this.value;
        this.input.blur();
      }
    });

    this.element.append(caption, this.input);
  }

  /** Sets the text shown, without invoking the commit callback. */
  setValue(value: string): void {
    this.value = value;
    if (document.activeElement !== this.input) this.input.value = value;
  }
}

/** A colour swatch bound to a property. */
export class ColorField {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;

  constructor(label: string, onCommit: (value: string) => void) {
    this.element = document.createElement('div');
    this.element.className = 'row';

    const caption = document.createElement('span');
    caption.className = 'row__label';
    caption.textContent = label;

    this.input = document.createElement('input');
    this.input.type = 'color';
    this.input.className = 'field-color';
    this.input.addEventListener('change', () => onCommit(this.input.value));

    this.element.append(caption, this.input);
  }

  /** Sets the swatch colour from a `#rrggbb` string. */
  setValue(value: string): void {
    this.input.value = value;
  }
}

/** A multi-line notes field, committed on blur. */
export class NotesField {
  readonly element: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private value = '';

  constructor(onCommit: (value: string) => void) {
    this.element = document.createElement('div');
    this.element.className = 'row row--stack';

    this.input = document.createElement('textarea');
    this.input.className = 'field-textarea';
    this.input.rows = 3;
    this.input.placeholder = 'Notes';

    this.input.addEventListener('blur', () => {
      if (this.input.value === this.value) return;
      this.value = this.input.value;
      onCommit(this.value);
    });

    this.element.append(this.input);
  }

  /** Sets the note text, without invoking the commit callback. */
  setValue(value: string): void {
    this.value = value;
    if (document.activeElement !== this.input) this.input.value = value;
  }
}
