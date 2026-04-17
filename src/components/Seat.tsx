'use client';

import Card from '@/components/Card';
import DraggableCard from '@/components/DraggableCard';
import DroppableZone from '@/components/DroppableZone';
import { Card as CardType, PlayerState } from '@/lib/game/types';
import { SeatPosition } from '@/lib/layout/seating';

export type SeatSelection =
  | { kind: 'none' }
  | { kind: 'hand'; index: number }
  | { kind: 'stock' }
  | { kind: 'discard'; pileIndex: number };

interface SeatProps {
  position?: SeatPosition; // undefined = flat layout (mobile/stacked)
  player: PlayerState;
  playerIndex: number;
  isActive: boolean;
  isYou: boolean; // full hand visible vs face-down
  teamIndex: number | null;
  teamColor: string | null;
  selection: SeatSelection;
  cardSize?: 'sm' | 'md';
  onSelectHand?: (idx: number) => void;
  onSelectStock?: () => void;
  onSelectDiscard?: (pileIdx: number) => void;
  onClickDiscardTarget?: (pileIdx: number) => void;
}

export default function Seat({
  position,
  player,
  playerIndex,
  isActive,
  isYou,
  teamIndex,
  teamColor,
  selection,
  cardSize = 'md',
  onSelectHand,
  onSelectStock,
  onSelectDiscard,
  onClickDiscardTarget,
}: SeatProps) {
  const stockTop: CardType | null =
    player.stockPile.length > 0 ? player.stockPile[player.stockPile.length - 1] : null;

  const orientation = !position
    ? 'rotate-0'
    : position.side === 'top'
      ? 'rotate-180'
      : position.side === 'left'
        ? '-rotate-90'
        : position.side === 'right'
          ? 'rotate-90'
          : 'rotate-0';

  const activeRing = isActive
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
          {/* Team color strip */}
          {teamColor && (
            <div
              className="absolute -top-1 left-3 right-3 h-1 rounded-full"
              style={{ background: teamColor }}
            />
          )}

          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white tracking-wide">
                {player.name}
              </span>
              {teamIndex !== null && (
                <span
                  className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold tracking-wider"
                  style={{ background: teamColor ?? 'transparent', color: '#1a1a1a' }}
                >
                  Team {teamIndex + 1}
                </span>
              )}
            </div>
            {isActive && (
              <span className="text-[10px] uppercase text-[var(--gold)] font-bold tracking-widest">
                ↻ turn
              </span>
            )}
          </div>

          {/* Row: stock | hand | discard piles */}
          <div className="flex items-end gap-4">
            {/* Stock pile */}
            <div className="flex flex-col items-center gap-1">
              {stockTop ? (
                <DraggableCard
                  id={`stock-${playerIndex}`}
                  source={{ from: 'stock', playerIndex }}
                  disabled={!isActive}
                  card={stockTop}
                  size={cardSize}
                  highlighted={isActive && selection.kind === 'stock'}
                  onClick={isActive ? onSelectStock : undefined}
                  stacked={player.stockPile.length}
                />
              ) : (
                <Card card={null} size={cardSize} label="empty" />
              )}
              <span className="text-[10px] text-white/70 tracking-widest">
                STOCK · {player.stockPile.length}
              </span>
            </div>

            {/* Hand — fanned */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex gap-1">
                {player.hand.length === 0 && (
                  <div className="text-xs text-white/40 italic px-4">empty hand</div>
                )}
                {player.hand.map((c, i) =>
                  isYou ? (
                    <DraggableCard
                      key={c.id}
                      id={`hand-${playerIndex}-${i}`}
                      source={{ from: 'hand', index: i }}
                      disabled={!isActive}
                      card={c}
                      size={cardSize}
                      highlighted={
                        isActive && selection.kind === 'hand' && selection.index === i
                      }
                      onClick={isActive ? () => onSelectHand?.(i) : undefined}
                    />
                  ) : (
                    <Card key={c.id} card={null} faceDown size={cardSize} />
                  ),
                )}
              </div>
              <span className="text-[10px] text-white/70 tracking-widest">
                HAND · {player.hand.length}
              </span>
            </div>

            {/* Discard piles */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex gap-1">
                {player.discardPiles.map((pile, i) => {
                  const top = pile[pile.length - 1] ?? null;
                  const isSelected =
                    isActive && selection.kind === 'discard' && selection.pileIndex === i;
                  const handleClick = isActive
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
                      id={`discard-src-${playerIndex}-${i}`}
                      source={{ from: 'discard', playerIndex, pileIndex: i }}
                      disabled={!isActive || selection.kind === 'hand'}
                      card={top}
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
                      {isActive ? (
                        <DroppableZone
                          id={`discard-target-${playerIndex}-${i}`}
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
