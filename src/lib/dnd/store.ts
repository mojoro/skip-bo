'use client';

import { DragSourceData, DropTargetData } from './types';

export interface DragState {
  sourceId: string;
  sourceData: DragSourceData;
  pointerId: number;
  originRect: DOMRect;
  pointerOffset: { x: number; y: number };
}

export interface TargetRegistration {
  element: HTMLElement;
  data: DropTargetData;
}

export interface StartDragInit {
  sourceId: string;
  sourceData: DragSourceData;
  pointerId: number;
  originRect: DOMRect;
  pointerOffset: { x: number; y: number };
}

export type DragEndHandler = (
  source: DragSourceData,
  target: DropTargetData | null,
) => void;

/**
 * External store for all drag-and-drop state. Keeps mutable state out of React
 * so that pointermove updates don't re-render every hook consumer on the
 * board — only the specific draggable/droppable whose slice actually changed.
 * Provider mounts its window listeners once on the instance's lifetime; each
 * hook reads its own primitive slice via useSyncExternalStore.
 */
export class DragDropStore {
  private drag: DragState | null = null;
  private hoveredTargetId: string | null = null;
  private readonly targets = new Map<string, TargetRegistration>();
  private readonly listeners = new Set<() => void>();
  private ghostEl: HTMLDivElement | null = null;
  // Pointermove can fire at 120+ Hz on touch devices; coalesce into one
  // rAF-per-frame so the ghost transform + hit-test + hover-notify cost at
  // most once per paint.
  private pendingFrame = 0;
  private lastX = 0;
  private lastY = 0;
  // Element that currently holds pointer capture for the active drag, so we
  // can release the capture when the drag ends regardless of where the pointer
  // is by then.
  private captureEl: HTMLElement | null = null;

  onDragEnd: DragEndHandler | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  getDrag(): DragState | null {
    return this.drag;
  }

  getSourceId(): string | null {
    return this.drag?.sourceId ?? null;
  }

  getHoverId(): string | null {
    return this.hoveredTargetId;
  }

  setGhost(el: HTMLDivElement | null): void {
    this.ghostEl = el;
  }

  registerTarget(id: string, reg: TargetRegistration): void {
    this.targets.set(id, reg);
  }

  /**
   * Update a target's `data` payload without re-creating the Map entry. The
   * data object is usually an inline literal on the consumer, so a naive
   * re-register would churn the Map on every render; patching in place keeps
   * the registry stable.
   */
  updateTargetData(id: string, data: DropTargetData): void {
    const existing = this.targets.get(id);
    if (existing) existing.data = data;
  }

  unregisterTarget(id: string): void {
    this.targets.delete(id);
  }

  startDrag(init: StartDragInit, captureEl: HTMLElement | null): void {
    this.drag = { ...init };
    this.hoveredTargetId = null;
    this.captureEl = captureEl;
    // Claim the pointer so fast drags leaving the viewport, crossing iframe
    // boundaries, or losing focus to the OS still deliver pointerup back here
    // instead of orphaning the listeners.
    if (captureEl && typeof captureEl.setPointerCapture === 'function') {
      try {
        captureEl.setPointerCapture(init.pointerId);
      } catch {
        /* pointer no longer active — nothing to capture */
      }
    }
    this.notify();
  }

  endDrag(outcome: 'drop' | 'cancel'): void {
    const drag = this.drag;
    if (!drag) return;
    if (outcome === 'drop') {
      const target =
        this.hoveredTargetId !== null
          ? this.targets.get(this.hoveredTargetId)?.data ?? null
          : null;
      // Fire before clearing so the callback sees live data and its own
      // setState calls don't land during our notify pass.
      this.onDragEnd?.(drag.sourceData, target);
    }
    if (this.pendingFrame) {
      cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = 0;
    }
    if (
      this.captureEl &&
      typeof this.captureEl.releasePointerCapture === 'function'
    ) {
      try {
        this.captureEl.releasePointerCapture(drag.pointerId);
      } catch {
        /* already released by the browser on pointerup — safe to ignore */
      }
    }
    this.captureEl = null;
    this.drag = null;
    this.hoveredTargetId = null;
    this.notify();
  }

  handlePointerMove(clientX: number, clientY: number): void {
    if (!this.drag) return;
    this.lastX = clientX;
    this.lastY = clientY;
    if (this.pendingFrame) return;
    this.pendingFrame = requestAnimationFrame(this.flushPointerMove);
  }

  private flushPointerMove = (): void => {
    this.pendingFrame = 0;
    const drag = this.drag;
    if (!drag) return;
    const x = this.lastX - drag.pointerOffset.x;
    const y = this.lastY - drag.pointerOffset.y;
    if (this.ghostEl) {
      this.ghostEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    const hit = this.hitTest(this.lastX, this.lastY);
    if (hit !== this.hoveredTargetId) {
      this.hoveredTargetId = hit;
      this.notify();
    }
  };

  private hitTest(x: number, y: number): string | null {
    let bestId: string | null = null;
    let bestArea = Infinity;
    for (const [id, reg] of this.targets) {
      const r = reg.element.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        bestId = id;
      }
    }
    return bestId;
  }
}
