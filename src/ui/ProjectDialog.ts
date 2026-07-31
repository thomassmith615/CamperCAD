import type { Application } from '@/core/Application';
import type { ProjectSummary } from '@/project/ProjectTypes';
import { findVehicle } from '@/vehicle/catalog';
import { Modal } from './Modal';

/** Formats an ISO timestamp as a short local date and time. */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The open-project dialog.
 *
 * Lists stored projects with enough context to tell them apart — vehicle,
 * object count and when they were last touched — because "Untitled project" and
 * "Untitled project 2" are what people actually end up with.
 *
 * Deletion asks for confirmation inline, on the row itself, rather than in a
 * second dialog. A confirmation dialog stacked on top of a dialog is where
 * people click through without reading.
 */
export class ProjectDialog {
  private readonly app: Application;
  private readonly modal: Modal;
  private readonly list: HTMLElement;
  private pendingDelete: string | null = null;

  constructor(app: Application) {
    this.app = app;
    this.modal = new Modal('Open project');

    this.list = document.createElement('div');
    this.list.className = 'project-list';
    this.modal.setContent(this.list);

    this.modal.addButton('Close', () => this.modal.close());

    app.bus.on('project:changed', () => {
      if (this.modal.isOpen) this.refresh();
    });
  }

  /** Shows the dialog with a freshly read project list. */
  open(): void {
    this.pendingDelete = null;
    this.refresh();
    this.modal.open();
  }

  /** Rebuilds the list from storage. */
  private refresh(): void {
    const projects = this.app.projects.list();

    if (projects.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = this.app.projects.canPersist
        ? 'No saved projects yet. Your work is saved automatically as you go.'
        : 'This browser is blocking local storage, so projects cannot be saved here. Export to a file instead.';
      this.list.replaceChildren(empty);
      return;
    }

    this.list.replaceChildren(...projects.map((project) => this.buildRow(project)));
  }

  /** Builds one row of the project list. */
  private buildRow(project: ProjectSummary): HTMLElement {
    const row = document.createElement('div');
    row.className = 'project-row';
    if (project.id === this.app.projects.project.id) row.classList.add('is-current');

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'project-row__info';
    info.addEventListener('click', () => {
      if (this.app.projects.open(project.id)) this.modal.close();
    });

    const name = document.createElement('span');
    name.className = 'project-row__name';
    name.textContent = project.name;

    const meta = document.createElement('span');
    meta.className = 'project-row__meta';
    const vehicle = findVehicle(project.vehicleId);
    const objectLabel = project.objectCount === 1 ? '1 object' : `${project.objectCount} objects`;
    meta.textContent = `${objectLabel} · ${vehicle?.name ?? 'Unknown vehicle'} · ${formatTimestamp(project.updatedAt)}`;

    info.append(name, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'project-row__delete';
    remove.textContent = this.pendingDelete === project.id ? 'Confirm' : 'Delete';
    if (this.pendingDelete === project.id) remove.classList.add('is-confirming');

    remove.addEventListener('click', () => {
      if (this.pendingDelete === project.id) {
        this.app.projects.delete(project.id);
        this.pendingDelete = null;
      } else {
        this.pendingDelete = project.id;
      }
      this.refresh();
    });

    row.append(info, remove);
    return row;
  }
}
