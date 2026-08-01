import type { Application } from '@/core/Application';
import type { SceneObject } from '@/objects/SceneObject';
import { MIN_PROFILE_POINTS, PROFILE_PRESETS, profileArea, type ProfilePoint } from '@/geometry/ProfileShapes';
import { formatLength, parseLength } from '@/math/Units';
import { Panel } from './Panel';

/**
 * The profile editor for extrusions.
 *
 * A numeric vertex list rather than a drawing canvas. That is a deliberate
 * trade: drawing a polygon in the viewport is a whole interaction mode with its
 * own snapping, its own undo semantics and its own edge cases, and it would be
 * the wrong first version of this feature anyway. Van panels are cut from
 * measurements — "48 across, notch 10 by 9 for the wheel well" — and a list of
 * numbers expresses that exactly, in the units the user already works in.
 *
 * Every edit goes through one command, so reshaping a counter is a single undo
 * step rather than one per vertex.
 */
export class ProfileEditor {
  readonly panel: Panel;

  private readonly app: Application;
  private readonly presetSelect: HTMLSelectElement;
  private readonly list: HTMLElement;
  private readonly summary: HTMLElement;
  private target: SceneObject | null = null;

  constructor(app: Application) {
    this.app = app;
    this.panel = new Panel('Profile');

    this.presetSelect = document.createElement('select');
    this.presetSelect.className = 'field-select field-select--full';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Start from…';
    this.presetSelect.append(placeholder);

    for (const preset of PROFILE_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      option.title = preset.description;
      this.presetSelect.append(option);
    }

    this.presetSelect.addEventListener('change', () => {
      const preset = PROFILE_PRESETS.find((entry) => entry.id === this.presetSelect.value);
      this.presetSelect.value = '';
      if (preset && this.target) this.app.setObjectProfile(this.target, preset.build());
    });

    const presetRow = document.createElement('div');
    presetRow.className = 'row';
    const presetLabel = document.createElement('span');
    presetLabel.className = 'row__label';
    presetLabel.textContent = 'Preset';
    presetRow.append(presetLabel, this.presetSelect);
    this.panel.append(presetRow);

    this.list = document.createElement('div');
    this.list.className = 'profile-list';
    this.panel.append(this.list);

    const addRow = document.createElement('button');
    addRow.type = 'button';
    addRow.className = 'profile-add';
    addRow.textContent = '+ Add point';
    addRow.addEventListener('click', () => this.addPoint());
    this.panel.append(addRow);

    this.summary = document.createElement('p');
    this.summary.className = 'hint';
    this.panel.append(this.summary);

    this.panel.addHint(
      'Points run around the outline in order. X is across the van, Z is front to back. Editing the shape resets width and depth to match it.',
    );

    app.bus.on('object:changed', ({ object }) => {
      if (object === this.target) this.render();
    });
    app.bus.on('units:changed', () => this.render());
  }

  /** Points the editor at an object, or at nothing. */
  setTarget(object: SceneObject | null): void {
    this.target = object && object.hasProfile ? object : null;
    this.render();
  }

  /** True when the current target has a profile to edit. */
  get isApplicable(): boolean {
    return this.target !== null;
  }

  /** Rebuilds the vertex list. */
  private render(): void {
    const object = this.target;
    if (!object) {
      this.list.replaceChildren();
      this.summary.textContent = '';
      return;
    }

    const points = object.profile;
    const unit = this.app.unit;
    const removable = points.length > MIN_PROFILE_POINTS;

    this.list.replaceChildren(
      ...points.map((point, index) => this.buildRow(point, index, unit, removable)),
    );

    const area = profileArea(points);
    this.summary.textContent = `${points.length} points · ${(area / 144).toFixed(2)} ft² footprint`;
  }

  /** Builds one editable vertex row. */
  private buildRow(
    point: ProfilePoint,
    index: number,
    unit: Parameters<typeof formatLength>[1],
    removable: boolean,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'profile-row';

    const label = document.createElement('span');
    label.className = 'profile-row__index';
    label.textContent = String(index + 1);

    const x = this.buildInput(formatLength(point[0], unit), (value) => this.updatePoint(index, 0, value));
    const z = this.buildInput(formatLength(point[1], unit), (value) => this.updatePoint(index, 1, value));

    row.append(label, x, z);

    if (removable) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'profile-row__remove';
      remove.textContent = '×';
      remove.title = 'Remove point';
      remove.setAttribute('aria-label', `Remove point ${index + 1}`);
      remove.addEventListener('click', () => this.removePoint(index));
      row.append(remove);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'profile-row__remove is-disabled';
      spacer.textContent = '×';
      spacer.title = `A profile needs at least ${MIN_PROFILE_POINTS} points`;
      row.append(spacer);
    }

    return row;
  }

  /** Builds a coordinate input committed on blur or Enter. */
  private buildInput(value: string, onCommit: (value: number) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'field-input profile-row__input';
    input.value = value;
    input.spellcheck = false;

    const commit = () => {
      const parsed = parseLength(input.value, this.app.unit);
      if (parsed === null) {
        this.render();
        return;
      }
      onCommit(parsed);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') {
        input.value = value;
        input.blur();
      }
    });

    return input;
  }

  /** Writes one coordinate of one point. */
  private updatePoint(index: number, axis: 0 | 1, value: number): void {
    const object = this.target;
    if (!object) return;

    const points = object.profile.map(([x, z]) => [x, z] as ProfilePoint);
    if (!points[index]) return;
    if (Math.abs(points[index][axis] - value) < 1e-6) return;

    points[index][axis] = value;
    this.app.setObjectProfile(object, points);
  }

  /**
   * Inserts a point midway along the last edge.
   *
   * Appending at the midpoint of an existing edge keeps the polygon valid: a
   * point added at the origin, or anywhere arbitrary, would usually produce a
   * self-intersecting outline the user then has to repair.
   */
  private addPoint(): void {
    const object = this.target;
    if (!object) return;

    const points = object.profile.map(([x, z]) => [x, z] as ProfilePoint);
    if (points.length === 0) return;

    const last = points[points.length - 1];
    const first = points[0];
    points.push([(last[0] + first[0]) / 2, (last[1] + first[1]) / 2]);

    this.app.setObjectProfile(object, points);
  }

  /** Removes a point, refusing to go below the usable minimum. */
  private removePoint(index: number): void {
    const object = this.target;
    if (!object) return;

    const points = object.profile.map(([x, z]) => [x, z] as ProfilePoint);
    if (points.length <= MIN_PROFILE_POINTS) return;

    points.splice(index, 1);
    this.app.setObjectProfile(object, points);
  }
}
