'use client';

import { useDraggable } from '@dnd-kit/react';
import Card from './Card';
import { Card as CardType } from '@/lib/game/types';
import { DragSourceData } from '@/lib/dnd';

interface DraggableCardProps {
  id: string;
  data: DragSourceData;
  disabled?: boolean;
  card: CardType | null;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  highlighted?: boolean;
  dim?: boolean;
  onClick?: () => void;
  label?: string;
  stacked?: number;
}

export default function DraggableCard({
  id,
  data,
  disabled,
  ...cardProps
}: DraggableCardProps) {
  const { ref, isDragging } = useDraggable({ id, data, disabled });
  return (
    <div ref={ref} className={isDragging ? 'opacity-50' : ''}>
      <Card {...cardProps} />
    </div>
  );
}
