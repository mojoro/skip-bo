'use client';

import { useCallback, useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { DragDropProvider, DragSourceData, DropTargetData } from '@/lib/dnd';
import { MobileBoardView } from '@/components/MobileBoard';
import { SeatView, SeatSelection } from '@/components/Seat';
import TableCenter from '@/components/TableCenter';
import WinModal from '@/components/WinModal';
import { CardSource, GameAction, WILD } from '@/lib/game/types';
import { getSeatPositions } from '@/lib/layout/seating';
import type { GameViewSeat, PlayerView } from '@/lib/net/protocol';
import { buildSeatViewModels } from '@/lib/view/seat';

interface PendingDiscard {
  handIndex: number;
  discardPileIndex: number;
  targetSlotIndex: number;
  cardLabel: string;
}

interface PendingWildPlay {
  source: CardSource;
  buildPileIndex: number;
}

const TEAM_COLORS = ['#c62828', '#1565c0', '#2e7d32', '#e65100'] as const;

export interface BoardProps {
  view: PlayerView;
  seats: GameViewSeat[];
  dispatch: (action: GameAction) => void;
  youSlotIndex: number;
  rematchRoomId?: string | null;
  onRequestRematch?: () => void;
  onBackToLobby?: () => void;
}

export default function Board({
  view,
  seats,
  dispatch,
  youSlotIndex,
  rematchRoomId = null,
  onRequestRematch = () => {},
  onBackToLobby = () => {},
}: BoardProps) {
  const [selection, setSelection] = useState<SeatSelection>({ kind: 'none' });
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null);
  const [pendingWildPlay, setPendingWildPlay] = useState<PendingWildPlay | null>(null);

  const seatViewModels = useMemo(
    () => buildSeatViewModels({ view, seats, teamColors: TEAM_COLORS }),
    [view, seats],
  );

  const youSeat = seatViewModels.find((s) => s.slotIndex === youSlotIndex);
  const isYourTurn = view.currentPlayerSlotIndex === youSlotIndex;

  // Desktop tabletop layout only works for small tables; 5+ falls back to compact layout.
  const useTableLayout = seats.length <= 4;

  const seatPositions = useMemo(() => getSeatPositions(seats.length), [seats.length]);

  // Rotate seat geometry so "you" sit at the bottom (index 0 in layout).
  const youPositionIndex = seatViewModels.findIndex((s) => s.slotIndex === youSlotIndex);
  const seatOf = (layoutIndex: number) => {
    const rotated = (layoutIndex - youPositionIndex + seatViewModels.length) % seatViewModels.length;
    return seatPositions[rotated];
  };

  // --- card resolution helpers ---

  const resolveCardForSource = (source: CardSource) => {
    if (!youSeat) return null;
    if (source.from === 'hand') {
      return youSeat.handCards?.[source.index] ?? null;
    }
    if (source.from === 'stock') {
      return youSeat.stockTop ?? null;
    }
    // discard
    const pile = youSeat.discardPiles[source.pileIndex] ?? [];
    return pile[pile.length - 1] ?? null;
  };

  const sourceFromSelection = (): CardSource | null => {
    if (selection.kind === 'hand') return { from: 'hand', index: selection.index };
    if (selection.kind === 'stock') return { from: 'stock', playerIndex: youSlotIndex };
    if (selection.kind === 'discard') {
      return { from: 'discard', playerIndex: youSlotIndex, pileIndex: selection.pileIndex };
    }
    return null;
  };

  // --- action dispatchers ---

  const tryPlayToBuild = (source: CardSource, buildPileIndex: number) => {
    const pile = view.buildPiles[buildPileIndex];
    const isEmpty = pile ? pile.cards.length === 0 : true;
    const card = resolveCardForSource(source);
    if (isEmpty && view.config.bidirectionalBuild && card?.value === WILD) {
      setPendingWildPlay({ source, buildPileIndex });
      return;
    }
    dispatch({ type: 'PLAY_TO_BUILD', source, buildPileIndex });
  };

  const resolvePendingWild = (direction: 'asc' | 'desc') => {
    if (!pendingWildPlay) return;
    dispatch({
      type: 'PLAY_TO_BUILD',
      source: pendingWildPlay.source,
      buildPileIndex: pendingWildPlay.buildPileIndex,
      declaredDirection: direction,
    });
    setPendingWildPlay(null);
  };

  const cancelPendingWild = () => setPendingWildPlay(null);

  const tryDiscard = (handIndex: number, pileIndex: number) => {
    if (!youSeat) return;
    const hand = youSeat.handCards;
    const card = hand?.[handIndex] ?? null;
    if (!card) return;
    setPendingDiscard({
      handIndex,
      discardPileIndex: pileIndex,
      targetSlotIndex: youSlotIndex,
      cardLabel: card.value === WILD ? 'Skip-Bo (wild)' : String(card.value),
    });
  };

  const confirmPendingDiscard = () => {
    if (!pendingDiscard) return;
    dispatch({
      type: 'DISCARD',
      handIndex: pendingDiscard.handIndex,
      discardPileIndex: pendingDiscard.discardPileIndex,
      targetPlayerIndex: pendingDiscard.targetSlotIndex,
    });
    setPendingDiscard(null);
    setSelection({ kind: 'none' });
  };

  const onClickBuildPile = (buildPileIndex: number) => {
    if (!isYourTurn) return;
    const source = sourceFromSelection();
    if (!source) return;
    tryPlayToBuild(source, buildPileIndex);
  };

  const onClickOwnDiscardPile = (pileIndex: number) => {
    if (!isYourTurn) return;
    if (selection.kind !== 'hand') return;
    tryDiscard(selection.index, pileIndex);
  };

  const onDragEnd = useCallback(
    (source: DragSourceData, target: DropTargetData | null) => {
      if (!target || !isYourTurn) return;
      if (target.kind === 'build') {
        tryPlayToBuild(source.source, target.index);
        return;
      }
      if (target.kind === 'discard') {
        if (source.source.from !== 'hand') return;
        tryDiscard(source.source.index, target.index);
      }
    },
    // tryPlayToBuild/tryDiscard are redeclared each render but close over latest state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [youSlotIndex, view, isYourTurn],
  );

  // --- derived display values ---

  const selfSeat = youSeat ?? seatViewModels[0];
  const opponentSeats = seatViewModels.filter((s) => s.slotIndex !== youSlotIndex);

  const activeSeat = seatViewModels.find((s) => s.slotIndex === view.currentPlayerSlotIndex);
  const partnershipActive = !!view.config.partnership?.enabled;

  const statusText = (() => {
    if (view.phase === 'finished') {
      if (partnershipActive && view.winningTeamIndex !== null) {
        return `TEAM ${view.winningTeamIndex + 1} WINS`;
      }
      const winner = seatViewModels.find((s) => s.slotIndex === view.winningTeamIndex);
      return `${(winner?.name ?? 'Player').toUpperCase()} WINS`;
    }
    return `${activeSeat?.name ?? '…'} — pick a card, then a target`;
  })();

  return (
    <DragDropProvider onDragEnd={onDragEnd}>
      <div className="wood-frame min-h-screen p-2 sm:p-3">
        <div className="felt-surface relative rounded-xl overflow-hidden h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)]">

          {/* Header chrome */}
          <header className="absolute top-2 sm:top-3 left-3 right-3 sm:left-4 sm:right-4 z-20 flex items-center justify-between text-white gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-widest shrink-0">
              SKIP<span className="text-[var(--gold)]">·</span>BO
            </h1>

            {/* Status — desktop tabletop only */}
            <div
              className={`${useTableLayout ? 'hidden md:block' : 'hidden'} px-3 py-1 rounded-full border border-white/10 text-xs text-white/90 text-center mx-4 truncate max-w-xl`}
              style={{ background: 'rgba(0,0,0,0.45)' }}
            >
              <span className={view.phase === 'finished' ? 'text-[var(--gold)] font-bold tracking-wider' : ''}>
                {view.phase === 'finished' ? statusText : (
                  <>
                    <span className="text-[var(--gold)] font-semibold">{activeSeat?.name ?? '…'}</span>
                    {' '}— pick a card, then a target
                  </>
                )}
              </span>
            </div>
          </header>

          {/* Status ribbon — mobile or compact fallback */}
          <div className={`${useTableLayout ? 'md:hidden' : ''} absolute top-10 left-2 right-2 z-10 flex justify-center pointer-events-none`}>
            <div
              className="px-3 py-1 rounded-full border border-white/10 text-[11px] text-white backdrop-blur-sm text-center"
              style={{ background: 'rgba(0,0,0,0.45)' }}
            >
              <span className={view.phase === 'finished' ? 'text-[var(--gold)] font-bold tracking-wider' : ''}>
                {view.phase === 'finished' ? statusText : (
                  <>
                    <span className="text-[var(--gold)] font-semibold">{activeSeat?.name ?? '…'}</span>
                    {' '}— pick a card, then a target
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Desktop tabletop — 2..4 seats only; 5+ falls through to MobileBoardView */}
          {useTableLayout && (
            <div className="hidden md:contents">
              <TableCenter
                buildPiles={view.buildPiles}
                drawPileCount={view.drawPileCount}
                completedPileCount={0}
                config={view.config}
                onClickBuildPile={onClickBuildPile}
                pendingWildBuildPileIndex={pendingWildPlay?.buildPileIndex ?? null}
                onPickWildDirection={resolvePendingWild}
                onCancelWildPlay={cancelPendingWild}
              />
              {seatViewModels.map((seat, i) => (
                <SeatView
                  key={seat.slotIndex}
                  position={seatOf(i)}
                  seat={seat}
                  selection={seat.isYou ? selection : { kind: 'none' }}
                  cardSize={seatViewModels.length > 4 ? 'sm' : 'md'}
                  onSelectHand={seat.isYou && isYourTurn ? (idx) =>
                    setSelection((prev) =>
                      prev.kind === 'hand' && prev.index === idx
                        ? { kind: 'none' }
                        : { kind: 'hand', index: idx },
                    ) : undefined}
                  onSelectStock={seat.isYou && isYourTurn ? () => {
                    if ((youSeat?.stockCount ?? 0) === 0) return;
                    setSelection((prev) =>
                      prev.kind === 'stock' ? { kind: 'none' } : { kind: 'stock' },
                    );
                  } : undefined}
                  onSelectDiscard={seat.isYou && isYourTurn ? (pileIdx) => {
                    if ((youSeat?.discardPiles[pileIdx]?.length ?? 0) === 0) return;
                    setSelection((prev) =>
                      prev.kind === 'discard' && prev.pileIndex === pileIdx
                        ? { kind: 'none' }
                        : { kind: 'discard', pileIndex: pileIdx },
                    );
                  } : undefined}
                  onClickDiscardTarget={seat.isYou && isYourTurn ? onClickOwnDiscardPile : undefined}
                />
              ))}
            </div>
          )}

          {/* Compact layout — mobile always, desktop when > 4 seats */}
          <div className={useTableLayout ? 'md:hidden contents' : 'contents'}>
            {selfSeat && (
              <MobileBoardView
                self={selfSeat}
                opponents={opponentSeats}
                buildPiles={view.buildPiles}
                drawPileCount={view.drawPileCount}
                completedPileCount={0}
                config={view.config}
                selection={isYourTurn ? selection : { kind: 'none' }}
                onSelectHand={isYourTurn ? (idx) =>
                  setSelection((prev) =>
                    prev.kind === 'hand' && prev.index === idx
                      ? { kind: 'none' }
                      : { kind: 'hand', index: idx },
                  ) : () => {}}
                onSelectStock={isYourTurn ? () => {
                  if ((youSeat?.stockCount ?? 0) === 0) return;
                  setSelection((prev) =>
                    prev.kind === 'stock' ? { kind: 'none' } : { kind: 'stock' },
                  );
                } : () => {}}
                onSelectDiscard={isYourTurn ? (pileIdx) => {
                  if ((youSeat?.discardPiles[pileIdx]?.length ?? 0) === 0) return;
                  setSelection((prev) =>
                    prev.kind === 'discard' && prev.pileIndex === pileIdx
                      ? { kind: 'none' }
                      : { kind: 'discard', pileIndex: pileIdx },
                  );
                } : () => {}}
                onClickBuildPile={onClickBuildPile}
                onClickOwnDiscardPile={onClickOwnDiscardPile}
                pendingWildBuildPileIndex={pendingWildPlay?.buildPileIndex ?? null}
                onPickWildDirection={resolvePendingWild}
                onCancelWildPlay={cancelPendingWild}
              />
            )}
          </div>

          {/* Win modal */}
          <WinModal
            open={view.phase === 'finished'}
            phase={view.phase}
            endedReason={view.phase === 'finished' ? 'winner' : null}
            winningTeamIndex={view.winningTeamIndex}
            partnershipTeams={view.config.partnership?.teams ?? null}
            seats={seatViewModels}
            rematchRoomId={rematchRoomId}
            onRequestRematch={onRequestRematch}
            onBackToLobby={onBackToLobby}
          />

        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDiscard}
        title="End your turn?"
        body={
          pendingDiscard && (
            <span>
              Discard your {pendingDiscard.cardLabel} onto pile{' '}
              {pendingDiscard.discardPileIndex + 1} and pass to the next player.
            </span>
          )
        }
        confirmLabel="Discard & end turn"
        cancelLabel="Keep playing"
        destructive
        onConfirm={confirmPendingDiscard}
        onCancel={() => setPendingDiscard(null)}
      />
    </DragDropProvider>
  );
}
