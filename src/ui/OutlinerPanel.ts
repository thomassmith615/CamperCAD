import type { Application } from '@/core/Application';
import type { SceneObject } from '@/objects/SceneObject';
import type { GroupData, LayerData } from '@/objects/StructureTypes';
import { icon } from './icons';

/**
 * The outliner: every object in the design, filed under its layer.
 *
 * A viewport alone stops scaling somewhere around thirty objects. Once a build
 * has cabinets behind a bed behind a bulkhead, the only reliable way to reach a
 * specific thing is a list — and the only way to work on the wiring is to hide
 * everything that is not wiring.
 *
 * Visibility and lock appear at both levels because they mean different things.
 * A layer toggle is a workflow switch, flipped many times an hour; an object
 * toggle is a property of that object, set once. The layer state wins for
 * visibility, and lock is inherited one way — a locked layer locks its members,
 * but unlocking the layer does not release an object the user locked by hand.
 */
export class OutlinerPanel {
  readonly element: HTMLElement;

  private readonly app: Application;
  private readonly body: HTMLElement;
  private renameTarget: string | null = null;

  constructor(app: Application) {
    this.app = app;

    this.element = document.createElement('aside');
    this.element.className = 'outliner';
    this.element.hidden = true;

    const header = document.createElement('div');
    header.className = 'outliner__header';

    const title = document.createElement('span');
    title.className = 'outliner__title';
    title.textContent = 'Outliner';

    const addLayer = document.createElement('button');
    addLayer.type = 'button';
    addLayer.className = 'outliner__action';
    addLayer.textContent = '+ Layer';
    addLayer.title = 'Add a layer';
    addLayer.addEventListener('click', () => {
      this.app.structure.addLayer();
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'outliner__close';
    close.textContent = '×';
    close.title = 'Close outliner — Shift+L';
    close.setAttribute('aria-label', 'Close outliner');
    close.addEventListener('click', () => this.setOpen(false));

    header.append(title, addLayer, close);

    this.body = document.createElement('div');
    this.body.className = 'outliner__body';

    this.element.append(header, this.body);

    app.bus.on('structure:changed', () => this.render());
    app.bus.on('objects:added', () => this.render());
    app.bus.on('objects:removed', () => this.render());
    app.bus.on('selection:changed', () => this.render());
    app.bus.on('object:changed', ({ key }) => {
      if (key === 'name' || key === 'visible' || key === 'locked' || key === 'layerId' || key === 'groupId') {
        this.render();
      }
    });

    this.render();
  }

  /** True while the panel is showing. */
  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Opens or closes the panel. */
  setOpen(open: boolean): void {
    this.element.hidden = !open;
    this.element.parentElement?.classList.toggle('has-outliner', open);
    this.app.bus.emit('outliner:toggled', { open });
    if (open) this.render();
  }

  /** Rebuilds the whole tree. */
  private render(): void {
    if (!this.isOpen) return;

    const nodes: Node[] = [];
    for (const layer of this.app.structure.layers) nodes.push(this.buildLayer(layer));

    this.body.replaceChildren(...nodes);
  }

  /** Builds a layer heading and its contents. */
  private buildLayer(layer: LayerData): HTMLElement {
    const section = document.createElement('section');
    section.className = 'outliner-layer';

    const head = document.createElement('div');
    head.className = 'outliner-layer__head';

    const swatch = document.createElement('span');
    swatch.className = 'outliner-layer__swatch';
    swatch.style.background = layer.color;

    const name = this.buildEditableName(layer.name, `layer:${layer.id}`, (next) =>
      this.app.structure.updateLayer(layer.id, { name: next }),
    );
    name.classList.add('outliner-layer__name');

    const objects = this.app.structure.objectsInLayer(layer.id);
    const count = document.createElement('span');
    count.className = 'outliner-layer__count';
    count.textContent = String(objects.length);

    head.append(
      swatch,
      name,
      count,
      this.buildToggle('eye', layer.visible, 'Layer visibility', () =>
        this.app.structure.updateLayer(layer.id, { visible: !layer.visible }),
      ),
      this.buildToggle('lock', layer.locked, 'Lock layer', () =>
        this.app.structure.updateLayer(layer.id, { locked: !layer.locked }),
      ),
    );

    if (this.app.structure.layers.length > 1) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'outliner-icon outliner-icon--danger';
      remove.title = 'Delete layer, keeping its objects';
      remove.innerHTML = icon('trash', 13);
      remove.addEventListener('click', () => this.app.structure.removeLayer(layer.id));
      head.append(remove);
    }

    section.append(head);

    const list = document.createElement('div');
    list.className = 'outliner-layer__items';

    const seenGroups = new Set<string>();
    for (const object of objects) {
      const groupId = object.get('groupId');

      if (groupId !== '') {
        if (seenGroups.has(groupId)) continue;
        seenGroups.add(groupId);

        const group = this.app.structure.group(groupId);
        if (group) {
          list.append(this.buildGroup(group, layer.id));
          continue;
        }
      }

      list.append(this.buildObjectRow(object, 0));
    }

    if (objects.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'outliner-empty';
      empty.textContent = 'Empty';
      list.append(empty);
    }

    section.append(list);
    return section;
  }

  /** Builds a collapsible group row and, when open, its members. */
  private buildGroup(group: GroupData, layerId: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'outliner-group';

    const members = this.app.structure.objectsInGroup(group.id).filter((object) => object.get('layerId') === layerId);

    const row = document.createElement('div');
    row.className = 'outliner-row outliner-row--group';
    if (members.some((object) => this.app.selection.has(object))) row.classList.add('is-selected');

    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = group.collapsed ? 'outliner-chevron is-collapsed' : 'outliner-chevron';
    chevron.innerHTML = icon('chevron', 11);
    chevron.title = group.collapsed ? 'Expand group' : 'Collapse group';
    chevron.addEventListener('click', (event) => {
      event.stopPropagation();
      this.app.structure.updateGroup(group.id, { collapsed: !group.collapsed });
    });

    const name = this.buildEditableName(group.name, `group:${group.id}`, (next) =>
      this.app.structure.updateGroup(group.id, { name: next }),
    );
    name.classList.add('outliner-row__name');

    const count = document.createElement('span');
    count.className = 'outliner-row__meta';
    count.textContent = `${members.length}`;

    const ungroup = document.createElement('button');
    ungroup.type = 'button';
    ungroup.className = 'outliner-icon';
    ungroup.title = 'Ungroup';
    ungroup.innerHTML = icon('ungroup', 13);
    ungroup.addEventListener('click', (event) => {
      event.stopPropagation();
      this.app.ungroup(group.id);
    });

    row.append(chevron, name, count, ungroup);
    row.addEventListener('click', (event) => {
      this.app.selection.select(members, OutlinerPanel.modeFor(event));
    });

    wrapper.append(row);

    if (!group.collapsed) {
      for (const object of members) wrapper.append(this.buildObjectRow(object, 1));
    }

    return wrapper;
  }

  /** Builds one object row. */
  private buildObjectRow(object: SceneObject, depth: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'outliner-row';
    if (depth > 0) row.classList.add('outliner-row--nested');
    if (this.app.selection.has(object)) row.classList.add('is-selected');
    if (this.app.structure.isLocked(object)) row.classList.add('is-locked');

    const name = this.buildEditableName(object.name, `object:${object.id}`, (next) =>
      this.app.setObjectProperty(object, 'name', next),
    );
    name.classList.add('outliner-row__name');

    row.append(
      name,
      this.buildToggle('eye', object.get('visible'), 'Visibility', () =>
        this.app.setObjectProperty(object, 'visible', !object.get('visible')),
      ),
      this.buildToggle('lock', object.get('locked'), 'Lock', () =>
        this.app.setObjectProperty(object, 'locked', !object.get('locked')),
      ),
    );

    row.addEventListener('click', () => {
      this.app.selection.select([object], 'replace');
    });

    return row;
  }

  /**
   * Builds a name element that becomes an input on double click.
   *
   * Inline renaming rather than a dialog: naming is how a build stays navigable
   * once it has forty objects, and anything that costs a dialog does not get
   * done.
   */
  private buildEditableName(value: string, key: string, onCommit: (next: string) => void): HTMLElement {
    if (this.renameTarget === key) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'outliner-rename';
      input.value = value;
      input.spellcheck = false;

      const commit = (accept: boolean) => {
        this.renameTarget = null;
        const next = input.value.trim();
        if (accept && next !== '' && next !== value) onCommit(next);
        else this.render();
      };

      input.addEventListener('blur', () => commit(true));
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') commit(true);
        if (event.key === 'Escape') commit(false);
      });
      input.addEventListener('click', (event) => event.stopPropagation());

      // Focus after the element is in the document.
      queueMicrotask(() => {
        input.focus();
        input.select();
      });

      return input;
    }

    const span = document.createElement('span');
    span.textContent = value;
    span.title = 'Double-click to rename';
    span.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      this.renameTarget = key;
      this.render();
    });
    return span;
  }

  /** Builds a small state toggle button. */
  private buildToggle(iconName: string, active: boolean, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = active ? 'outliner-icon' : 'outliner-icon is-off';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon(active ? iconName : `${iconName}Off`, 13);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  /** Modifier keys decide how a row click combines with the selection. */
  private static modeFor(event: MouseEvent): 'replace' | 'add' | 'toggle' {
    if (event.shiftKey) return 'add';
    if (event.ctrlKey || event.metaKey) return 'toggle';
    return 'replace';
  }
}
