'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import DragGhost from '@/components/DragGhost';
import { DragDropStore } from './store';

const DragDropContext = createContext<DragDropStore | null>(null);

export function useDragDropStore(): DragDropStore {
  const store = useContext(DragDropContext);
  if (!store) {
    throw new Error('useDragDropStore must be used inside DragDropProvider');
  }
  return store;
}

interface DragDropProviderProps {
  onDragEnd?: (
    source: import('./types').DragSourceData,
    target: import('./types').DropTargetData | null,
  ) => void;
  children: ReactNode;
}

export function DragDropProvider({ onDragEnd, children }: DragDropProviderProps) {
  const storeRef = useRef<DragDropStore | null>(null);
  if (!storeRef.current) storeRef.current = new DragDropStore();
  const store = storeRef.current;
  store.onDragEnd = onDragEnd ?? null;

  // Re-render to mount/unmount DragGhost when the drag state toggles. Hover
  // changes flow through the same notify pass, but getDrag() returns the same
  // reference across a hover change so useSyncExternalStore skips the render.
  const drag = useSyncExternalStore(
    store.subscribe,
    () => store.getDrag(),
    () => null,
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = store.getDrag();
      if (!d || e.pointerId !== d.pointerId) return;
      store.handlePointerMove(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      const d = store.getDrag();
      if (!d || e.pointerId !== d.pointerId) return;
      store.endDrag('drop');
    };
    const onCancel = (e: PointerEvent) => {
      const d = store.getDrag();
      if (!d || e.pointerId !== d.pointerId) return;
      store.endDrag('cancel');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && store.getDrag()) store.endDrag('cancel');
    };
    // Pointer listeners never call preventDefault here (the tabletop surface
    // sets `touch-action: none` instead), so they can run as passive and let
    // the scheduler coalesce them with compositor work.
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onCancel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [store]);

  useEffect(() => {
    if (!drag) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.cursor = prev;
    };
  }, [drag]);

  return (
    <DragDropContext.Provider value={store}>
      {children}
      {drag && <DragGhost store={store} drag={drag} />}
    </DragDropContext.Provider>
  );
}
