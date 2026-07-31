import type { Application } from '@/core/Application';
import type { ViewPreset } from '@/core/CameraManager';

/** Buttons in layout order, three per row. */
const PRESETS: Array<{ preset: ViewPreset; label: string; key: string }> = [
  { preset: 'iso', label: 'ISO', key: '1' },
  { preset: 'top', label: 'TOP', key: '2' },
  { preset: 'front', label: 'FRT', key: '3' },
  { preset: 'rear', label: 'REAR', key: '4' },
  { preset: 'left', label: 'LFT', key: '5' },
  { preset: 'right', label: 'RGT', key: '6' },
];

/**
 * The view selector docked in the corner of the viewport.
 *
 * It lives over the canvas rather than in the toolbar because choosing a view is
 * a spatial action: the user is already looking at the model when they decide
 * they need the side elevation. The highlight clears as soon as the camera is
 * orbited by hand, so it always answers "am I on a true elevation right now?" —
 * which matters, because only a true elevation gives an undistorted dimension.
 */
export class ViewControls {
  private readonly buttons = new Map<ViewPreset, HTMLButtonElement>();

  constructor(host: HTMLElement, app: Application) {
    host.replaceChildren();

    for (const { preset, label, key } of PRESETS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'view-btn';
      button.textContent = label;
      button.title = `${label} view — ${key}`;
      button.addEventListener('click', () => app.applyView(preset));
      host.append(button);
      this.buttons.set(preset, button);
    }

    app.bus.on('view:changed', ({ preset }) => this.sync(preset));
    this.sync(app.cameras.activePreset);
  }

  /** Highlights the active preset, or none when the camera is free. */
  private sync(active: ViewPreset | null): void {
    for (const [preset, button] of this.buttons) {
      button.classList.toggle('is-active', preset === active);
    }
  }
}
