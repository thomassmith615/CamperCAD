import { icon } from './icons';

/**
 * A collapsible section in the sidebar.
 *
 * The inspector is built from these rather than from a general-purpose GUI
 * library because CamperCAD's rows are not generic property editors: they carry
 * units, measurement styling and validation that a library's number widget
 * cannot express without fighting it. Keeping the primitive small means the
 * inspector's later property editors extend it instead of replacing it.
 */
export class Panel {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;

  /**
   * @param title Section heading, displayed uppercase.
   * @param collapsed Whether the section starts closed.
   */
  constructor(title: string, collapsed = false) {
    this.element = document.createElement('section');
    this.element.className = collapsed ? 'panel is-collapsed' : 'panel';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'panel__header';
    header.innerHTML = `<span class="panel__chevron">${icon('chevron', 12)}</span><span>${title}</span>`;
    header.setAttribute('aria-expanded', String(!collapsed));
    header.addEventListener('click', () => {
      const isCollapsed = this.element.classList.toggle('is-collapsed');
      header.setAttribute('aria-expanded', String(!isCollapsed));
    });

    this.body = document.createElement('div');
    this.body.className = 'panel__body';

    this.element.append(header, this.body);
  }

  /**
   * Adds a label/value row.
   *
   * @param label Left-hand caption.
   * @param value Initial value text.
   * @param measure Renders the value in the measurement colour, reserved for
   * dimensions read off the model rather than user-entered data.
   * @returns The value element, so callers can update it in place.
   */
  addReadout(label: string, value: string, measure = false): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';

    const caption = document.createElement('span');
    caption.className = 'row__label';
    caption.textContent = label;

    const readout = document.createElement('span');
    readout.className = measure ? 'row__value row__value--measure' : 'row__value';
    readout.textContent = value;

    row.append(caption, readout);
    this.body.append(row);
    return readout;
  }

  /**
   * Adds a checkbox row.
   *
   * @returns The input element, so callers can read or set it later.
   */
  addToggle(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
    const wrapper = document.createElement('label');
    wrapper.className = 'toggle';

    const caption = document.createElement('span');
    caption.className = 'toggle__label';
    caption.textContent = label;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));

    wrapper.append(caption, input);
    this.body.append(wrapper);
    return input;
  }

  /** Adds a paragraph of secondary text. Accepts inline markup for key hints. */
  addHint(html: string): void {
    const paragraph = document.createElement('p');
    paragraph.className = 'hint';
    paragraph.innerHTML = html;
    this.body.append(paragraph);
  }

  /** Appends arbitrary content to the panel body. */
  append(node: Node): void {
    this.body.append(node);
  }

  /** Removes every child of the panel body. */
  clear(): void {
    this.body.replaceChildren();
  }
}
