'use client';

import { useCallback } from 'react';
import Card from './Card';
import type { DragDropStore, DragState } from '@/lib/dnd/store';

interface DragGhostProps {
  store: DragDropStore;
  drag: DragState;
}

export default function DragGhost({ store, drag }: DragGhostProps) {
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      store.setGhost(el);
    },
    [store],
  );

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 1000,
        transform: `translate3d(${drag.originRect.left}px, ${drag.originRect.top}px, 0)`,
        willChange: 'transform',
      }}
      className="drop-shadow-[0_8px_16px_rgba(0,0,0,0.6)] rotate-[-2deg]"
    >
      <Card card={drag.sourceData.card} />
    </div>
  );
}
