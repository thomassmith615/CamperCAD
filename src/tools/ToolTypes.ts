/** Identifiers of the tools the toolbar can activate. */
export type ToolId = 'select' | 'create-shape' | 'measure' | 'place-item';

/**
 * A pointer-driven mode of interaction with the viewport.
 *
 * Exactly one tool is active at a time and it receives every pointer event on
 * the canvas. Tools are deliberately thin: they interpret pointer gestures and
 * then delegate, so the rules about what a selection is or how an object is
 * created live in the selection manager and the command layer rather than being
 * duplicated in each tool.
 */
export interface Tool {
  /** Stable identifier, matching the toolbar button. */
  readonly id: ToolId;

  /** Label shown in the toolbar and the status bar. */
  readonly label: string;

  /** Cursor to apply to the canvas while this tool is active. */
  readonly cursor: string;

  /** Called when the tool becomes active. */
  activate?(): void;

  /** Called when another tool takes over. Must leave no state behind. */
  deactivate?(): void;

  /** Pointer pressed inside the viewport. */
  onPointerDown?(event: PointerEvent): void;

  /** Pointer moved inside the viewport, whether or not a button is held. */
  onPointerMove?(event: PointerEvent): void;

  /** Pointer released. Fires even if the release lands outside the canvas. */
  onPointerUp?(event: PointerEvent): void;

  /** Escape pressed. Tools use this to abandon an in-progress gesture. */
  onCancel?(): void;
}
