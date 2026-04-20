'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import ConfirmDialog from '@/components/ConfirmDialog';
import { DragDropProvider, DragSourceData, DropTargetData } from '@/lib/dnd';
import GameChatDock from '@/components/GameChatDock';
import HowToPlay from '@/components/HowToPlay';
import { MobileBoardView } from '@/components/MobileBoard';
import OnboardingTour, { hasSeenTour } from '@/components/OnboardingTour';
import RulesetInfo from '@/components/RulesetInfo';
import { SeatView, SeatSelection } from '@/components/Seat';
import TableCenter from '@/components/TableCenter';
import WinModal, { buildWinHeadline, type WinModalAction } from '@/components/WinModal';
import { CardSource, GameAction, WILD } from '@/lib/game/types';
import { getSeatPositions } from '@/lib/layout/seating';
import type { ChatEntry, GameViewSeat, PlayerView } from '@/lib/net/protocol';
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
  // Buttons shown in the win modal after the game finishes. Callers compose
  // these — /local offers "Play again / New Game / Play online", /rooms
  // offers rematch + back-to-lobby. Empty or omitted = no buttons (dev use).
  winActions?: WinModalAction[];
  // Rendered in the top-right of the felt, on top of the tabletop. /rooms
  // drops in a "Leave game" button here; /local doesn't need one. Kept as
  // generic content so Board stays transport-agnostic.
  headerAction?: ReactNode;
  // When supplied, a floating in-game chat dock appears at the bottom-left.
  // /rooms passes both; /local leaves them undefined so no chat renders.
  chat?: ChatEntry[];
  onSendChat?: (text: string) => void;
}

export default function Board({
  view,
  seats,
  dispatch,
  youSlotIndex,
  winActions = [],
  headerAction = null,
  chat,
  onSendChat,
}: BoardProps) {
  const [selection, setSelection] = useState<SeatSelection>({ kind: 'none' });
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null);
  const [pendingWildPlay, setPendingWildPlay] = useState<PendingWildPlay | null>(null);
  const [rulesetOpen, setRulesetOpen] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  // First-visit auto-start. Only fires once Board is actually rendering the
  // felt — waiting/finished phases have no tour targets to anchor to. The
  // small delay lets the felt finish its first paint so rect measurements
  // land on the final layout, not the initial one.
  useEffect(() => {
    if (view.phase !== 'playing') return;
    if (hasSeenTour()) return;
    const id = window.setTimeout(() => setTourOpen(true), 400);
    return () => window.clearTimeout(id);
  }, [view.phase]);

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

  const statusText = (() => {
    if (view.phase === 'finished') {
      return 'Finished';
    }
    if (isYourTurn) {
      return 'Your turn';
    }
    return `${activeSeat?.name ?? '…'}'s turn`;
  })();

  return (
    <DragDropProvider onDragEnd={onDragEnd}>
      <div
        className="wood-frame h-[100dvh] flex flex-col"
        style={{
          paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
          paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
          paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
          paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
        }}
      >
        <div className="felt-surface tabletop-active relative rounded-xl overflow-hidden flex-1 min-h-0">

          {/* Header chrome */}
          <header className="absolute top-2 sm:top-3 left-3 right-3 sm:left-4 sm:right-4 z-20 flex items-center justify-between text-white gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-widest shrink-0">
              <Link
                href="/"
                className="hover:text-[var(--gold)] transition-colors"
                aria-label="Back to lobby"
              >
                SKIP<span className="text-[var(--gold)]">·</span>BO
              </Link>
            </h1>

            {/* Status — desktop tabletop only */}
            <div
              data-tour="status-desktop"
              className={`${useTableLayout ? 'hidden md:block' : 'hidden'} px-3 py-1 rounded-full border border-white/10 text-xs text-white/90 text-center mx-4 truncate max-w-xl`}
              style={{ background: 'rgba(0,0,0,0.45)' }}
            >
              <span className={view.phase === 'finished' ? 'text-[var(--gold)] font-bold tracking-wider' : ''}>
                {statusText}
              </span>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTourOpen(true)}
                className="bg-black/40 hover:bg-black/55 border border-white/15 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs text-white/90 whitespace-nowrap"
                aria-label="Replay onboarding tour"
              >
                Tour
              </button>
              <button
                type="button"
                onClick={() => setHowToPlayOpen(true)}
                className="bg-black/40 hover:bg-black/55 border border-white/15 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs text-white/90 whitespace-nowrap"
              >
                Rules
              </button>
              <button
                type="button"
                onClick={() => setRulesetOpen(true)}
                className="bg-black/40 hover:bg-black/55 border border-white/15 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs text-white/90 whitespace-nowrap"
              >
                Ruleset
              </button>
              {headerAction}
            </div>
          </header>

          {/* Status ribbon — mobile or compact fallback */}
          <div className={`${useTableLayout ? 'md:hidden' : ''} absolute top-10 left-2 right-2 z-10 flex justify-center pointer-events-none`}>
            <div
              data-tour="status-mobile"
              className="px-3 py-1 rounded-full border border-white/10 text-[11px] text-white backdrop-blur-sm text-center"
              style={{ background: 'rgba(0,0,0,0.45)' }}
            >
              <span className={view.phase === 'finished' ? 'text-[var(--gold)] font-bold tracking-wider' : ''}>
                {statusText}
              </span>
            </div>
          </div>

          {/* Desktop tabletop — 2..4 seats only; 5+ falls through to MobileBoardView */}
          {useTableLayout && (
            <div className="hidden md:contents">
              <TableCenter
                buildPiles={view.buildPiles}
                drawPileCount={view.drawPileCount}
                completedPileCount={view.completedPileCount}
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
                completedPileCount={view.completedPileCount}
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

          {chat && onSendChat && (
            <GameChatDock chat={chat} onSend={onSendChat} />
          )}

          {/* Win modal */}
          <WinModal
            open={view.phase === 'finished'}
            headline={buildWinHeadline(
              view.phase === 'finished' ? 'winner' : null,
              view.winningTeamIndex,
              view.config.partnership?.teams ?? null,
              seatViewModels,
            )}
            actions={winActions}
          />

        </div>
      </div>

      <HowToPlay open={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />

      <OnboardingTour run={tourOpen} onClose={() => setTourOpen(false)} />

      <RulesetInfo
        open={rulesetOpen}
        onClose={() => setRulesetOpen(false)}
        config={view.config}
        playerNames={[...seatViewModels]
          .sort((a, b) => a.slotIndex - b.slotIndex)
          .map((s) => s.name)}
      />

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
