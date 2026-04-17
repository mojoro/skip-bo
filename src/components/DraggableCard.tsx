'use client';

import Card from './Card';
import { Card as CardType, CardSource } from '@/lib/game/types';
import { useDraggable } from '@/lib/dnd';

interface DraggableCardProps {
  id: string;
  source: CardSource;
  disabled?: boolean;
  card: CardType;
  size?: 'sm' | 'md' | 'lg';
  highlighted?: boolean;
  dim?: boolean;
  onClick?: () => void;
  stacked?: number;
}

export default function DraggableCard({
  id,
  source,
  disabled,
  card,
  ...cardProps
}: DraggableCardProps) {
  const { ref, isDragging } = useDraggable({
    id,
    data: { source, card },
    disabled,
  });
  return (
    <div
      ref={ref}
      style={{ touchAction: 'none', cursor: disabled ? 'default' : 'grab' }}
      className={isDragging ? 'opacity-30' : ''}
    >
      <Card card={card} {...cardProps} />
    </div>
  );
}
