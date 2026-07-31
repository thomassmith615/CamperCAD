/**
 * A minimal, strongly typed publish/subscribe bus.
 *
 * Subsystems never hold references to the UI and the UI never reaches into
 * subsystem internals; both communicate through an `EventBus` instance owned by
 * the {@link Application}. This is what allows selection, snapping, commands and
 * the object library to be added later without editing existing modules — new
 * event names extend the map, existing listeners are untouched.
 *
 * @typeParam Events A map of event name to payload type. Declared as an
 * interface by convention; `object` is used as the constraint because an
 * interface has no implicit index signature to satisfy `Record`.
 */
export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  /**
   * Registers `handler` for `event`.
   *
   * @returns An unsubscribe function. Callers that own a lifetime (panels,
   * tools) should keep it and call it on disposal.
   */
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(event, handler);
  }

  /** Registers `handler` to run at most once. */
  once<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  /** Removes a previously registered handler. */
  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    this.listeners.get(event)?.delete(handler as (payload: never) => void);
  }

  /**
   * Delivers `payload` to every listener of `event`.
   *
   * Handlers are copied before iteration so a listener may unsubscribe itself
   * during dispatch. A throwing handler is reported but does not prevent the
   * remaining handlers from running: one broken panel must not freeze the app.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as (value: Events[K]) => void)(payload);
      } catch (error) {
        console.error(`[EventBus] listener for "${String(event)}" threw:`, error);
      }
    }
  }

  /** Drops all listeners. Used when tearing down the application. */
  clear(): void {
    this.listeners.clear();
  }
}
