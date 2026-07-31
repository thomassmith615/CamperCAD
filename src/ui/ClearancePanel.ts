import type { Application } from '@/core/Application';
import type { SceneObject } from '@/objects/SceneObject';
import { formatLength } from '@/math/Units';
import { Panel } from './Panel';

/**
 * Reports how much room is left around the selected object.
 *
 * This is the panel that turns the model into a build document. A cabinet's own
 * dimensions are easy to read off the object; what decides whether the layout
 * works is the six numbers around it — whether the door still opens, whether
 * the bed clears the wheel well, whether there is room to walk past.
 *
 * Negative clearances are shown in the warning colour rather than clamped,
 * because "this cabinet is 1.4 inches inside the wall" is the single most
 * useful thing the panel can say.
 */
export class ClearancePanel {
  readonly panel: Panel;

  private readonly app: Application;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly nearestRow: HTMLElement;
  private target: SceneObject | null = null;

  constructor(app: Application) {
    this.app = app;
    this.panel = new Panel('Clearances');

    this.rows.set('toFloor', this.panel.addReadout('To floor', '', true));
    this.rows.set('toCeiling', this.panel.addReadout('To ceiling', '', true));
    this.rows.set('toDriverWall', this.panel.addReadout('To driver wall', '', true));
    this.rows.set('toPassengerWall', this.panel.addReadout('To pass. wall', '', true));
    this.rows.set('toBulkhead', this.panel.addReadout('To bulkhead', '', true));
    this.rows.set('toRearDoors', this.panel.addReadout('To rear doors', '', true));
    this.nearestRow = this.panel.addReadout('Nearest object', '—', true);

    this.panel.addHint(
      'Wall clearances are measured where the wall is tightest across this object&rsquo;s height. Negative values mean it protrudes.',
    );

    app.bus.on('object:changed', ({ object }) => {
      if (object === this.target) this.refresh();
    });
    app.bus.on('objects:removed', () => this.refresh());
    app.bus.on('units:changed', () => this.refresh());
  }

  /** Points the panel at an object, or at nothing. */
  setTarget(object: SceneObject | null): void {
    this.target = object;
    this.refresh();
  }

  /** Recomputes and rewrites every row. */
  refresh(): void {
    const object = this.target;
    if (!object) return;

    const clearances = this.app.measurements.clearances(object);
    if (!clearances) return;

    const unit = this.app.unit;
    for (const [key, element] of this.rows) {
      const value = clearances[key as keyof typeof clearances];
      if (typeof value !== 'number') continue;

      element.textContent = formatLength(value, unit);
      element.classList.toggle('row__value--warn', value < -0.01);
    }

    if (clearances.nearest) {
      const { object: other, distance } = clearances.nearest;
      this.nearestRow.textContent = `${formatLength(distance, unit)} · ${other.name}`;
      this.nearestRow.classList.toggle('row__value--warn', distance <= 0);
    } else {
      this.nearestRow.textContent = '—';
      this.nearestRow.classList.remove('row__value--warn');
    }
  }
}
