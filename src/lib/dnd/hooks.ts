'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useDragDropStore } from './context';
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
  const store = useDragDropStore();
  const elementRef = useRef<HTMLElement | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const isOver = useSyncExternalStore(
    store.subscribe,
    () => store.getHoverId() === id,
    () => false,
  );

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (elementRef.current === element) return;
      if (elementRef.current) store.unregisterTarget(id);
      elementRef.current = element;
      if (element && !disabled) {
        store.registerTarget(id, { element, data: dataRef.current });
      }
    },
    [id, disabled, store],
  );

  return { ref, isOver };
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
  const store = useDragDropStore();
  const elementRef = useRef<HTMLElement | null>(null);
  const idRef = useRef(id);
  const dataRef = useRef(data);
  const disabledRef = useRef(disabled);
  idRef.current = id;
  dataRef.current = data;
  disabledRef.current = disabled;

  const isDragging = useSyncExternalStore(
    store.subscribe,
    () => store.getSourceId() === id,
    () => false,
  );

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      const element = elementRef.current;
      if (disabledRef.current || !element) return;
      if (e.button !== 0) return;
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
        store.startDrag(
          {
            sourceId: idRef.current,
            sourceData: dataRef.current,
            pointerId,
            originRect: rect,
            pointerOffset,
          },
          element,
        );
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
    [store],
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

  return { ref, isDragging };
}
