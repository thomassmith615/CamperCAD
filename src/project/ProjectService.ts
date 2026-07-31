import type { Application } from '@/core/Application';
import { findVehicle, DEFAULT_VEHICLE } from '@/vehicle/catalog';
import { FileTransfer } from '@/ui/FileTransfer';
import { ProjectSerializer } from './ProjectSerializer';
import { ProjectStorage, StorageFullError } from './ProjectStorage';
import {
  PROJECT_FILE_EXTENSION,
  PROJECT_SCHEMA,
  ProjectFormatError,
  type ProjectData,
  type ProjectSummary,
} from './ProjectTypes';

/** Delay after the last edit before an automatic save runs, in milliseconds. */
const AUTOSAVE_DELAY_MS = 2500;

/**
 * Owns the current project and everything that happens to it.
 *
 * Loading is **not undoable**. The history is cleared on open, because an undo
 * stack that spans two different designs describes edits to objects that no
 * longer exist, and restoring them would resurrect half of a project the user
 * has moved on from.
 *
 * Autosave runs a short time after the last edit rather than on a timer, so a
 * continuous drag writes once when it settles instead of every few seconds
 * mid-gesture. An explicit save still exists, because autosave answers "did I
 * lose my work" and not "have I finished this version".
 */
export class ProjectService {
  private readonly app: Application;
  private readonly storage = new ProjectStorage();

  private current: ProjectData;
  private dirty = false;
  private autosaveHandle = 0;
  private applying = false;

  constructor(app: Application) {
    this.app = app;
    this.current = ProjectService.blank();

    // Anything that changes the design or its settings marks the project dirty.
    // Applying a loaded project fires all of these, so writes are suppressed
    // while that is in progress.
    const touch = () => this.markDirty();
    app.bus.on('objects:added', touch);
    app.bus.on('objects:removed', touch);
    app.bus.on('object:changed', touch);
    app.bus.on('grid:changed', touch);
    app.bus.on('units:changed', touch);
    app.bus.on('snap:settings', touch);

    // A tab being hidden may never come back, so flush synchronously rather
    // than waiting for the autosave timer.
    const onHide = () => {
      if (this.dirty) this.save();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });
  }

  /** Metadata for the project currently open. */
  get project(): Readonly<ProjectData> {
    return this.current;
  }

  /** True when there are edits not yet written to storage. */
  get hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  /** True when this browser will persist anything at all. */
  get canPersist(): boolean {
    return ProjectStorage.isAvailable();
  }

  /** Summaries of stored projects, most recently updated first. */
  list(): ProjectSummary[] {
    return this.storage.list();
  }

  /**
   * Restores the last opened project, or starts a new one.
   *
   * Called once at startup, after the application has built its default scene.
   */
  restoreOrCreate(): void {
    const id = this.storage.lastOpenedId();
    const project = id ? this.storage.load(id) : null;

    if (project) {
      this.apply(project);
      return;
    }

    this.current = ProjectService.blank();
    this.dirty = false;
    this.announce();
  }

  /** Discards the current design and starts an empty one. */
  newProject(name = 'Untitled project'): void {
    const blank = ProjectService.blank();
    blank.name = name;
    this.apply(blank);
    this.save();
  }

  /** Opens a stored project by id. Returns false when it cannot be read. */
  open(id: string): boolean {
    const project = this.storage.load(id);
    if (!project) return false;

    this.apply(project);
    this.storage.setLastOpened(project.id);
    this.announce();
    return true;
  }

  /** Deletes a stored project. Opening a new blank one if it was current. */
  delete(id: string): void {
    this.storage.remove(id);
    if (this.current.id === id) this.newProject();
    else this.announce();
  }

  /** Renames the current project and saves it. */
  rename(name: string): void {
    this.current.name = name.trim() || 'Untitled project';
    this.save();
  }

  /**
   * Writes the current design to storage.
   *
   * @returns An error message when the write failed, or null on success.
   */
  save(): string | null {
    window.clearTimeout(this.autosaveHandle);
    this.autosaveHandle = 0;

    const project = this.capture();
    try {
      this.storage.save(project);
    } catch (error) {
      const message = error instanceof StorageFullError ? error.message : 'Could not save this project.';
      this.app.bus.emit('project:error', { message });
      return message;
    }

    this.current = project;
    this.storage.setLastOpened(project.id);
    this.dirty = false;
    this.announce();
    return null;
  }

  /** Downloads the current design as a JSON file. */
  exportToFile(): void {
    const project = this.capture();
    const safeName = project.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    FileTransfer.download(`${safeName}${PROJECT_FILE_EXTENSION}`, ProjectSerializer.stringify(project));
  }

  /**
   * Imports a project from a file the user picks.
   *
   * The imported project is given a **new identifier** so it never overwrites
   * an existing stored project that happens to share one — importing a file a
   * colleague exported from their own copy is the normal case, and their ids
   * mean nothing here.
   *
   * @returns An error message when the file could not be read, or null.
   */
  async importFromFile(): Promise<string | null> {
    const picked = await FileTransfer.pickText();
    if (!picked) return null;

    let project: ProjectData;
    try {
      project = ProjectSerializer.parse(picked.text);
    } catch (error) {
      const message =
        error instanceof ProjectFormatError ? error.message : 'That file could not be read as a project.';
      this.app.bus.emit('project:error', { message });
      return message;
    }

    project.id = ProjectSerializer.createId();
    project.updatedAt = new Date().toISOString();

    this.apply(project);
    this.save();
    return null;
  }

  /** Builds a project record from the live application state. */
  private capture(): ProjectData {
    const now = new Date().toISOString();

    return {
      schema: PROJECT_SCHEMA,
      id: this.current.id,
      name: this.current.name,
      createdAt: this.current.createdAt,
      updatedAt: now,
      vehicleId: this.app.vehicle?.definition.id ?? DEFAULT_VEHICLE.id,
      units: this.app.unit,
      grid: { spacing: this.app.grid.spacing, visible: this.app.grid.visible },
      snapping: { ...this.app.snapping.settings },
      camera: this.app.cameras.captureState(),
      objects: this.app.objects.all().map((object) => object.toData()),
    };
  }

  /**
   * Replaces the live application state with a project.
   *
   * The order matters: the vehicle is loaded first because clearances and
   * snapping are meaningless without it, then objects, then view settings —
   * camera last, since loading a vehicle frames it and would otherwise
   * overwrite the saved viewpoint.
   */
  private apply(project: ProjectData): void {
    this.applying = true;

    try {
      const vehicle = findVehicle(project.vehicleId);
      if (!vehicle) {
        this.app.bus.emit('project:error', {
          message: `This project uses a vehicle this version does not have ("${project.vehicleId}"). Loaded with the default vehicle instead.`,
        });
      }

      const definition = vehicle ?? DEFAULT_VEHICLE;
      if (this.app.vehicle?.definition.id !== definition.id) {
        this.app.loadVehicle(definition);
      }

      this.app.selection.clear();
      this.app.objects.clear();
      this.app.history.clear();

      const objects = project.objects.map((data) => this.app.factory.fromData(data));
      this.app.objects.add(objects);
      this.app.factory.adoptNames(objects.map((object) => object.name));

      this.app.setUnit(project.units);
      this.app.setGridSpacing(project.grid.spacing);
      this.app.setGridVisible(project.grid.visible);
      this.app.setSnapEnabled(project.snapping.enabled);
      this.app.snapping.settings.tolerance = project.snapping.tolerance;
      this.app.cameras.restoreState(project.camera);

      this.current = project;
      this.dirty = false;
    } finally {
      this.applying = false;
    }

    this.announce();
  }

  /** Flags unsaved changes and schedules an autosave. */
  private markDirty(): void {
    if (this.applying) return;

    const wasDirty = this.dirty;
    this.dirty = true;
    if (!wasDirty) this.announce();

    window.clearTimeout(this.autosaveHandle);
    this.autosaveHandle = window.setTimeout(() => this.save(), AUTOSAVE_DELAY_MS);
  }

  /** Publishes the project's identity and save state. */
  private announce(): void {
    this.app.bus.emit('project:changed', {
      id: this.current.id,
      name: this.current.name,
      updatedAt: this.current.updatedAt,
      dirty: this.dirty,
    });
  }

  /** An empty project record for the default vehicle. */
  private static blank(): ProjectData {
    const now = new Date().toISOString();
    return {
      schema: PROJECT_SCHEMA,
      id: ProjectSerializer.createId(),
      name: 'Untitled project',
      createdAt: now,
      updatedAt: now,
      vehicleId: DEFAULT_VEHICLE.id,
      units: 'in',
      grid: { spacing: 1, visible: true },
      snapping: { enabled: true, tolerance: 1.5 },
      camera: { position: [220, 150, 260], target: [0, 30, 0], projection: 'perspective', zoom: 1 },
      objects: [],
    };
  }
}
