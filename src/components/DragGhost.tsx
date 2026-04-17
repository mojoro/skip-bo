'use client';

import { RefObject } from 'react';
import Card from './Card';
import type { DragState } from '@/lib/dnd/context';

interface DragGhostProps {
  ghostRef: RefObject<HTMLDivElement | null>;
  drag: DragState;
}

export default function DragGhost({ ghostRef, drag }: DragGhostProps) {
  return (
    <div
      ref={ghostRef}
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
