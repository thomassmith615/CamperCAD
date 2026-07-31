import { ProjectSerializer } from './ProjectSerializer';
import type { ProjectData, ProjectSummary } from './ProjectTypes';

/** Key prefix for individual projects. */
const PROJECT_KEY = 'campercad.project.';

/** Key holding the summary index. */
const INDEX_KEY = 'campercad.projects';

/** Key holding the id of the project to reopen on next launch. */
const LAST_OPENED_KEY = 'campercad.lastOpened';

/** Raised when the browser refuses a write, almost always on quota. */
export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full. Export this project to a file, then delete an old one.');
    this.name = 'StorageFullError';
  }
}

/**
 * Persists projects in `localStorage`.
 *
 * A separate summary index is maintained alongside the project bodies so the
 * open dialog can list twenty projects without parsing twenty full designs.
 * The index is treated as a cache, not as truth: it is rebuilt from the stored
 * bodies whenever it is missing or unreadable, so a half-written index can
 * never lose a project.
 *
 * Every method tolerates storage being unavailable entirely — Safari's private
 * mode throws on write — and reports it rather than crashing the application.
 */
export class ProjectStorage {
  /** True when the browser will actually let us store anything. */
  static isAvailable(): boolean {
    try {
      const probe = '__campercad_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  /** Summaries of every stored project, most recently updated first. */
  list(): ProjectSummary[] {
    const cached = this.readIndex();
    if (cached) return cached;

    const rebuilt = this.rebuildIndex();
    this.writeIndex(rebuilt);
    return rebuilt;
  }

  /** Loads a project, or null when the id is unknown or the body is corrupt. */
  load(id: string): ProjectData | null {
    const text = this.safeGet(PROJECT_KEY + id);
    if (!text) return null;

    try {
      return ProjectSerializer.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Writes a project and updates the index.
   *
   * @throws {StorageFullError} When the browser refuses the write.
   */
  save(project: ProjectData): void {
    try {
      localStorage.setItem(PROJECT_KEY + project.id, ProjectSerializer.stringify(project));
    } catch {
      throw new StorageFullError();
    }

    const summaries = this.list().filter((summary) => summary.id !== project.id);
    summaries.unshift(ProjectStorage.summarise(project));
    this.writeIndex(summaries);
  }

  /** Deletes a project and removes it from the index. */
  remove(id: string): void {
    this.safeRemove(PROJECT_KEY + id);
    this.writeIndex(this.list().filter((summary) => summary.id !== id));
    if (this.lastOpenedId() === id) this.safeRemove(LAST_OPENED_KEY);
  }

  /** Id of the project to restore on next launch, if any. */
  lastOpenedId(): string | null {
    return this.safeGet(LAST_OPENED_KEY);
  }

  /** Records which project to restore on next launch. */
  setLastOpened(id: string): void {
    this.safeSet(LAST_OPENED_KEY, id);
  }

  /** Builds a summary from a full project. */
  private static summarise(project: ProjectData): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      objectCount: project.objects.length,
      vehicleId: project.vehicleId,
    };
  }

  /** Reads the index, or null when it is absent or unusable. */
  private readIndex(): ProjectSummary[] | null {
    const text = this.safeGet(INDEX_KEY);
    if (!text) return null;

    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((entry): entry is ProjectSummary => {
        return (
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as ProjectSummary).id === 'string' &&
          typeof (entry as ProjectSummary).name === 'string'
        );
      });
    } catch {
      return null;
    }
  }

  /** Reconstructs the index by scanning stored project bodies. */
  private rebuildIndex(): ProjectSummary[] {
    const summaries: ProjectSummary[] = [];

    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PROJECT_KEY)) continue;

      const project = this.load(key.slice(PROJECT_KEY.length));
      if (project) summaries.push(ProjectStorage.summarise(project));
    }

    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Writes the index, ignoring failure since it can always be rebuilt. */
  private writeIndex(summaries: ProjectSummary[]): void {
    this.safeSet(INDEX_KEY, JSON.stringify(summaries));
  }

  private safeGet(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private safeSet(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Non-fatal: the caller's project body is already written, or this is a
      // cache the next read will rebuild.
    }
  }

  private safeRemove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing useful to do; the entry simply stays.
    }
  }
}
