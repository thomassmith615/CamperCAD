import type { Application } from '@/core/Application';
import { formatLength } from '@/math/Units';

/**
 * The bottom status strip.
 *
 * It answers the four questions a modeller asks continuously: which vehicle am I
 * in, where is my cursor, what will I snap to, and is the viewport keeping up.
 * Cursor coordinates are reported on the floor plane in the active unit, using
 * the same tabular monospace as every other dimension so digits stay aligned as
 * they change.
 */
export class StatusBar {
  private readonly app: Application;
  private readonly vehicleValue: HTMLElement;
  private readonly cursorValue: HTMLElement;
  private readonly gridValue: HTMLElement;
  private readonly perfValue: HTMLElement;

  private lastFpsUpdate = 0;

  constructor(host: HTMLElement, app: Application) {
    this.app = app;
    host.replaceChildren();

    this.vehicleValue = this.addItem(host, 'Vehicle', 'None');
    this.cursorValue = this.addItem(host, 'Cursor', '—');
    this.gridValue = this.addItem(host, 'Grid', '—');
    this.perfValue = this.addItem(host, 'FPS', '—', true);

    app.bus.on('vehicle:loaded', ({ vehicle }) => {
      this.vehicleValue.textContent = `${vehicle.definition.name} · ${vehicle.definition.variant}`;
    });

    app.bus.on('grid:changed', ({ spacing, visible }) => {
      this.gridValue.textContent = visible ? formatLength(spacing, this.app.unit) : 'Hidden';
    });

    app.bus.on('units:changed', () => {
      this.gridValue.textContent = this.app.grid.visible ? formatLength(this.app.grid.spacing, this.app.unit) : 'Hidden';
    });

    app.bus.on('pointer:moved', ({ point }) => {
      this.cursorValue.textContent = point
        ? `X ${formatLength(point.x, this.app.unit)}   Z ${formatLength(point.z, this.app.unit)}`
        : '—';
    });

    app.bus.on('frame:rendered', ({ fps, triangles }) => this.updatePerformance(fps, triangles));

    // Seed from current state: subsystems may have emitted before this existed.
    if (app.vehicle) {
      this.vehicleValue.textContent = `${app.vehicle.definition.name} · ${app.vehicle.definition.variant}`;
    }
    this.gridValue.textContent = app.grid.visible ? formatLength(app.grid.spacing, app.unit) : 'Hidden';
  }

  /**
   * Throttles the performance readout to four updates a second.
   *
   * A value that changes sixty times a second is unreadable, and rewriting text
   * nodes every frame is wasted work in the one place the app is trying to
   * measure.
   */
  private updatePerformance(fps: number, triangles: number): void {
    const now = performance.now();
    if (now - this.lastFpsUpdate < 250) return;
    this.lastFpsUpdate = now;
    this.perfValue.textContent = `${Math.round(fps)}   ${triangles.toLocaleString()} tris`;
  }

  /** Adds a labelled status item and returns its value element. */
  private addItem(host: HTMLElement, label: string, value: string, alignRight = false): HTMLElement {
    const item = document.createElement('div');
    item.className = alignRight ? 'status-item status-item--right' : 'status-item';

    const caption = document.createElement('span');
    caption.className = 'status-item__label';
    caption.textContent = label;

    const readout = document.createElement('span');
    readout.className = 'status-item__value';
    readout.textContent = value;

    item.append(caption, readout);
    host.append(item);
    return readout;
  }
}
