import type { Application } from '@/core/Application';
import { IMPERIAL_SPACINGS, METRIC_SPACINGS } from '@/scene/GridManager';
import { formatLength, isMetric, UNIT_LABELS, type DisplayUnit } from '@/math/Units';
import { icon } from './icons';

/** Units offered in the toolbar picker, in the order they appear. */
const UNIT_ORDER: DisplayUnit[] = ['in', 'ft-in', 'mm', 'cm', 'm'];

/**
 * The application toolbar.
 *
 * Controls are created from the application's actual capabilities, never
 * declared ahead of them: a control appears here only once the subsystem behind
 * it exists. That is a deliberate constraint — a toolbar of greyed-out promises
 * teaches users nothing, and a toolbar that silently does nothing is worse.
 * Later milestones add groups here as their subsystems land.
 */
export class Toolbar {
  private readonly app: Application;
  private readonly host: HTMLElement;

  private perspectiveButton!: HTMLButtonElement;
  private orthographicButton!: HTMLButtonElement;
  private gridButton!: HTMLButtonElement;
  private spacingSelect!: HTMLSelectElement;

  constructor(host: HTMLElement, app: Application) {
    this.host = host;
    this.app = app;

    this.host.replaceChildren();
    this.host.append(this.buildBrand(), this.buildProjectionGroup(), this.buildGridGroup(), this.buildViewGroup());

    app.bus.on('projection:changed', ({ mode }) => this.syncProjection(mode));
    app.bus.on('grid:changed', ({ visible }) => this.syncGrid(visible));
    app.bus.on('units:changed', ({ unit }) => this.rebuildSpacingOptions(unit));

    this.syncProjection('perspective');
    this.syncGrid(true);
  }

  /** Product mark and version. */
  private buildBrand(): HTMLElement {
    const brand = document.createElement('div');
    brand.className = 'brand';
    brand.innerHTML =
      '<span class="brand__name">Camper<em>CAD</em></span><span class="brand__version">0.1.0</span>';
    return brand;
  }

  /** Perspective / orthographic pair, mirroring the camera manager's state. */
  private buildProjectionGroup(): HTMLElement {
    const group = this.groupElement();

    this.perspectiveButton = this.button('perspective', 'Perspective', 'Perspective view — O', () =>
      this.app.setProjection('perspective'),
    );
    this.orthographicButton = this.button('orthographic', 'Ortho', 'Orthographic view — O', () =>
      this.app.setProjection('orthographic'),
    );

    group.append(this.perspectiveButton, this.orthographicButton);
    return group;
  }

  /** Grid visibility and spacing. */
  private buildGridGroup(): HTMLElement {
    const group = this.groupElement();

    this.gridButton = this.button('grid', 'Grid', 'Show or hide the grid — G', () =>
      this.app.setGridVisible(!this.app.grid.visible),
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

    group.append(this.gridButton, this.spacingSelect, unitSelect);
    return group;
  }

  /** Framing action, aligned right. */
  private buildViewGroup(): HTMLElement {
    const group = this.groupElement();
    group.classList.add('tool-group--right');
    group.append(this.button('fit', 'Fit', 'Frame everything — F', () => this.app.fitView()));
    return group;
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
}
