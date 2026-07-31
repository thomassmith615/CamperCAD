/**
 * A reversible edit.
 *
 * The application never stores scene snapshots for undo. A snapshot approach
 * looks simpler for a week and then makes every feature harder: memory grows
 * with scene size rather than edit count, undo cannot be described to the user,
 * and nothing can merge. Each command instead carries exactly the state needed
 * to reverse itself.
 *
 * Contract:
 *
 * - `execute` must be idempotent with respect to its own result, so the stack
 *   can call it to apply a change that the UI already applied optimistically
 *   (a finished gizmo drag) without the object moving twice.
 * - `undo` must restore the state that existed immediately before `execute`.
 * - Neither may assume it runs only once; redo calls `execute` again.
 */
export interface Command {
  /** Short description shown on the undo and redo buttons. */
  readonly label: string;

  /** Applies the change. */
  execute(): void;

  /** Reverses the change. */
  undo(): void;

  /**
   * Absorbs a newer command of the same kind, if it makes sense to treat them
   * as one edit — typing successive digits into a width field, for example.
   *
   * @param next The command that would otherwise be pushed.
   * @returns True when `next` was absorbed and must not be pushed separately.
   */
  mergeWith?(next: Command): boolean;

  /**
   * Releases resources this command was keeping alive.
   *
   * Called when the command is discarded from the stack, which is the moment an
   * edit becomes permanently unreachable. A deletion holds its objects until
   * then; only here is it safe to free them.
   */
  dispose?(): void;
}
