import type { Application } from '@/core/Application';
import type { SceneObject } from '@/objects/SceneObject';
import type { ObjectProperties, ObjectPropertyKey } from '@/objects/ObjectTypes';
import { formatLength } from '@/math/Units';
import { KIND_INFO } from '@/geometry/GeometryRegistry';
import { ProfileEditor } from './ProfileEditor';
import { Panel } from './Panel';
import { ColorField, NotesField, NumberField, TextField } from './Fields';

/**
 * The property editor for the current selection.
 *
 * Every field writes through a property command, so typing a width and dragging
 * the scale gizmo produce the same kind of history entry and undo behaves
 * identically whichever route the user took. Fields read back from the object
 * on every change, so editing a value in the sidebar and moving the gizmo stay
 * in sync without either knowing about the other.
 *
 * With more than one object selected the inspector shows shared state only.
 * Editing several objects at once needs a defined answer for what a mixed value
 * means, which is a design decision rather than a coding one and is deferred
 * rather than guessed at.
 */
export class ObjectInspector {
  /** The panels this inspector contributes, in display order. */
  readonly panels: Panel[] = [];

  private readonly app: Application;
  private target: SceneObject | null = null;

  private readonly nameField: TextField;
  private readonly colorField: ColorField;
  private readonly notesField: NotesField;
  private readonly numberFields = new Map<ObjectPropertyKey, NumberField>();
  private readonly layerSelect: HTMLSelectElement;
  private readonly groupReadout: HTMLElement;
  private readonly lockToggle: HTMLInputElement;
  private readonly visibleToggle: HTMLInputElement;
  private readonly footprint: HTMLElement;
  private readonly kindReadout: HTMLElement;
  private readonly tankPanel: Panel;
  private readonly fillSlider: HTMLInputElement;
  private readonly fluidReadout: HTMLElement;
  private readonly profileEditor: ProfileEditor;

  constructor(app: Application) {
    this.app = app;

    const identity = new Panel('Object');
    this.nameField = new TextField('Name', (value) => this.commit('name', value));
    identity.append(this.nameField.element);
    this.colorField = new ColorField('Colour', (value) => this.commit('color', value));
    identity.append(this.colorField.element);

    this.lockToggle = identity.addToggle('Locked', false, (checked) => this.commit('locked', checked));
    this.visibleToggle = identity.addToggle('Visible', true, (checked) => this.commit('visible', checked));

    this.layerSelect = document.createElement('select');
    this.layerSelect.className = 'field-select field-select--full';
    this.layerSelect.addEventListener('change', () => {
      this.app.assignSelectionToLayer(this.layerSelect.value);
    });
    identity.append(ObjectInspector.row('Layer', this.layerSelect));

    this.groupReadout = identity.addReadout('Group', '—');

    const dimensions = new Panel('Dimensions');
    this.addNumberField(dimensions, 'Width', 'width', 'length');
    this.addNumberField(dimensions, 'Height', 'height', 'length');
    this.addNumberField(dimensions, 'Depth', 'depth', 'length');
    this.footprint = dimensions.addReadout('Footprint', '', true);

    this.kindReadout = identity.addReadout('Type', '');
    this.profileEditor = new ProfileEditor(app);

    const placement = new Panel('Placement');
    this.addNumberField(placement, 'X', 'positionX', 'length');
    this.addNumberField(placement, 'Y (floor)', 'positionY', 'length');
    this.addNumberField(placement, 'Z', 'positionZ', 'length');
    this.addNumberField(placement, 'Rotate X', 'rotationX', 'angle');
    this.addNumberField(placement, 'Rotate Y', 'rotationY', 'angle');
    this.addNumberField(placement, 'Rotate Z', 'rotationZ', 'angle');
    placement.addHint('Y is the height of the object&rsquo;s bottom face above the van floor.');

    const details = new Panel('Details', true);
    this.addNumberField(details, 'Weight (lb)', 'weight', 'number');
    this.addNumberField(details, 'Price', 'price', 'number');

    this.tankPanel = new Panel('Tank');
    this.addNumberField(this.tankPanel, 'Capacity (gal)', 'capacityGallons', 'number');
    this.addNumberField(this.tankPanel, 'Fill (gal)', 'fillGallons', 'number');
    this.fillSlider = document.createElement('input');
    this.fillSlider.type = 'range';
    this.fillSlider.className = 'field-slider';
    this.fillSlider.min = '0';
    this.fillSlider.max = '100';
    this.fillSlider.step = '1';
    this.fillSlider.addEventListener('input', () => {
      if (!this.target) return;
      const capacity = this.target.get('capacityGallons');
      this.commit('fillGallons', (Number(this.fillSlider.value) / 100) * capacity);
    });
    this.tankPanel.append(ObjectInspector.row('', this.fillSlider));
    this.fluidReadout = this.tankPanel.addReadout('Fluid weight', '', true);
    this.tankPanel.addHint(
      'Water is 8.34 lb per gallon. A full 20 gallon tank adds 167 lb — check the rear axle after moving one.',
    );
    this.notesField = new NotesField((value) => this.commit('notes', value));
    details.append(this.notesField.element);

    this.panels.push(identity, dimensions, placement, details);

    app.bus.on('object:changed', ({ object }) => {
      if (object === this.target) this.refresh();
    });
    app.bus.on('structure:changed', () => this.refresh());
    app.bus.on('units:changed', ({ unit }) => {
      for (const field of this.numberFields.values()) field.setUnit(unit);
      this.refresh();
    });
  }

  /**
   * Panels for the current target, in display order.
   *
   * The profile editor only appears for kinds that have one, rather than being
   * shown empty: a panel that is inert for three of the four object kinds is
   * noise in a 320-pixel sidebar.
   */
  get activePanels(): Panel[] {
    const panels = [...this.panels];
    if (this.profileEditor.isApplicable) panels.splice(2, 0, this.profileEditor.panel);
    // The tank panel appears only for objects that hold fluid, rather than
    // sitting inert on every cabinet in the build.
    if (this.target && this.target.get('capacityGallons') > 0) panels.push(this.tankPanel);
    return panels;
  }

  /** Points the inspector at an object, or at nothing. */
  setTarget(object: SceneObject | null): void {
    this.target = object;
    this.profileEditor.setTarget(object);
    this.refresh();
  }

  /** Re-reads every field from the target object. */
  refresh(): void {
    const object = this.target;
    if (!object) return;

    this.nameField.setValue(object.get('name'));
    this.colorField.setValue(object.get('color'));
    this.notesField.setValue(object.get('notes'));
    this.lockToggle.checked = object.get('locked');
    this.visibleToggle.checked = object.get('visible');

    this.layerSelect.replaceChildren();
    for (const layer of this.app.structure.layers) {
      const option = document.createElement('option');
      option.value = layer.id;
      option.textContent = layer.name;
      this.layerSelect.append(option);
    }
    this.layerSelect.value = object.get('layerId');

    const groupId = object.get('groupId');
    this.groupReadout.textContent = groupId === '' ? '—' : this.app.structure.group(groupId)?.name ?? '—';

    for (const [key, field] of this.numberFields) {
      field.setValue(object.get(key) as number);
      const locked = this.app.structure.isLocked(object);
      field.setDisabled(locked && key !== 'weight' && key !== 'price');
    }

    // Dimension labels are per kind: a cylinder's X and Z are one diameter,
    // and a panel's Z is its thickness. Labelling them all "width and depth"
    // would invite people to type two different diameters.
    const info = KIND_INFO[object.kind];
    this.kindReadout.textContent = info.label;

    const labels: Array<[string, string]> = [
      ['width', info.dimensionLabels[0]],
      ['height', info.dimensionLabels[1]],
      ['depth', info.dimensionLabels[2]],
    ];
    for (const [key, label] of labels) {
      const field = this.numberFields.get(key as ObjectPropertyKey);
      field?.setLabel(label);
    }

    const capacity = object.get('capacityGallons');
    if (capacity > 0) {
      const fill = object.get('fillGallons');
      this.fillSlider.value = String(Math.round((fill / capacity) * 100));
      this.fluidReadout.textContent = `${Math.round(fill * 8.34)} lb`;
    }

    const width = object.get('width');
    const depth = object.get('depth');
    const unit = this.app.unit;
    this.footprint.textContent = `${formatLength(width, unit)} × ${formatLength(depth, unit)}`;
  }

  /** Builds a labelled row wrapping an arbitrary control. */
  private static row(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';

    const caption = document.createElement('span');
    caption.className = 'row__label';
    caption.textContent = label;

    row.append(caption, control);
    return row;
  }

  /** Registers a numeric field bound to a property. */
  private addNumberField(
    panel: Panel,
    label: string,
    key: ObjectPropertyKey,
    kind: 'length' | 'angle' | 'number',
  ): void {
    const field = new NumberField(label, kind, this.app.unit, (value) => {
      this.commit(key, value as ObjectProperties[typeof key]);
    });
    panel.append(field.element);
    this.numberFields.set(key, field);
  }

  /** Routes an edit through the command stack so it is undoable. */
  private commit<K extends ObjectPropertyKey>(key: K, value: ObjectProperties[K]): void {
    if (!this.target) return;
    this.app.setObjectProperty(this.target, key, value);
  }
}
