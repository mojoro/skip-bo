'use client';

import Card from './Card';
import { Card as CardType, CardSource } from '@/lib/game/types';

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
  id: _id,
  source: _source,
  disabled: _disabled,
  ...cardProps
}: DraggableCardProps) {
  return <Card {...cardProps} />;
}
