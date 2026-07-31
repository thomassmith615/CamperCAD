import type { EventBus } from '@/core/EventBus';
import type { AppEvents } from '@/core/AppEvents';
import type { Command } from './Command';

/** Maximum number of undoable edits retained. */
const MAX_DEPTH = 200;

/**
 * The undo/redo history.
 *
 * Two stacks of {@link Command}s. Executing a new command clears the redo
 * stack, because the future it described no longer follows from the present.
 *
 * When the undo stack exceeds {@link MAX_DEPTH} the oldest command is dropped
 * and disposed. That disposal is load-bearing: a deleted object stays alive in
 * its removal command so undo can restore it, and this is the point at which
 * the deletion becomes permanent and the object's material can be freed.
 */
export class CommandStack {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private readonly bus: EventBus<AppEvents>;

  constructor(bus: EventBus<AppEvents>) {
    this.bus = bus;
  }

  /** True when there is something to undo. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** True when there is something to redo. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Runs a command and records it.
   *
   * If the command on top of the stack accepts a merge, the new command is
   * executed and folded into it rather than pushed, so a run of small edits
   * reads as one step.
   */
  execute(command: Command): void {
    command.execute();

    const top = this.undoStack[this.undoStack.length - 1];
    const merged = top?.mergeWith?.(command) ?? false;

    if (!merged) {
      this.undoStack.push(command);
      if (this.undoStack.length > MAX_DEPTH) {
        this.undoStack.shift()?.dispose?.();
      }
    }

    this.clearRedo();
    this.announce();
  }

  /** Reverses the most recent command. */
  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;

    command.undo();
    this.redoStack.push(command);
    this.announce();
  }

  /** Re-applies the most recently undone command. */
  redo(): void {
    const command = this.redoStack.pop();
    if (!command) return;

    command.execute();
    this.undoStack.push(command);
    this.announce();
  }

  /** Empties both stacks, disposing every command. Used when loading a project. */
  clear(): void {
    for (const command of this.undoStack) command.dispose?.();
    this.undoStack.length = 0;
    this.clearRedo();
    this.announce();
  }

  /** Discards the redo stack, disposing anything it was holding alive. */
  private clearRedo(): void {
    for (const command of this.redoStack) command.dispose?.();
    this.redoStack.length = 0;
  }

  /** Publishes the state the undo and redo buttons render from. */
  private announce(): void {
    this.bus.emit('history:changed', {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? null,
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? null,
    });
  }
}
