import type { Application } from '@/core/Application';
import { IMPERIAL_SPACINGS, METRIC_SPACINGS } from '@/scene/GridManager';
import { formatLength, isMetric, UNIT_LABELS, type DisplayUnit } from '@/math/Units';
import type { GizmoMode } from '@/selection/TransformGizmo';
import type { ToolId } from '@/tools/ToolTypes';
import { ProjectDialog } from './ProjectDialog';
import type { LibraryPanel } from './LibraryPanel';
import type { OutlinerPanel } from './OutlinerPanel';
import { ArrayDialog } from './ArrayDialog';
import { BomDialog } from './BomDialog';
import { ElectricalDialog } from './ElectricalDialog';
import { PlumbingDialog } from './PlumbingDialog';
import { INPUT_MODE_LABELS, type InputMode } from '@/input/InputSettings';
import { icon } from './icons';

/** Units offered in the toolbar picker, in the order they appear. */
const UNIT_ORDER: DisplayUnit[] = ['in', 'ft-in', 'mm', 'cm', 'm'];

/**
 * The application toolbar.
 *
 * Controls are created from the application's actual capabilities, never
 * declared ahead of them: a control appears here only once the subsystem behind
 * it exists. Buttons that represent a real command but are momentarily
 * inapplicable — undo with an empty history, delete with nothing selected — are
 * shown disabled, which tells the user the capability exists and what it needs.
 * Later milestones add groups here as their subsystems land.
 */
export class Toolbar {
  private readonly app: Application;
  private readonly host: HTMLElement;

  private readonly toolButtons = new Map<ToolId, HTMLButtonElement>();
  private readonly gizmoButtons = new Map<GizmoMode, HTMLButtonElement>();

  private perspectiveButton!: HTMLButtonElement;
  private orthographicButton!: HTMLButtonElement;
  private gridButton!: HTMLButtonElement;
  private snapButton!: HTMLButtonElement;
  private balanceButton!: HTMLButtonElement;
  private spacingSelect!: HTMLSelectElement;
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private duplicateButton!: HTMLButtonElement;
  private deleteButton!: HTMLButtonElement;
  private saveButton!: HTMLButtonElement;
  private projectLabel!: HTMLElement;
  private readonly dialog: ProjectDialog;
  private readonly libraryPanel: LibraryPanel;
  private libraryButton!: HTMLButtonElement;
  private outlinerButton!: HTMLButtonElement;
  private groupButton!: HTMLButtonElement;
  private ungroupButton!: HTMLButtonElement;
  private arrayButton!: HTMLButtonElement;
  private inputSelect!: HTMLSelectElement;
  private readonly outlinerPanel: OutlinerPanel;
  private readonly arrayDialog: ArrayDialog;
  private readonly bomDialog: BomDialog;
  private readonly electricalDialog: ElectricalDialog;
  private readonly plumbingDialog: PlumbingDialog;

  constructor(host: HTMLElement, app: Application, libraryPanel: LibraryPanel, outlinerPanel: OutlinerPanel) {
    this.host = host;
    this.app = app;
    this.dialog = new ProjectDialog(app);
    this.libraryPanel = libraryPanel;
    this.outlinerPanel = outlinerPanel;
    this.arrayDialog = new ArrayDialog(app);
    this.bomDialog = new BomDialog(app);
    this.electricalDialog = new ElectricalDialog(app);
    this.plumbingDialog = new PlumbingDialog(app);

    this.host.replaceChildren();
    this.host.append(
      this.buildBrand(),
      this.buildToolGroup(),
      this.buildGizmoGroup(),
      this.buildEditGroup(),
      this.buildProjectionGroup(),
      this.buildGridGroup(),
      this.buildFileGroup(),
    );

    app.bus.on('projection:changed', ({ mode }) => this.syncProjection(mode));
    app.bus.on('grid:changed', ({ visible }) => this.syncGrid(visible));
    app.bus.on('snap:settings', ({ enabled }) => this.snapButton.classList.toggle('is-active', enabled));
    app.bus.on('project:changed', ({ name, dirty }) => {
      this.projectLabel.textContent = dirty ? `${name} *` : name;
      this.projectLabel.classList.toggle('is-dirty', dirty);
      this.saveButton.disabled = !dirty;
    });
    app.bus.on('project:open-requested', () => this.dialog.open());
    app.bus.on('library:requested', () => this.libraryPanel.setOpen(!this.libraryPanel.isOpen));
    app.bus.on('library:toggled', ({ open }) => this.libraryButton.classList.toggle('is-active', open));
    app.bus.on('units:changed', ({ unit }) => this.rebuildSpacingOptions(unit));
    app.bus.on('tool:changed', ({ tool }) => this.syncTool(tool));
    app.bus.on('gizmo:changed', ({ mode, enabled, multiSelect }) => this.syncGizmo(mode, enabled, multiSelect));
    app.bus.on('history:changed', ({ canUndo, canRedo, undoLabel, redoLabel }) => {
      this.undoButton.disabled = !canUndo;
      this.redoButton.disabled = !canRedo;
      this.undoButton.title = canUndo ? `Undo ${undoLabel} — Ctrl+Z` : 'Nothing to undo';
      this.redoButton.title = canRedo ? `Redo ${redoLabel} — Ctrl+Shift+Z` : 'Nothing to redo';
    });
    app.bus.on('selection:changed', ({ objects }) => {
      const deletable = objects.some((object) => !app.structure.isLocked(object));
      const grouped = objects.some((object) => object.get('groupId') !== '');

      this.duplicateButton.disabled = objects.length === 0;
      this.arrayButton.disabled = objects.length === 0;
      this.deleteButton.disabled = !deletable;
      this.groupButton.disabled = objects.length < 2;
      this.ungroupButton.disabled = !grouped;
    });

    app.bus.on('input:mode', ({ mode }) => {
      this.inputSelect.value = mode;
    });
    app.bus.on('outliner:requested', () => this.outlinerPanel.setOpen(!this.outlinerPanel.isOpen));
    app.bus.on('outliner:toggled', ({ open }) => this.outlinerButton.classList.toggle('is-active', open));
    app.bus.on('balance:toggled', ({ visible }) => this.balanceButton.classList.toggle('is-active', visible));
    app.bus.on('bom:requested', () => this.bomDialog.open());
    app.bus.on('electrical:requested', () => this.electricalDialog.open());
    app.bus.on('plumbing:requested', () => this.plumbingDialog.open());

    // The toolbar is where an overload becomes visible without the sidebar
    // open, so the balance button carries the alarm.
    app.bus.on('weight:changed', ({ report }) => {
      const over = report?.checks.some((check) => check.status === 'over') ?? false;
      this.balanceButton.classList.toggle('is-alarm', over);
      this.balanceButton.title = over
        ? 'Over a weight rating — open the sidebar for detail'
        : 'Show axles and centre of gravity — H';
    });

    this.syncProjection('perspective');
    this.syncGrid(true);
    this.snapButton.classList.toggle('is-active', app.snapping.settings.enabled);
    this.syncTool('select');
    this.syncGizmo('translate', false, false);
    this.projectLabel.textContent = app.projects.project.name;
    this.saveButton.disabled = true;
    this.undoButton.disabled = true;
    this.redoButton.disabled = true;
    this.duplicateButton.disabled = true;
    this.deleteButton.disabled = true;
    this.arrayButton.disabled = true;
    this.groupButton.disabled = true;
    this.ungroupButton.disabled = true;
  }

  /** Product mark and version. */
  private buildBrand(): HTMLElement {
    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.innerHTML =
      '<span class="brand__name">Camper<em>CAD</em></span><span class="brand__version">0.11.0</span>';
    return brand;
  }

  /** Tool selection: pick things, or place new ones. */
  private buildToolGroup(): HTMLElement {
    const group = this.groupElement();

    const select = this.button('cursor', 'Select', 'Select and marquee — Q', () => this.app.setTool('select'));
    const box = this.button('box', 'Box', 'Place a box — B', () => this.app.beginCreating('box'));
    const cylinder = this.iconButton('cylinder', 'Place a cylinder — C', () => this.app.beginCreating('cylinder'));
    const panel = this.iconButton('panel', 'Place a panel — P', () => this.app.beginCreating('panel'));
    const extrusion = this.iconButton('extrusion', 'Place a shaped extrusion — X', () =>
      this.app.beginCreating('extrusion'),
    );
    const measure = this.button('ruler', 'Measure', 'Measure between two points — M', () =>
      this.app.setTool('measure'),
    );

    this.libraryButton = this.button('library', 'Library', 'Browse components — L', () =>
      this.libraryPanel.setOpen(!this.libraryPanel.isOpen),
    );

    this.outlinerButton = this.iconButton('outliner', 'Outliner — Shift+L', () =>
      this.outlinerPanel.setOpen(!this.outlinerPanel.isOpen),
    );

    this.toolButtons.set('select', select);
    this.toolButtons.set('create-shape', box);
    this.toolButtons.set('measure', measure);

    group.append(this.libraryButton, this.outlinerButton, select, box, cylinder, panel, extrusion, measure);
    return group;
  }

  /** Transform gizmo modes. */
  private buildGizmoGroup(): HTMLElement {
    const group = this.groupElement();

    const move = this.iconButton('move', 'Move — W', () => this.app.setGizmoMode('translate'));
    const rotate = this.iconButton('rotate', 'Rotate — E', () => this.app.setGizmoMode('rotate'));
    const scale = this.iconButton('scale', 'Resize — R', () => this.app.setGizmoMode('scale'));

    this.gizmoButtons.set('translate', move);
    this.gizmoButtons.set('rotate', rotate);
    this.gizmoButtons.set('scale', scale);

    group.append(move, rotate, scale);
    return group;
  }

  /** History and object operations. */
  private buildEditGroup(): HTMLElement {
    const group = this.groupElement();

    this.undoButton = this.iconButton('undo', 'Undo — Ctrl+Z', () => this.app.undo());
    this.redoButton = this.iconButton('redo', 'Redo — Ctrl+Shift+Z', () => this.app.redo());
    this.duplicateButton = this.iconButton('duplicate', 'Duplicate — Ctrl+D', () => this.app.duplicateSelection());
    this.deleteButton = this.iconButton('trash', 'Delete — Del', () => this.app.deleteSelection());

    this.arrayButton = this.iconButton('array', 'Array duplicate', () => this.arrayDialog.open());
    this.groupButton = this.iconButton('group', 'Group — Ctrl+G', () => this.app.groupSelection());
    this.ungroupButton = this.iconButton('ungroup', 'Ungroup — Ctrl+Shift+G', () => this.app.ungroupSelection());

    group.append(
      this.undoButton,
      this.redoButton,
      this.duplicateButton,
      this.arrayButton,
      this.groupButton,
      this.ungroupButton,
      this.deleteButton,
    );
    return group;
  }

  /** Perspective / orthographic pair, mirroring the camera manager's state. */
  private buildProjectionGroup(): HTMLElement {
    const group = this.groupElement();

    this.perspectiveButton = this.iconButton('perspective', 'Perspective view — O', () =>
      this.app.setProjection('perspective'),
    );
    this.orthographicButton = this.iconButton('orthographic', 'Orthographic view — O', () =>
      this.app.setProjection('orthographic'),
    );

    group.append(this.perspectiveButton, this.orthographicButton);
    return group;
  }

  /** Grid visibility, spacing and display units. */
  private buildGridGroup(): HTMLElement {
    const group = this.groupElement();

    this.gridButton = this.iconButton('grid', 'Show or hide the grid — G', () =>
      this.app.setGridVisible(!this.app.grid.visible),
    );

    this.snapButton = this.iconButton('magnet', 'Snapping — hold Alt to release', () =>
      this.app.setSnapEnabled(!this.app.snapping.settings.enabled),
    );

    this.balanceButton = this.iconButton('balance', 'Show axles and centre of gravity — H', () =>
      this.app.setBalanceVisible(!this.app.isBalanceVisible),
    );

    this.spacingSelect = document.createElement('select');
    this.spacingSelect.className = 'field-select';
    this.spacingSelect.title = 'Grid spacing';
    this.spacingSelect.addEventListener('change', () => {
      this.app.setGridSpacing(Number.parseFloat(this.spacingSelect.value));
    });
    this.rebuildSpacingOptions(this.app.unit);

    const unitSelect = document.createElement('select');
    unitSelect.className = 'field-select';
    unitSelect.title = 'Display units';
    for (const unit of UNIT_ORDER) {
      const option = document.createElement('option');
      option.value = unit;
      option.textContent = UNIT_LABELS[unit];
      unitSelect.append(option);
    }
    unitSelect.value = this.app.unit;
    unitSelect.addEventListener('change', () => this.app.setUnit(unitSelect.value as DisplayUnit));

    this.inputSelect = document.createElement('select');
    this.inputSelect.className = 'field-select';
    this.inputSelect.title = 'Input device — changes what a left drag does';
    for (const mode of ['mouse', 'trackpad'] as InputMode[]) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = INPUT_MODE_LABELS[mode];
      this.inputSelect.append(option);
    }
    this.inputSelect.value = this.app.input.current;
    this.inputSelect.addEventListener('change', () =>
      this.app.setInputMode(this.inputSelect.value as InputMode),
    );

    group.append(this.gridButton, this.snapButton, this.balanceButton, this.spacingSelect, unitSelect, this.inputSelect);
    return group;
  }

  /**
   * Project actions and the framing button, aligned right.
   *
   * The project name doubles as the save indicator: an asterisk while there are
   * unwritten edits, gone once autosave or an explicit save has run. A separate
   * status light would be one more thing to look at for information that
   * belongs next to the name it describes.
   */
  private buildFileGroup(): HTMLElement {
    const group = this.groupElement();
    group.classList.add('tool-group--right');

    this.projectLabel = document.createElement('span');
    this.projectLabel.className = 'project-label';
    this.projectLabel.title = 'Click to rename';
    this.projectLabel.addEventListener('click', () => this.promptRename());

    this.saveButton = this.iconButton('save', 'Save — Ctrl+S', () => this.app.projects.save());

    group.append(
      this.button('fit', 'Fit', 'Frame everything — F', () => this.app.fitView()),
      this.projectLabel,
      this.iconButton('filePlus', 'New project', () => this.app.projects.newProject()),
      this.iconButton('folder', 'Open project — Ctrl+O', () => this.dialog.open()),
      this.saveButton,
      this.iconButton('download', 'Export to a file', () => this.app.projects.exportToFile()),
      this.iconButton('upload', 'Import from a file', () => void this.app.projects.importFromFile()),
      this.iconButton('clipboard', 'Bill of materials and cut list — J', () => this.bomDialog.open()),
      this.iconButton('bolt', 'Electrical system — K', () => this.electricalDialog.open()),
      this.iconButton('droplet', 'Water system — U', () => this.plumbingDialog.open()),
    );
    return group;
  }

  /** Renames the project through a prompt, the one place a prompt fits. */
  private promptRename(): void {
    const current = this.app.projects.project.name;
    const next = window.prompt('Project name', current);
    if (next !== null) this.app.projects.rename(next);
  }

  /**
   * Repopulates the spacing picker for the active unit system.
   *
   * Imperial users get 1, 2, 5 and 10 inch steps; metric users get 10, 25, 50
   * and 100 mm. Offering inch fractions to someone working in millimetres
   * produces unusable snap targets, so the two lists never mix.
   */
  private rebuildSpacingOptions(unit: DisplayUnit): void {
    const spacings = isMetric(unit) ? METRIC_SPACINGS : IMPERIAL_SPACINGS;
    const labelUnit: DisplayUnit = isMetric(unit) ? unit : 'in';

    this.spacingSelect.replaceChildren();
    for (const spacing of spacings) {
      const option = document.createElement('option');
      option.value = String(spacing);
      option.textContent = formatLength(spacing, labelUnit);
      this.spacingSelect.append(option);
    }

    const closest = [...spacings].sort(
      (a, b) => Math.abs(a - this.app.grid.spacing) - Math.abs(b - this.app.grid.spacing),
    )[0];
    this.spacingSelect.value = String(closest);
    this.app.setGridSpacing(closest);
  }

  private syncProjection(mode: 'perspective' | 'orthographic'): void {
    this.perspectiveButton.classList.toggle('is-active', mode === 'perspective');
    this.orthographicButton.classList.toggle('is-active', mode === 'orthographic');
  }

  private syncGrid(visible: boolean): void {
    this.gridButton.classList.toggle('is-active', visible);
    this.spacingSelect.disabled = !visible;
  }

  private syncTool(tool: ToolId): void {
    for (const [id, button] of this.toolButtons) {
      button.classList.toggle('is-active', id === tool);
    }
  }

  /**
   * Reflects gizmo state.
   *
   * Rotate and scale are disabled for a multiple selection because the gizmo
   * only implements group translation; showing them enabled would promise a
   * behaviour that is not there.
   */
  private syncGizmo(mode: GizmoMode, enabled: boolean, multiSelect: boolean): void {
    for (const [id, button] of this.gizmoButtons) {
      button.classList.toggle('is-active', enabled && id === mode);
      const allowed = enabled && (id === 'translate' || !multiSelect);
      button.disabled = !allowed;
    }
  }

  private groupElement(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'tool-group';
    return group;
  }

  private button(iconName: string, label: string, title: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'tool-btn';
    element.title = title;
    element.innerHTML = `${icon(iconName)}<span>${label}</span>`;
    element.addEventListener('click', onClick);
    return element;
  }

  private iconButton(iconName: string, title: string, onClick: () => void): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'tool-btn tool-btn--icon';
    element.title = title;
    element.setAttribute('aria-label', title);
    element.innerHTML = icon(iconName);
    element.addEventListener('click', onClick);
    return element;
  }
}
