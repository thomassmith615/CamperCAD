import type { EventBus } from '@/core/EventBus';
import type { AppEvents } from '@/core/AppEvents';
import type { Tool, ToolId } from './ToolTypes';

/**
 * Owns the active tool and routes pointer input to it.
 *
 * Pointer capture is taken on press so a gesture that starts in the viewport
 * finishes there even if the pointer leaves the canvas mid-drag. Without it, a
 * marquee dragged off the edge of the window never receives its release event
 * and the rubber band stays on screen.
 */
export class ToolManager {
  private readonly tools = new Map<ToolId, Tool>();
  private readonly canvas: HTMLCanvasElement;
  private readonly bus: EventBus<AppEvents>;
  private readonly disposers: Array<() => void> = [];

  private active: Tool | null = null;

  constructor(canvas: HTMLCanvasElement, bus: EventBus<AppEvents>) {
    this.canvas = canvas;
    this.bus = bus;
    this.bindPointer();
  }

  /** The tool currently receiving input. */
  get activeTool(): Tool | null {
    return this.active;
  }

  /** Registers a tool. The first registered tool becomes active. */
  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
    if (!this.active) this.activate(tool.id);
  }

  /** Switches tools, running the outgoing tool's cleanup first. */
  activate(id: ToolId): void {
    const tool = this.tools.get(id);
    if (!tool || tool === this.active) return;

    this.active?.deactivate?.();
    this.active = tool;
    tool.activate?.();

    this.canvas.style.cursor = tool.cursor;
    this.bus.emit('tool:changed', { tool: id });
  }

  /** Asks the active tool to abandon whatever it is doing. */
  cancel(): void {
    this.active?.onCancel?.();
  }

  /** Detaches every listener. */
  dispose(): void {
    this.active?.deactivate?.();
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
  }

  /** Wires canvas pointer events through to the active tool. */
  private bindPointer(): void {
    const down = (event: PointerEvent) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.active?.onPointerDown?.(event);
    };
    const move = (event: PointerEvent) => this.active?.onPointerMove?.(event);
    const up = (event: PointerEvent) => {
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
      this.active?.onPointerUp?.(event);
    };

    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);

    this.disposers.push(
      () => this.canvas.removeEventListener('pointerdown', down),
      () => this.canvas.removeEventListener('pointermove', move),
      () => this.canvas.removeEventListener('pointerup', up),
      () => this.canvas.removeEventListener('pointercancel', up),
    );
  }
}
