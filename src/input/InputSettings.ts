/**
 * Input device modes.
 *
 * The two devices want opposite defaults, and there is no mapping that suits
 * both. A three-button mouse has a spare middle button, so the left button is
 * free to select and orbiting can live on the middle — the convention every
 * desktop CAD tool uses. A laptop trackpad has no middle button at all, so the
 * only comfortable gesture is a plain drag, which must therefore orbit; picking
 * becomes a click, and marquee selection moves onto a modifier.
 *
 * Rather than pick a winner, the application supports both and detects which
 * one is in use.
 */
export type InputMode = 'mouse' | 'trackpad';

/** What a pointer drag does, before modifiers are considered. */
export type DragRole = 'select' | 'orbit' | 'pan' | 'none';

/** Storage key for the user's explicit choice, if they made one. */
const MODE_KEY = 'campercad.inputMode';

/** Human-readable labels for the mode picker. */
export const INPUT_MODE_LABELS: Record<InputMode, string> = {
  mouse: 'Mouse',
  trackpad: 'Trackpad',
};

/**
 * Owns the active input mode and resolves gestures against it.
 *
 * The mapping is deliberately kept in one place. Three separate subsystems care
 * about it — orbit controls, the select tool and the toolbar — and if each
 * inferred the rules independently they would drift apart the first time one of
 * them changed.
 *
 * ## Mouse mode
 *
 * - Left drag: select, marquee on empty space
 * - Middle drag: orbit
 * - Right drag: pan
 * - Wheel: zoom
 * - Space + left drag: orbit
 *
 * ## Trackpad mode
 *
 * - Left drag: orbit
 * - Shift or Ctrl/Cmd + left drag: marquee select
 * - Left click without movement: pick, exactly as in mouse mode
 * - Two-finger scroll: pan
 * - Pinch, which the browser reports as Ctrl + wheel: zoom
 * - Space + left drag: pan
 *
 * A click that does not move still picks in both modes, so tapping an object to
 * select it never depends on which mode is active.
 */
export class InputSettings {
  private mode: InputMode;
  private explicit: boolean;
  private readonly listeners = new Set<(mode: InputMode) => void>();

  constructor() {
    const stored = InputSettings.readStored();
    this.mode = stored ?? InputSettings.guessFromPlatform();
    this.explicit = stored !== null;
  }

  /** The active mode. */
  get current(): InputMode {
    return this.mode;
  }

  /** True when the user chose the mode rather than it being detected. */
  get isExplicit(): boolean {
    return this.explicit;
  }

  /**
   * Registers a listener for mode changes.
   *
   * @returns An unsubscribe function.
   */
  onChange(handler: (mode: InputMode) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /**
   * Sets the mode from a user action and remembers it.
   *
   * An explicit choice permanently disables detection: someone who switched to
   * mouse mode while a trackpad is attached meant it, and having the
   * application quietly switch back on the next two-finger scroll would be
   * unusable.
   */
  setMode(mode: InputMode): void {
    this.explicit = true;
    InputSettings.writeStored(mode);
    this.applyMode(mode);
  }

  /**
   * Offers a detected mode.
   *
   * Ignored once the user has chosen for themselves.
   */
  suggestMode(mode: InputMode): void {
    if (this.explicit || mode === this.mode) return;
    this.applyMode(mode);
  }

  /**
   * Classifies a wheel event as trackpad or mouse input.
   *
   * A mouse wheel reports large, whole-number deltas in fixed notches. A
   * trackpad reports small fractional deltas, and reports horizontal movement
   * that a wheel cannot produce at all. Either signal alone is weak, so both are
   * checked and a pinch — which arrives as a Ctrl-modified wheel no keyboard
   * produced — is treated as conclusive.
   *
   * @returns The detected mode, or null when the event is not diagnostic.
   */
  static classifyWheel(event: WheelEvent): InputMode | null {
    if (event.ctrlKey) return 'trackpad';
    if (Math.abs(event.deltaX) > 0.01) return 'trackpad';

    const delta = Math.abs(event.deltaY);
    if (delta === 0) return null;
    if (!Number.isInteger(event.deltaY)) return 'trackpad';
    if (delta >= 100) return 'mouse';
    return null;
  }

  /**
   * Resolves what a left-button drag should do.
   *
   * @param modifiers Modifier state at the moment the drag began.
   */
  resolveLeftDrag(modifiers: { shift: boolean; accel: boolean; space: boolean }): DragRole {
    if (modifiers.space) return this.mode === 'trackpad' ? 'pan' : 'orbit';

    if (this.mode === 'trackpad') {
      return modifiers.shift || modifiers.accel ? 'select' : 'orbit';
    }

    return 'select';
  }

  /**
   * True when a left drag in this mode should draw a marquee.
   *
   * In mouse mode a plain drag marquees. In trackpad mode a plain drag orbits,
   * so a marquee requires a modifier — which is also what makes the modifier
   * additive rather than replacing: a shift-drag marquee adds to the selection
   * in both modes, since that is what shift has always meant.
   */
  allowsMarquee(modifiers: { shift: boolean; accel: boolean; space: boolean }): boolean {
    return this.resolveLeftDrag(modifiers) === 'select';
  }

  /** Applies and publishes a mode. */
  private applyMode(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    for (const handler of this.listeners) handler(mode);
  }

  /**
   * Initial guess before any input arrives.
   *
   * A coarse or absent fine pointer means touch or pen; anything reporting no
   * hover is not a desktop mouse. This is only a starting point — the first
   * wheel event usually corrects it within seconds of the user touching
   * anything.
   */
  private static guessFromPlatform(): InputMode {
    if (typeof window === 'undefined' || !window.matchMedia) return 'mouse';
    const fine = window.matchMedia('(any-pointer: fine)').matches;
    const hover = window.matchMedia('(any-hover: hover)').matches;
    return fine && hover ? 'mouse' : 'trackpad';
  }

  private static readStored(): InputMode | null {
    try {
      const value = localStorage.getItem(MODE_KEY);
      return value === 'mouse' || value === 'trackpad' ? value : null;
    } catch {
      return null;
    }
  }

  private static writeStored(mode: InputMode): void {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Preference is a convenience; losing it is not worth surfacing.
    }
  }
}
