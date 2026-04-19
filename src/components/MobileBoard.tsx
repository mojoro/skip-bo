'use client';

import Card from '@/components/Card';
import DraggableCard from '@/components/DraggableCard';
import DroppableZone from '@/components/DroppableZone';
import MobileOpponentStrip from '@/components/MobileOpponentStrip';
import WildDirectionPicker from '@/components/WildDirectionPicker';
import { Card as CardType, GameState, PlayerState } from '@/lib/game/types';
import { SeatSelection } from '@/components/Seat';
import type { SeatViewModel } from '@/lib/view/seat';

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
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            {yourStockTop ? (
              <DraggableCard
                id={`stock-${self.slotIndex}`}
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
            <span className="text-[9px] text-white/70 tracking-widest whitespace-nowrap">
              STOCK · {self.stockCount}
            </span>
          </div>

          <div className="w-px self-stretch bg-white/10 mx-1" />

          {/* Build piles */}
          <div className="flex items-start gap-1">
            {buildPiles.map((pile, i) => {
              const top = pile.cards[pile.cards.length - 1] ?? null;
              const sub =
                pile.cards.length === 0
                  ? emptyLabel
                  : `${pile.direction === 'asc' ? '↑' : '↓'}${pile.cards.length}`;
              const isPendingWild = pendingWildBuildPileIndex === i;
              return (
                <DroppableZone
                  key={i}
                  id={`build-${i}`}
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
                      onClick={() => onClickBuildPile(i)}
                    />
                  )}
                  <span className="text-[9px] text-white/70 whitespace-nowrap">
                    {isPendingWild ? 'pick' : sub}
                  </span>
                </DroppableZone>
              );
            })}
          </div>
        </div>

        {/* Your hand — always fully visible */}
        <div
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
              <span className="text-[var(--gold)] ml-1">· your turn</span>
            </span>
            <span className="text-[9px] text-white/60 uppercase tracking-wider">
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
                    id={`hand-${self.slotIndex}-${i}`}
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
        <div className="rounded-lg px-2 py-2 flex flex-col items-center gap-1 bg-black/30 ring-1 ring-white/5">
          <span className="text-[9px] text-white/60 uppercase tracking-wider w-full">
            DISCARD
          </span>
          <div className="flex gap-1 justify-center w-full">
            {self.discardPiles.map((pile, i) => {
              const top = pile[pile.length - 1] ?? null;
              const isSelected = selection.kind === 'discard' && selection.pileIndex === i;
              const cardEl = top ? (
                <DraggableCard
                  id={`discard-src-${self.slotIndex}-${i}`}
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
                    id={`discard-target-${self.slotIndex}-${i}`}
                    data={{ kind: 'discard', index: i }}
                  >
                    {cardEl}
                  </DroppableZone>
                  <span className="text-[9px] text-white/50">{pile.length}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Backward-compat default export — /local still passes GameState-based props.
// Strip in Task 6.1 once /local uses Board.
interface MobileBoardProps {
  state: GameState;
  activePlayer: PlayerState;
  activeIdx: number;
  selection: SeatSelection;
  teamColorFor: (id: string) => { index: number | null; color: string | null };
  opponents: { player: PlayerState; index: number }[];
  onSelectHand: (idx: number) => void;
  onSelectStock: () => void;
  onSelectDiscard: (pileIdx: number) => void;
  onClickBuildPile: (buildPileIndex: number) => void;
  onClickOwnDiscardPile: (pileIdx: number) => void;
  pendingWildBuildPileIndex?: number | null;
  onPickWildDirection?: (direction: 'asc' | 'desc') => void;
  onCancelWildPlay?: () => void;
}

export default function MobileBoard(props: MobileBoardProps) {
  const { state, activePlayer, activeIdx, teamColorFor, opponents } = props;

  const activeTeam = teamColorFor(activePlayer.id);
  const stockTop =
    activePlayer.stockPile.length > 0
      ? activePlayer.stockPile[activePlayer.stockPile.length - 1]!
      : null;

  const self: SeatViewModel = {
    slotIndex: activeIdx,
    name: activePlayer.name,
    handCards: activePlayer.hand,
    handCount: activePlayer.hand.length,
    stockTop: stockTop ? { id: stockTop.id, value: stockTop.value } : null,
    stockCount: activePlayer.stockPile.length,
    discardPiles: activePlayer.discardPiles.map((pile) =>
      pile.map((c) => ({ id: c.id, value: c.value })),
    ),
    team:
      activeTeam.index !== null && activeTeam.color !== null
        ? { index: activeTeam.index, color: activeTeam.color }
        : null,
    isActive: true,
    isYou: true,
    isHost: false,
    presence: 'online',
  };

  const opponentSeats: SeatViewModel[] = opponents.map(({ player, index }) => {
    const team = teamColorFor(player.id);
    const top =
      player.stockPile.length > 0
        ? player.stockPile[player.stockPile.length - 1]!
        : null;
    return {
      slotIndex: index,
      name: player.name,
      handCards: null,
      handCount: player.hand.length,
      stockTop: top ? { id: top.id, value: top.value } : null,
      stockCount: player.stockPile.length,
      discardPiles: player.discardPiles.map((pile) =>
        pile.map((c) => ({ id: c.id, value: c.value })),
      ),
      team:
        team.index !== null && team.color !== null
          ? { index: team.index, color: team.color }
          : null,
      isActive: false,
      isYou: false,
      isHost: false,
      presence: 'online',
    };
  });

  return (
    <MobileBoardView
      self={self}
      opponents={opponentSeats}
      buildPiles={state.buildPiles}
      drawPileCount={state.drawPile.length}
      completedPileCount={state.completedBuildPiles.length}
      config={state.config}
      selection={props.selection}
      onSelectHand={props.onSelectHand}
      onSelectStock={props.onSelectStock}
      onSelectDiscard={props.onSelectDiscard}
      onClickBuildPile={props.onClickBuildPile}
      onClickOwnDiscardPile={props.onClickOwnDiscardPile}
      pendingWildBuildPileIndex={props.pendingWildBuildPileIndex ?? null}
      onPickWildDirection={props.onPickWildDirection ?? (() => {})}
      onCancelWildPlay={props.onCancelWildPlay ?? (() => {})}
    />
  );
}
