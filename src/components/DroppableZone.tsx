'use client';

import { ReactNode } from 'react';
import { useDroppable, DropTargetData } from '@/lib/dnd';

interface DroppableZoneProps {
  id: string;
  data: DropTargetData;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export default function DroppableZone({
  id,
  data,
  disabled,
  className,
  children,
}: DroppableZoneProps) {
  const { ref, isOver } = useDroppable({ id, data, disabled });
  const hoverRing = isOver
    ? 'outline outline-2 outline-[var(--gold)] outline-offset-2 rounded-md'
    : '';
  return (
    <div ref={ref} className={`${className ?? ''} ${hoverRing}`}>
      {children}
    </div>
  );
}
