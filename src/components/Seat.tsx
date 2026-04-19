'use client';

import Card from '@/components/Card';
import DraggableCard from '@/components/DraggableCard';
import DroppableZone from '@/components/DroppableZone';
import { Card as CardType } from '@/lib/game/types';
import { SeatPosition } from '@/lib/layout/seating';
import type { SeatViewModel } from '@/lib/view/seat';

export type SeatSelection =
  | { kind: 'none' }
  | { kind: 'hand'; index: number }
  | { kind: 'stock' }
  | { kind: 'discard'; pileIndex: number };

export interface SeatViewProps {
  position?: SeatPosition;
  seat: SeatViewModel;
  selection: SeatSelection;
  cardSize?: 'sm' | 'md';
  onSelectHand?: (idx: number) => void;
  onSelectStock?: () => void;
  onSelectDiscard?: (pileIdx: number) => void;
  onClickDiscardTarget?: (pileIdx: number) => void;
}

export function SeatView(props: SeatViewProps) {
  const {
    position, seat, selection, cardSize = 'md',
    onSelectHand, onSelectStock, onSelectDiscard, onClickDiscardTarget,
  } = props;

  const stockTop = seat.stockTop;

  const orientation = !position
    ? 'rotate-0'
    : position.side === 'top'
      ? 'rotate-180'
      : position.side === 'left'
        ? '-rotate-90'
        : position.side === 'right'
          ? 'rotate-90'
          : 'rotate-0';

  const activeRing = seat.isActive
    ? 'ring-2 ring-[var(--gold)] shadow-[0_0_24px_rgba(217,164,65,0.45)]'
    : 'ring-1 ring-black/30';

  const body = (
    <div className={`${orientation} origin-center`}>
      <div
        className={`relative rounded-xl ${activeRing} px-3 py-2 sm:px-4 sm:py-3 backdrop-blur-[1px]`}
        style={{
          background: 'rgba(0, 0, 0, 0.35)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        {seat.team && (
          <div
            className="absolute -top-1 left-3 right-3 h-1 rounded-full"
            style={{ background: seat.team.color }}
          />
        )}

        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white tracking-wide">
              {seat.name}
            </span>
            {seat.team && (
              <span
                className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold tracking-wider"
                style={{ background: seat.team.color, color: '#1a1a1a' }}
              >
                Team {seat.team.index + 1}
              </span>
            )}
            {seat.isHost && (
              <span className="text-[10px] uppercase text-[var(--gold)] font-bold tracking-wider">
                host
              </span>
            )}
          </div>
          {seat.isActive && (
            <span className="text-[10px] uppercase text-[var(--gold)] font-bold tracking-widest">
              ↻ turn
            </span>
          )}
        </div>

        <div className="flex items-end gap-2 sm:gap-4 flex-wrap sm:flex-nowrap">
          <div className="flex flex-col items-center gap-1">
            {stockTop ? (
              <DraggableCard
                id={`stock-${seat.slotIndex}`}
                source={{ from: 'stock', playerIndex: seat.slotIndex }}
                disabled={!seat.isActive || !seat.isYou}
                card={stockTop as CardType}
                size={cardSize}
                highlighted={seat.isActive && selection.kind === 'stock'}
                onClick={seat.isActive && seat.isYou ? onSelectStock : undefined}
                stacked={seat.stockCount}
              />
            ) : (
              <Card card={null} size={cardSize} label="empty" />
            )}
            <span className="text-[10px] text-white/70 tracking-widest">
              STOCK · {seat.stockCount}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
            <div className="flex gap-1 overflow-x-auto max-w-full pb-1">
              {seat.handCount === 0 && (
                <div className="text-xs text-white/40 italic px-4">empty hand</div>
              )}
              {seat.handCards !== null
                ? seat.handCards.map((c, i) => (
                    <DraggableCard
                      key={c.id}
                      id={`hand-${seat.slotIndex}-${i}`}
                      source={{ from: 'hand', index: i }}
                      disabled={!seat.isActive || !seat.isYou}
                      card={c}
                      size={cardSize}
                      highlighted={
                        seat.isActive && selection.kind === 'hand' && selection.index === i
                      }
                      onClick={seat.isActive && seat.isYou ? () => onSelectHand?.(i) : undefined}
                    />
                  ))
                : Array.from({ length: seat.handCount }).map((_, i) => (
                    <Card key={`hand-back-${i}`} card={null} faceDown size={cardSize} />
                  ))}
            </div>
            <span className="text-[10px] text-white/70 tracking-widest">
              HAND · {seat.handCount}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1">
              {seat.discardPiles.map((pile, i) => {
                const top = pile[pile.length - 1] ?? null;
                const isSelected =
                  seat.isActive && selection.kind === 'discard' && selection.pileIndex === i;
                const handleClick = seat.isActive && seat.isYou
                  ? () => {
                      if (selection.kind === 'hand') {
                        onClickDiscardTarget?.(i);
                      } else {
                        onSelectDiscard?.(i);
                      }
                    }
                  : undefined;
                const card = top ? (
                  <DraggableCard
                    id={`discard-src-${seat.slotIndex}-${i}`}
                    source={{ from: 'discard', playerIndex: seat.slotIndex, pileIndex: i }}
                    disabled={!seat.isActive || !seat.isYou || selection.kind === 'hand'}
                    card={top as CardType}
                    size="sm"
                    highlighted={isSelected}
                    stacked={pile.length}
                    onClick={handleClick}
                  />
                ) : (
                  <Card card={null} size="sm" label="" onClick={handleClick} />
                );
                return (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    {seat.isActive && seat.isYou ? (
                      <DroppableZone
                        id={`discard-target-${seat.slotIndex}-${i}`}
                        data={{ kind: 'discard', index: i }}
                      >
                        {card}
                      </DroppableZone>
                    ) : (
                      card
                    )}
                    <span className="text-[9px] text-white/50">{pile.length}</span>
                  </div>
                );
              })}
            </div>
            <span className="text-[10px] text-white/70 tracking-widest">DISCARD</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (!position) return body;
  return (
    <div
      className="absolute"
      style={{
        left: `${position.xPct}%`,
        top: `${position.yPct}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {body}
    </div>
  );
}

