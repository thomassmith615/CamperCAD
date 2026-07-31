import type { Application } from '@/core/Application';
import type { VehicleModel } from '@/vehicle/VehicleModel';
import { formatLength, isMetric } from '@/math/Units';
import { Panel } from './Panel';

/** Heights at which interior width is reported, in inches. */
const WIDTH_SAMPLE_HEIGHTS = [12, 24, 36, 48, 60];

/**
 * The right-hand inspector.
 *
 * In this milestone it inspects the vehicle, which is the only thing in the
 * scene. The structure is the one the object inspector will use: panels of
 * labelled readouts driven by a list of update closures, so a unit change
 * re-renders every value without rebuilding the DOM or losing panel state.
 *
 * The interior width table is the panel that earns its place. Every conversion
 * decision — whether a bed fits crosswise, how deep the galley can be, where the
 * shoulder starts stealing headroom — comes from knowing the width at a given
 * height, and no published spec sheet lists it.
 */
export class Sidebar {
  private readonly app: Application;
  private readonly host: HTMLElement;
  private readonly updaters: Array<() => void> = [];

  constructor(host: HTMLElement, app: Application) {
    this.host = host;
    this.app = app;

    app.bus.on('vehicle:loaded', ({ vehicle }) => this.rebuild(vehicle));
    app.bus.on('units:changed', () => this.refresh());

    if (app.vehicle) this.rebuild(app.vehicle);
  }

  /** Rebuilds every panel for a newly loaded vehicle. */
  private rebuild(vehicle: VehicleModel): void {
    this.host.replaceChildren();
    this.updaters.length = 0;

    this.host.append(
      this.buildVehiclePanel(vehicle).element,
      this.buildWidthPanel(vehicle).element,
      this.buildVisibilityPanel(vehicle).element,
      this.buildControlsPanel().element,
      this.buildSourcesPanel(vehicle).element,
    );

    this.refresh();
  }

  /** Re-runs every readout closure, e.g. after a unit change. */
  private refresh(): void {
    for (const update of this.updaters) update();
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
      'Drag to orbit · right-drag or two fingers to pan · scroll to zoom<br><br>' +
        '<span class="kbd">1</span>–<span class="kbd">6</span> named views &nbsp; ' +
        '<span class="kbd">F</span> fit &nbsp; <span class="kbd">G</span> grid &nbsp; ' +
        '<span class="kbd">O</span> orthographic',
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
