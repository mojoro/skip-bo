'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

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

  return <DragDropContext.Provider value={value}>{children}</DragDropContext.Provider>;
}
