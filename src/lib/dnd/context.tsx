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
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
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

  const endDrag = useCallback((outcome: 'drop' | 'cancel') => {
    setDrag((current) => {
      if (!current) return null;
      if (outcome === 'drop') {
        const target =
          hoveredTargetId !== null
            ? targetsRef.current.get(hoveredTargetId)?.data ?? null
            : null;
        onDragEndRef.current?.(current.sourceData, target);
      }
      return null;
    });
    setHoveredTargetId(null);
  }, [hoveredTargetId]);

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
