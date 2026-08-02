import type { Application } from '@/core/Application';
import type { VehicleModel } from '@/vehicle/VehicleModel';
import type { SceneObject } from '@/objects/SceneObject';
import { formatLength, isMetric } from '@/math/Units';
import { Panel } from './Panel';
import { ObjectInspector } from './ObjectInspector';
import { ClearancePanel } from './ClearancePanel';
import { WeightPanel } from './WeightPanel';
import { RenderPanel } from './RenderPanel';

/** Heights at which interior width is reported, in inches. */
const WIDTH_SAMPLE_HEIGHTS = [12, 24, 36, 48, 60];

/**
 * The right-hand inspector.
 *
 * The sidebar shows one of three things depending on the selection: the vehicle
 * when nothing is selected, an object's properties when exactly one thing is,
 * and a summary when several are. Swapping the panel set rather than stacking
 * everything keeps the panel the user needs at the top of the column, where a
 * 320-pixel sidebar has room for it.
 *
 * Readouts are driven by a list of update closures, so a unit change re-renders
 * every value without rebuilding the DOM or collapsing open panels.
 */
export class Sidebar {
  private readonly app: Application;
  private readonly host: HTMLElement;
  private readonly updaters: Array<() => void> = [];
  private readonly inspector: ObjectInspector;
  private readonly clearances: ClearancePanel;
  private readonly weights: WeightPanel;
  private readonly renderPanel: RenderPanel;

  private vehiclePanels: HTMLElement[] = [];
  private multiPanel: Panel | null = null;
  private multiCount!: HTMLElement;
  private multiWeight!: HTMLElement;
  private multiPrice!: HTMLElement;

  constructor(host: HTMLElement, app: Application) {
    this.host = host;
    this.app = app;
    this.inspector = new ObjectInspector(app);
    this.clearances = new ClearancePanel(app);
    this.weights = new WeightPanel(app);
    this.renderPanel = new RenderPanel(app);

    app.bus.on('vehicle:loaded', ({ vehicle }) => {
      this.buildVehiclePanels(vehicle);
      this.render();
    });
    app.bus.on('units:changed', () => this.refresh());
    app.bus.on('selection:changed', () => this.render());
    app.bus.on('object:changed', () => {
      if (this.app.selection.size > 1) this.refreshMultiSummary();
    });
    app.bus.on('objects:added', () => this.clearances.refresh());

    if (app.vehicle) {
      this.buildVehiclePanels(app.vehicle);
      this.render();
    }
  }

  /** Shows the panel set matching the current selection. */
  private render(): void {
    const selected = this.app.selection.objects;

    if (selected.length === 1) {
      this.inspector.setTarget(selected[0]);
      this.clearances.setTarget(selected[0]);

      // Clearances sit directly under the object's own dimensions: the two are
      // read together when deciding whether a piece fits.
      const panels = this.inspector.activePanels.map((panel) => panel.element);
      panels.splice(2, 0, this.clearances.panel.element);
      this.host.replaceChildren(...panels);
      return;
    }

    this.inspector.setTarget(null);
    this.clearances.setTarget(null);

    if (selected.length > 1) {
      this.host.replaceChildren(this.multiSummary().element);
      this.refreshMultiSummary();
      return;
    }

    // Weight sits directly under the vehicle summary: it is a property of the
    // whole build, and it is the first thing worth checking after a change.
    this.host.replaceChildren(
      this.vehiclePanels[0],
      this.weights.panel.element,
      ...this.vehiclePanels.slice(1),
      this.renderPanel.panel.element,
    );
    this.weights.refresh();
    this.refresh();
  }

  /** Re-runs every vehicle readout closure, e.g. after a unit change. */
  private refresh(): void {
    for (const update of this.updaters) update();
    if (this.app.selection.size > 1) this.refreshMultiSummary();
  }

  /** Builds the panel shown for a multiple selection. */
  private multiSummary(): Panel {
    if (this.multiPanel) return this.multiPanel;

    const panel = new Panel('Selection');
    this.multiCount = panel.addReadout('Objects', '0', true);
    this.multiWeight = panel.addReadout('Total weight', '0 lb', true);
    this.multiPrice = panel.addReadout('Total price', '0', true);
    panel.addHint(
      'Editing several objects at once is not supported yet. Move the group with the gizmo, or select one object to edit its properties.',
    );

    this.multiPanel = panel;
    return panel;
  }

  /** Recomputes the multiple-selection totals. */
  private refreshMultiSummary(): void {
    if (!this.multiPanel) return;
    const objects: SceneObject[] = this.app.selection.objects;

    const weight = objects.reduce((total, object) => total + object.get('weight'), 0);
    const price = objects.reduce((total, object) => total + object.get('price'), 0);

    this.multiCount.textContent = String(objects.length);
    this.multiWeight.textContent = `${Math.round(weight * 10) / 10} lb`;
    this.multiPrice.textContent = price.toFixed(2);
  }

  /** Rebuilds the vehicle panel set for a newly loaded vehicle. */
  private buildVehiclePanels(vehicle: VehicleModel): void {
    this.updaters.length = 0;
    this.vehiclePanels = [
      this.buildVehiclePanel(vehicle).element,
      this.buildWidthPanel(vehicle).element,
      this.buildVisibilityPanel(vehicle).element,
      this.buildControlsPanel().element,
      this.buildSourcesPanel(vehicle).element,
    ];
  }

  /** Headline identity and dimensions. */
  private buildVehiclePanel(vehicle: VehicleModel): Panel {
    const panel = new Panel('Vehicle');
    const { definition } = vehicle;

    panel.addReadout('Model', definition.name);
    panel.addReadout('Configuration', definition.variant);
    panel.addReadout('Model years', definition.modelYears);

    const widest = vehicle.widestPoint;
    this.addLengthReadout(panel, 'Floor length', definition.interior.length);
    this.addLengthReadout(panel, 'Floor width', definition.interior.floorWidth);
    this.addLengthReadout(panel, 'Widest', widest.width);
    this.addLengthReadout(panel, '  at height', widest.height);
    this.addLengthReadout(panel, 'Standing height', vehicle.standingHeight);
    this.addLengthReadout(panel, 'Between wells', definition.interior.betweenWheelWells);
    this.addLengthReadout(panel, 'Well height', definition.wheelWells.height);

    const area = panel.addReadout('Floor area', '', true);
    this.updaters.push(() => {
      const squareFeet = vehicle.floorAreaSquareFeet();
      area.textContent = isMetric(this.app.unit)
        ? `${(squareFeet * 0.092903).toFixed(2)} m²`
        : `${squareFeet.toFixed(1)} ft²`;
    });

    return panel;
  }

  /** Interior width sampled at useful build heights. */
  private buildWidthPanel(vehicle: VehicleModel): Panel {
    const panel = new Panel('Interior width');

    for (const height of WIDTH_SAMPLE_HEIGHTS) {
      if (height > vehicle.standingHeight) continue;
      const readout = panel.addReadout('', '', true);
      const label = readout.previousElementSibling as HTMLElement;
      this.updaters.push(() => {
        label.textContent = `At ${formatLength(height, this.app.unit)}`;
        readout.textContent = formatLength(vehicle.widthAtHeight(height), this.app.unit);
      });
    }

    panel.addHint(
      'Measured wall to wall on the curved section, not the floor width — the widest point sits well above the floor.',
    );
    return panel;
  }

  /** Per-part visibility switches. */
  private buildVisibilityPanel(vehicle: VehicleModel): Panel {
    const panel = new Panel('Vehicle parts');

    for (const part of vehicle.parts) {
      panel.addToggle(part.label, part.object.visible, (visible) => {
        this.app.setVehiclePartVisible(part.id, visible);
      });
    }

    return panel;
  }

  /** Input reference. Every key listed here is implemented. */
  private buildControlsPanel(): Panel {
    const panel = new Panel('Controls', true);
    panel.addHint(
      'Left-drag to select · middle-drag to orbit · right-drag to pan · scroll to zoom<br>' +
        'Hold <span class="kbd">Space</span> to orbit with the left button.<br><br>' +
        '<span class="kbd">Q</span> select &nbsp; <span class="kbd">B</span> box &nbsp; ' +
        '<span class="kbd">C</span> cylinder &nbsp; <span class="kbd">P</span> panel &nbsp; ' +
        '<span class="kbd">X</span> extrusion<br>' +
        '<span class="kbd">M</span> measure &nbsp; <span class="kbd">L</span> library &nbsp; ' +
        '<span class="kbd">Shift</span>+<span class="kbd">L</span> outliner &nbsp; ' +
        '<span class="kbd">W</span> move &nbsp; <span class="kbd">E</span> rotate &nbsp; ' +
        '<span class="kbd">R</span> resize<br>' +
        '<span class="kbd">1</span>–<span class="kbd">6</span> views &nbsp; ' +
        '<span class="kbd">F</span> fit &nbsp; <span class="kbd">G</span> grid &nbsp; ' +
        '<span class="kbd">O</span> ortho &nbsp; <span class="kbd">H</span> balance &nbsp; ' +
        '<span class="kbd">J</span> materials &nbsp; <span class="kbd">K</span> electrical &nbsp; <span class="kbd">U</span> water &nbsp; <span class="kbd">V</span> walkthrough<br>' +
        '<span class="kbd">Ctrl</span>+<span class="kbd">Z</span> undo &nbsp; ' +
        '<span class="kbd">Ctrl</span>+<span class="kbd">D</span> duplicate &nbsp; ' +
        '<span class="kbd">Del</span> delete &nbsp; ' +
        '<span class="kbd">Ctrl</span>+<span class="kbd">G</span> group<br><br>' +
        'Hold <span class="kbd">Alt</span> to drag without snapping, or to select one object inside a group.',
    );
    return panel;
  }

  /** Provenance of the geometry, so approximations are never invisible. */
  private buildSourcesPanel(vehicle: VehicleModel): Panel {
    const panel = new Panel('Measurement sources', true);
    const list = document.createElement('ul');
    list.className = 'hint';
    list.style.paddingLeft = '16px';
    list.style.margin = '4px 0 0';

    for (const note of vehicle.definition.sourceNotes) {
      const item = document.createElement('li');
      item.textContent = note;
      item.style.marginBottom = '6px';
      list.append(item);
    }

    panel.append(list);
    return panel;
  }

  /** Adds a length readout that re-formats itself when units change. */
  private addLengthReadout(panel: Panel, label: string, inches: number): void {
    const readout = panel.addReadout(label, '', true);
    this.updaters.push(() => {
      readout.textContent = formatLength(inches, this.app.unit);
    });
  }
}
