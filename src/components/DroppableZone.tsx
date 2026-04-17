'use client';

import { ReactNode } from 'react';
import { DropTargetData } from '@/lib/dnd';

interface DroppableZoneProps {
  id: string;
  data: DropTargetData;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export default function DroppableZone({
  id: _id,
  data: _data,
  disabled: _disabled,
  className,
  children,
}: DroppableZoneProps) {
  return <div className={className}>{children}</div>;
}
