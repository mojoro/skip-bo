'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useDragDrop } from './context';
import { DragSourceData, DropTargetData } from './types';

const DRAG_THRESHOLD_PX = 4;

export interface UseDroppableOptions {
  id: string;
  data: DropTargetData;
  disabled?: boolean;
}

export interface UseDroppableResult {
  ref: (element: HTMLElement | null) => void;
  isOver: boolean;
}

export function useDroppable({ id, data, disabled }: UseDroppableOptions): UseDroppableResult {
  const { hoveredTargetId, registerTarget, unregisterTarget } = useDragDrop();
  const elementRef = useRef<HTMLElement | null>(null);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (elementRef.current === element) return;
      if (elementRef.current) unregisterTarget(id);
      elementRef.current = element;
      if (element && !disabled) registerTarget(id, { element, data });
    },
    [id, data, disabled, registerTarget, unregisterTarget],
  );

  useEffect(() => {
    if (!elementRef.current) return;
    if (disabled) unregisterTarget(id);
    else registerTarget(id, { element: elementRef.current, data });
    return () => unregisterTarget(id);
  }, [id, data, disabled, registerTarget, unregisterTarget]);

  return { ref, isOver: hoveredTargetId === id };
}

export interface UseDraggableOptions {
  id: string;
  data: DragSourceData;
  disabled?: boolean;
}

export interface UseDraggableResult {
  ref: (element: HTMLElement | null) => void;
  isDragging: boolean;
}

export function useDraggable({ id, data, disabled }: UseDraggableOptions): UseDraggableResult {
  const { drag, startDrag } = useDragDrop();
  const elementRef = useRef<HTMLElement | null>(null);
  const configRef = useRef({ id, data, disabled });
  configRef.current = { id, data, disabled };

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      const cfg = configRef.current;
      const element = elementRef.current;
      if (cfg.disabled || !element) return;
      if (e.button !== 0) return; // primary button only
      const rect = element.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY };
      const pointerOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const pointerId = e.pointerId;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        cleanup();
        startDrag({
          sourceId: cfg.id,
          sourceData: cfg.data,
          pointerId,
          originRect: rect,
          pointerOffset,
        });
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onCancel);
        window.removeEventListener('pointercancel', onCancel);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onCancel);
      window.addEventListener('pointercancel', onCancel);
    },
    [startDrag],
  );

  const ref = useCallback(
    (element: HTMLElement | null) => {
      const prev = elementRef.current;
      if (prev === element) return;
      if (prev) prev.removeEventListener('pointerdown', onPointerDown);
      elementRef.current = element;
      if (element) element.addEventListener('pointerdown', onPointerDown);
    },
    [onPointerDown],
  );

  return { ref, isDragging: drag?.sourceId === id };
}
