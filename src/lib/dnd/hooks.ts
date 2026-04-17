'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useDragDrop } from './context';
import { DropTargetData } from './types';

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
