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

  unregisterTarget(id: string): void {
    this.targets.delete(id);
  }

  startDrag(init: StartDragInit): void {
    this.drag = { ...init };
    this.hoveredTargetId = null;
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
    this.drag = null;
    this.hoveredTargetId = null;
    this.notify();
  }

  handlePointerMove(clientX: number, clientY: number): void {
    const drag = this.drag;
    if (!drag) return;
    const x = clientX - drag.pointerOffset.x;
    const y = clientY - drag.pointerOffset.y;
    if (this.ghostEl) {
      this.ghostEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    const hit = this.hitTest(clientX, clientY);
    if (hit !== this.hoveredTargetId) {
      this.hoveredTargetId = hit;
      this.notify();
    }
  }

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
