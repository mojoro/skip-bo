'use client';

import Card from '@/components/Card';
import DraggableCard from '@/components/DraggableCard';
import DroppableZone from '@/components/DroppableZone';
import MobileOpponentStrip from '@/components/MobileOpponentStrip';
import WildDirectionPicker from '@/components/WildDirectionPicker';
import { Card as CardType, CardValue, GameState, WILD } from '@/lib/game/types';
import { SeatSelection } from '@/components/Seat';
import type { SeatViewModel } from '@/lib/view/seat';

type BuildPile = GameState['buildPiles'][number];

function topWildValueForPile(pile: BuildPile): CardValue | undefined {
  if (pile.cards.length === 0) return undefined;
  const top = pile.cards[pile.cards.length - 1];
  if (!top || top.value !== WILD) return undefined;
  if (pile.direction === 'asc') return pile.cards.length as CardValue;
  if (pile.direction === 'desc') return (13 - pile.cards.length) as CardValue;
  return undefined;
}

export interface MobileBoardViewProps {
  self: SeatViewModel;
  opponents: SeatViewModel[];
  buildPiles: GameState['buildPiles'];
  drawPileCount: number;
  completedPileCount: number;
  config: { bidirectionalBuild: boolean };
  selection: SeatSelection;
  onSelectHand: (idx: number) => void;
  onSelectStock: () => void;
  onSelectDiscard: (pileIdx: number) => void;
  onClickBuildPile: (buildPileIndex: number) => void;
  onClickOwnDiscardPile: (pileIdx: number) => void;
  pendingWildBuildPileIndex: number | null;
  onPickWildDirection: (direction: 'asc' | 'desc') => void;
  onCancelWildPlay: () => void;
}

export function MobileBoardView({
  self,
  opponents,
  buildPiles,
  config,
  selection,
  onSelectHand,
  onSelectStock,
  onSelectDiscard,
  onClickBuildPile,
  onClickOwnDiscardPile,
  pendingWildBuildPileIndex,
  onPickWildDirection,
  onCancelWildPlay,
}: MobileBoardViewProps) {
  const yourStockTop: CardType | null = self.stockTop as CardType | null;
  const activeTeamColor = self.team?.color ?? null;
  const emptyLabel = config.bidirectionalBuild ? '1/12/W' : '1/W';

  return (
    <div className="absolute inset-0 pt-[72px] pb-0 px-2 flex flex-col gap-2 max-w-3xl mx-auto left-0 right-0">
      {/* Opponents stack — scrolls when too many */}
      <div className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto pb-1">
        {opponents.map((seat) => (
          <MobileOpponentStrip key={seat.slotIndex} seat={seat} />
        ))}
      </div>

      {/* Active-player zone — stays pinned at the bottom regardless of opponent count */}
      <div className="flex flex-col gap-2 shrink-0 pb-2">
        {/* Build row: your stock + 4 build piles */}
        <div
          className="relative rounded-lg px-2 py-2 flex items-start gap-2 justify-center"
          style={{
            background:
              'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.06), rgba(0,0,0,0.3))',
            boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5)',
          }}
        >
          {/* Your stock — always present so you know what's on top */}
          <div className="flex flex-col items-center gap-0.5 shrink-0" data-tour="stock">
            {yourStockTop ? (
              <DraggableCard
                id={`m-stock-${self.slotIndex}`}
                source={{ from: 'stock', playerIndex: self.slotIndex }}
                card={yourStockTop}
                size="md"
                highlighted={selection.kind === 'stock'}
                onClick={onSelectStock}
                stacked={self.stockCount}
              />
            ) : (
              <Card card={null} size="md" label="empty" />
            )}
            <span className="text-[9px] text-white/70 tracking-widest whitespace-nowrap tabular-nums">
              STOCK · {self.stockCount}
            </span>
          </div>

          <div className="w-px self-stretch bg-white/10 mx-1" />

          {/* Build piles */}
          <div className="flex items-start gap-1" data-tour="build">
            {buildPiles.map((pile, i) => {
              const top = pile.cards[pile.cards.length - 1] ?? null;
              const isPendingWild = pendingWildBuildPileIndex === i;
              return (
                <DroppableZone
                  key={i}
                  id={`m-build-${i}`}
                  data={{ kind: 'build', index: i }}
                  className="flex flex-col items-center gap-0.5"
                >
                  {isPendingWild ? (
                    <WildDirectionPicker
                      size="md"
                      onPickAsc={() => onPickWildDirection('asc')}
                      onPickDesc={() => onPickWildDirection('desc')}
                      onCancel={onCancelWildPlay}
                    />
                  ) : (
                    <Card
                      card={top}
                      size="md"
                      stacked={pile.cards.length}
                      asValue={topWildValueForPile(pile)}
                      buildDirection={pile.direction ?? undefined}
                      onClick={() => onClickBuildPile(i)}
                    />
                  )}
                  {isPendingWild ? (
                    <span className="text-[9px] text-white/70 whitespace-nowrap">pick</span>
                  ) : pile.cards.length === 0 ? (
                    <span className="text-[9px] text-white/70 whitespace-nowrap">{emptyLabel}</span>
                  ) : null}
                </DroppableZone>
              );
            })}
          </div>
        </div>

        {/* Your hand — always fully visible */}
        <div
          data-tour="hand"
          className="rounded-lg px-2 py-2 flex flex-col items-center gap-1"
          style={{
            background: 'rgba(0, 0, 0, 0.35)',
            boxShadow: activeTeamColor
              ? `inset 0 2px 0 0 ${activeTeamColor}, inset 0 0 0 1px rgba(255,255,255,0.05)`
              : 'inset 0 0 0 1px rgba(255,255,255,0.05)',
          }}
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-[11px] font-semibold text-white">
              {self.name}
              {self.isActive && (
                <span className="text-[var(--gold)] ml-1">· your turn</span>
              )}
            </span>
            <span className="text-[9px] text-white/60 uppercase tracking-wider tabular-nums">
              HAND · {self.handCount}
            </span>
          </div>
          <div className="flex gap-1 justify-center flex-wrap">
            {self.handCount === 0 && (
              <div className="text-xs text-white/40 italic py-4">empty hand</div>
            )}
            {self.handCards !== null
              ? self.handCards.map((c, i) => (
                  <DraggableCard
                    key={c.id}
                    id={`m-hand-${self.slotIndex}-${i}`}
                    source={{ from: 'hand', index: i }}
                    card={c as CardType}
                    size="md"
                    highlighted={selection.kind === 'hand' && selection.index === i}
                    onClick={() => onSelectHand(i)}
                  />
                ))
              : Array.from({ length: self.handCount }).map((_, i) => (
                  <Card key={`hand-back-${i}`} card={null} faceDown size="md" />
                ))}
          </div>
        </div>

        {/* Your discard piles — drop targets + sources */}
        <div
          data-tour="discard"
          className="rounded-lg px-2 py-2 flex flex-col items-center gap-1 bg-black/30 ring-1 ring-white/5"
        >
          <span className="text-[9px] text-white/60 uppercase tracking-wider w-full">
            DISCARD
          </span>
          <div className="flex gap-1 justify-center w-full">
            {self.discardPiles.map((pile, i) => {
              const top = pile[pile.length - 1] ?? null;
              const isSelected = selection.kind === 'discard' && selection.pileIndex === i;
              const cardEl = top ? (
                <DraggableCard
                  id={`m-discard-src-${self.slotIndex}-${i}`}
                  source={{ from: 'discard', playerIndex: self.slotIndex, pileIndex: i }}
                  disabled={selection.kind === 'hand'}
                  card={top as CardType}
                  size="md"
                  highlighted={isSelected}
                  stacked={pile.length}
                  onClick={() => {
                    if (selection.kind === 'hand') onClickOwnDiscardPile(i);
                    else onSelectDiscard(i);
                  }}
                />
              ) : (
                <Card
                  card={null}
                  size="md"
                  onClick={() => {
                    if (selection.kind === 'hand') onClickOwnDiscardPile(i);
                  }}
                />
              );
              return (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <DroppableZone
                    id={`m-discard-target-${self.slotIndex}-${i}`}
                    data={{ kind: 'discard', index: i }}
                  >
                    {cardEl}
                  </DroppableZone>
                  <span className="text-[9px] text-white/50 tabular-nums">{pile.length}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

