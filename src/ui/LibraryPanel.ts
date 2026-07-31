import type { Application } from '@/core/Application';
import { CATEGORY_LABELS, type LibraryItem } from '@/library/LibraryTypes';
import { formatLength } from '@/math/Units';

/**
 * The library browser.
 *
 * Lives in a left drawer rather than the right sidebar because the right side
 * is the inspector: the two are used in sequence, not alternately, and putting
 * them on the same edge would mean the browser closing every time an object is
 * placed and selected.
 *
 * Each entry shows its dimensions and weight on the card. Those are the two
 * numbers that decide whether an item is worth considering, and making the user
 * place something to find out how big it is wastes a placement.
 */
export class LibraryPanel {
  readonly element: HTMLElement;

  private readonly app: Application;
  private readonly search: HTMLInputElement;
  private readonly results: HTMLElement;
  private query = '';

  constructor(app: Application) {
    this.app = app;

    this.element = document.createElement('aside');
    this.element.className = 'library';
    this.element.hidden = true;

    const header = document.createElement('div');
    header.className = 'library__header';

    const title = document.createElement('span');
    title.className = 'library__title';
    title.textContent = 'Library';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'library__close';
    close.textContent = '×';
    close.title = 'Close library — L';
    close.setAttribute('aria-label', 'Close library');
    close.addEventListener('click', () => this.setOpen(false));

    header.append(title, close);

    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'library__search';
    this.search.placeholder = 'Search components';
    this.search.spellcheck = false;
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.render();
    });

    this.results = document.createElement('div');
    this.results.className = 'library__results';

    this.element.append(header, this.search, this.results);

    app.bus.on('units:changed', () => this.render());
    this.render();
  }

  /** True while the drawer is showing. */
  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Opens or closes the drawer, focusing search on open. */
  setOpen(open: boolean): void {
    this.element.hidden = !open;
    this.app.bus.emit('library:toggled', { open });
    if (open) this.search.focus();
  }

  /** Rebuilds the result list for the current query. */
  private render(): void {
    const groups = this.app.library.search(this.query);

    if (groups.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Nothing matches that search.';
      this.results.replaceChildren(empty);
      return;
    }

    const nodes: Node[] = [];
    for (const group of groups) {
      const heading = document.createElement('h3');
      heading.className = 'library__category';
      heading.textContent = CATEGORY_LABELS[group.category];
      nodes.push(heading);

      for (const item of group.items) nodes.push(this.buildCard(item));
    }

    this.results.replaceChildren(...nodes);
  }

  /** Builds one item card. */
  private buildCard(item: LibraryItem): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'library-item';
    card.title = item.notes;
    card.addEventListener('click', () => this.app.beginPlacing(item));

    const swatch = document.createElement('span');
    swatch.className = 'library-item__swatch';
    swatch.style.background = item.color;

    const body = document.createElement('span');
    body.className = 'library-item__body';

    const name = document.createElement('span');
    name.className = 'library-item__name';
    name.textContent = item.name;

    const description = document.createElement('span');
    description.className = 'library-item__description';
    description.textContent = item.description;

    const meta = document.createElement('span');
    meta.className = 'library-item__meta';
    const unit = this.app.unit;
    const [width, height, depth] = item.dimensions;
    const size = `${formatLength(width, unit)} × ${formatLength(height, unit)} × ${formatLength(depth, unit)}`;
    meta.textContent = item.weight > 0 ? `${size} · ${item.weight} lb` : size;

    body.append(name, description, meta);
    card.append(swatch, body);
    return card;
  }
}
