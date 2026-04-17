'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import DragGhost from '@/components/DragGhost';
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

export interface DragDropContextValue {
  drag: DragState | null;
  hoveredTargetId: string | null;
  registerTarget: (id: string, reg: TargetRegistration) => void;
  unregisterTarget: (id: string) => void;
  startDrag: (init: StartDragInit) => void;
  endDrag: (outcome: 'drop' | 'cancel') => void;
}

export interface StartDragInit {
  sourceId: string;
  sourceData: DragSourceData;
  pointerId: number;
  originRect: DOMRect;
  pointerOffset: { x: number; y: number };
}

const DragDropContext = createContext<DragDropContextValue | null>(null);

function hitTestTargets(
  targets: Map<string, TargetRegistration>,
  x: number,
  y: number,
): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity; // prefer smaller (more specific) targets
  for (const [id, reg] of targets) {
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

export function useDragDrop(): DragDropContextValue {
  const ctx = useContext(DragDropContext);
  if (!ctx) throw new Error('useDragDrop must be used inside DragDropProvider');
  return ctx;
}

interface DragDropProviderProps {
  onDragEnd?: (source: DragSourceData, target: DropTargetData | null) => void;
  children: ReactNode;
}

export function DragDropProvider({ onDragEnd, children }: DragDropProviderProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const targetsRef = useRef<Map<string, TargetRegistration>>(new Map());
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  useEffect(() => {
    if (!drag) return;
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const node = ghostRef.current;
      if (node) {
        const x = e.clientX - drag.pointerOffset.x;
        const y = e.clientY - drag.pointerOffset.y;
        node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      const hit = hitTestTargets(targetsRef.current, e.clientX, e.clientY);
      setHoveredTargetId((prev) => (prev === hit ? prev : hit));
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      endDragRef.current('drop');
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      endDragRef.current('cancel');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endDragRef.current('cancel');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      document.body.style.cursor = prevCursor;
    };
  }, [drag]);

  const registerTarget = useCallback((id: string, reg: TargetRegistration) => {
    targetsRef.current.set(id, reg);
  }, []);

  const unregisterTarget = useCallback((id: string) => {
    targetsRef.current.delete(id);
  }, []);

  const startDrag = useCallback((init: StartDragInit) => {
    setDrag({
      sourceId: init.sourceId,
      sourceData: init.sourceData,
      pointerId: init.pointerId,
      originRect: init.originRect,
      pointerOffset: init.pointerOffset,
    });
    setHoveredTargetId(null);
  }, []);

  const endDrag = useCallback(
    (outcome: 'drop' | 'cancel') => {
      if (drag && outcome === 'drop') {
        const target =
          hoveredTargetId !== null
            ? targetsRef.current.get(hoveredTargetId)?.data ?? null
            : null;
        // Fire before clearing drag state so the callback sees valid data and
        // so its setState calls don't land during our reducer phase.
        onDragEndRef.current?.(drag.sourceData, target);
      }
      setDrag(null);
      setHoveredTargetId(null);
    },
    [drag, hoveredTargetId],
  );

  const endDragRef = useRef(endDrag);
  endDragRef.current = endDrag;

  const value = useMemo<DragDropContextValue>(
    () => ({
      drag,
      hoveredTargetId,
      registerTarget,
      unregisterTarget,
      startDrag,
      endDrag,
    }),
    [drag, hoveredTargetId, registerTarget, unregisterTarget, startDrag, endDrag],
  );

  return (
    <DragDropContext.Provider value={value}>
      {children}
      {drag && <DragGhost ghostRef={ghostRef} drag={drag} />}
    </DragDropContext.Provider>
  );
}
