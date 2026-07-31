/**
 * A centred modal dialog.
 *
 * Built rather than borrowed for the same reason as the rest of the interface:
 * the application has two dialogs and one dependency, and a dialog library
 * would be larger than both. Uses the native `<dialog>` element so focus
 * trapping, the top layer and Escape handling come from the platform instead of
 * being reimplemented badly.
 */
export class Modal {
  private readonly dialog: HTMLDialogElement;
  private readonly body: HTMLElement;
  private readonly footer: HTMLElement;

  /**
   * @param title Heading shown at the top of the dialog.
   */
  constructor(title: string) {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'modal';

    const heading = document.createElement('h2');
    heading.className = 'modal__title';
    heading.textContent = title;

    this.body = document.createElement('div');
    this.body.className = 'modal__body';

    this.footer = document.createElement('div');
    this.footer.className = 'modal__footer';

    this.dialog.append(heading, this.body, this.footer);
    document.body.append(this.dialog);

    // Clicking the backdrop lands on the dialog element itself, since the
    // padded content sits in child elements.
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });
  }

  /** The dialog's content area, for callers to populate. */
  get content(): HTMLElement {
    return this.body;
  }

  /** True while the dialog is showing. */
  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** Replaces the dialog's content. */
  setContent(...nodes: Node[]): void {
    this.body.replaceChildren(...nodes);
  }

  /**
   * Adds a footer button.
   *
   * @param label Button text.
   * @param onClick Handler. The dialog is not closed automatically, so a
   * handler that fails validation can leave it open.
   * @param variant `primary` for the confirming action.
   */
  addButton(label: string, onClick: () => void, variant: 'primary' | 'default' = 'default'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = variant === 'primary' ? 'modal__button modal__button--primary' : 'modal__button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    this.footer.append(button);
    return button;
  }

  /** Shows the dialog as a modal. */
  open(): void {
    if (!this.dialog.open) this.dialog.showModal();
  }

  /** Hides the dialog. */
  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /** Removes the dialog from the document. */
  dispose(): void {
    this.dialog.remove();
  }
}
