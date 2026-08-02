import type { Application } from '@/core/Application';
import { RENDER_PRESETS, type RenderPresetId } from '@/render/RenderPresets';
import { Panel } from './Panel';

/**
 * The presentation panel.
 *
 * Everything here changes how the model looks and nothing here changes what it
 * measures. That separation is worth stating in the interface as well as in the
 * code: a builder switching to golden-hour light needs to know they have not
 * quietly altered a dimension.
 */
export class RenderPanel {
  readonly panel: Panel;

  private readonly app: Application;
  private readonly presetSelect: HTMLSelectElement;
  private readonly presetNote: HTMLElement;
  private readonly walkButton: HTMLButtonElement;
  private readonly heightSlider: HTMLInputElement;
  private readonly heightReadout: HTMLElement;

  constructor(app: Application) {
    this.app = app;
    this.panel = new Panel('Presentation');

    this.presetSelect = document.createElement('select');
    this.presetSelect.className = 'field-select field-select--full';
    for (const preset of RENDER_PRESETS) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      option.title = preset.description;
      this.presetSelect.append(option);
    }
    this.presetSelect.addEventListener('change', () => {
      app.setRenderPreset(this.presetSelect.value as RenderPresetId);
    });

    const presetRow = document.createElement('div');
    presetRow.className = 'row';
    const presetLabel = document.createElement('span');
    presetLabel.className = 'row__label';
    presetLabel.textContent = 'Lighting';
    presetRow.append(presetLabel, this.presetSelect);
    this.panel.append(presetRow);

    this.presetNote = document.createElement('p');
    this.presetNote.className = 'hint';
    this.panel.append(this.presetNote);

    this.walkButton = document.createElement('button');
    this.walkButton.type = 'button';
    this.walkButton.className = 'panel-button';
    this.walkButton.addEventListener('click', () => app.toggleWalkthrough());
    this.panel.append(this.walkButton);

    this.heightSlider = document.createElement('input');
    this.heightSlider.type = 'range';
    this.heightSlider.className = 'field-slider';
    this.heightSlider.min = '48';
    this.heightSlider.max = '76';
    this.heightSlider.step = '1';
    this.heightSlider.value = String(Math.round(app.walkthrough.height));
    this.heightSlider.addEventListener('input', () => {
      app.walkthrough.setHeight(Number(this.heightSlider.value));
      this.syncHeight();
    });

    const heightRow = document.createElement('div');
    heightRow.className = 'row';
    const heightLabel = document.createElement('span');
    heightLabel.className = 'row__label';
    heightLabel.textContent = 'Eye height';
    heightRow.append(heightLabel, this.heightSlider);
    this.panel.append(heightRow);

    this.heightReadout = this.panel.addReadout('', '', true);

    const screenshot = document.createElement('button');
    screenshot.type = 'button';
    screenshot.className = 'panel-button';
    screenshot.textContent = 'Save screenshot';
    screenshot.addEventListener('click', () => app.captureScreenshot());
    this.panel.append(screenshot);

    this.panel.addHint(
      'Walkthrough puts you at eye height inside the van. <span class="kbd">W</span><span class="kbd">A</span>' +
        '<span class="kbd">S</span><span class="kbd">D</span> to move, mouse to look, ' +
        '<span class="kbd">Shift</span> to slow down, <span class="kbd">Esc</span> to leave.<br><br>' +
        'None of these settings affect measurements, weights or the bill of materials.',
    );

    app.bus.on('render:preset', ({ preset }) => {
      this.presetSelect.value = preset;
      this.syncNote();
    });
    app.bus.on('walkthrough:changed', ({ active }) => this.syncWalk(active));

    this.presetSelect.value = app.lighting.activePreset.id;
    this.syncNote();
    this.syncWalk(false);
    this.syncHeight();
  }

  private syncNote(): void {
    const preset = RENDER_PRESETS.find((entry) => entry.id === this.presetSelect.value);
    this.presetNote.textContent = preset?.description ?? '';
  }

  private syncWalk(active: boolean): void {
    this.walkButton.textContent = active ? 'Leave walkthrough' : 'Enter walkthrough';
    this.walkButton.classList.toggle('is-active', active);
  }

  private syncHeight(): void {
    const inches = this.app.walkthrough.height;
    const feet = Math.floor(inches / 12);
    this.heightReadout.textContent = `${feet}' ${Math.round(inches - feet * 12)}"`;
  }
}
