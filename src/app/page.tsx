'use client';

import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { DragDropProvider, DragSourceData, DropTargetData } from '@/lib/dnd';
import NewGameModal, {
  NewGameSettings,
  buildPartnershipFromSettings,
  settingsToConfigOverrides,
} from '@/components/NewGameModal';
import MobileBoard from '@/components/MobileBoard';
import RulesetInfo from '@/components/RulesetInfo';
import Seat, { SeatSelection } from '@/components/Seat';
import TableCenter from '@/components/TableCenter';
import { applyAction, createGame } from '@/lib/game/engine';
import { Card as CardType, CardSource, GameAction, GameState, WILD } from '@/lib/game/types';
import { getSeatPositions } from '@/lib/layout/seating';

interface PendingDiscard {
  handIndex: number;
  discardPileIndex: number;
  targetPlayerIndex: number;
  cardLabel: string;
}

const TEAM_COLORS = [
  '#eab308', // amber
  '#0ea5e9', // sky
  '#ec4899', // pink
  '#84cc16', // lime
];

function makeGameFromSettings(settings: NewGameSettings): GameState {
  const players = Array.from({ length: settings.playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
  }));
  return createGame({
    players,
    ruleset: settings.ruleset,
    overrides: settingsToConfigOverrides(settings),
    partnership: buildPartnershipFromSettings(
      settings,
      players.map((p) => p.id),
    ),
  });
}

function defaultInitialGame(): GameState {
  return createGame({
    players: [
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' },
    ],
    ruleset: 'recommended',
  });
}

export default function Home() {
  // Defer createGame() to the client so its Math.random() seed matches between
  // hydration passes. Server + first client render show a blank felt; an effect
  // populates the game after mount.
  const [state, setState] = useState<GameState | null>(null);
  useEffect(() => {
    setState((prev) => prev ?? defaultInitialGame());
  }, []);

  if (!state) {
    return (
      <div className="wood-frame min-h-screen p-2 sm:p-3">
        <div className="felt-surface relative rounded-xl overflow-hidden h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)]" />
      </div>
    );
  }

  return <Board state={state} setState={setState} />;
}

interface BoardProps {
  state: GameState;
  setState: Dispatch<SetStateAction<GameState | null>>;
}

function Board({ state, setState }: BoardProps) {
  const [selection, setSelection] = useState<SeatSelection>({ kind: 'none' });
  const [message, setMessage] = useState<string>('');
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [rulesetOpen, setRulesetOpen] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null);

  const players = state.players;
  const activeIdx = state.currentPlayerIndex;
  const activePlayer = players[activeIdx];

  const seatPositions = useMemo(() => getSeatPositions(players.length), [players.length]);

  // Rotate seat geometry so the active player sits at the bottom (index 0 in layout).
  const seatOf = (playerIdx: number) => {
    const rotated = (playerIdx - activeIdx + players.length) % players.length;
    return seatPositions[rotated];
  };

  const teamForPlayerId = (id: string): number | null => {
    const teams = state.config.partnership?.teams;
    if (!teams) return null;
    for (let i = 0; i < teams.length; i++) {
      if (teams[i].includes(id)) return i;
    }
    return null;
  };

  const teamInfoForPlayerId = (id: string): { index: number | null; color: string | null } => {
    const index = teamForPlayerId(id);
    return {
      index,
      color: index !== null ? TEAM_COLORS[index % TEAM_COLORS.length] : null,
    };
  };

  const selectedCard = useMemo(() => {
    if (selection.kind === 'hand') return activePlayer.hand[selection.index] ?? null;
    if (selection.kind === 'stock') {
      return activePlayer.stockPile[activePlayer.stockPile.length - 1] ?? null;
    }
    if (selection.kind === 'discard') {
      const pile = activePlayer.discardPiles[selection.pileIndex];
      return pile[pile.length - 1] ?? null;
    }
    return null;
  }, [selection, activePlayer]);

  const sourceFromSelection = (): CardSource | null => {
    if (selection.kind === 'hand') return { from: 'hand', index: selection.index };
    if (selection.kind === 'stock') return { from: 'stock', playerIndex: activeIdx };
    if (selection.kind === 'discard') {
      return { from: 'discard', playerIndex: activeIdx, pileIndex: selection.pileIndex };
    }
    return null;
  };

  const dispatch = (action: GameAction) => {
    const result = applyAction(state, action);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setState(result.state);
    setSelection({ kind: 'none' });
    setMessage('');
  };

  const startGame = (settings: NewGameSettings) => {
    setState(makeGameFromSettings(settings));
    setSelection({ kind: 'none' });
    setMessage('');
    setNewGameOpen(false);
  };

  const resolveCardForSource = (source: CardSource): CardType | null => {
    if (source.from === 'hand') return activePlayer.hand[source.index] ?? null;
    if (source.from === 'stock') {
      const p = state.players[source.playerIndex];
      return p.stockPile[p.stockPile.length - 1] ?? null;
    }
    const p = state.players[source.playerIndex];
    const pile = p.discardPiles[source.pileIndex];
    return pile[pile.length - 1] ?? null;
  };

  const tryPlayToBuild = (source: CardSource, buildPileIndex: number) => {
    const pile = state.buildPiles[buildPileIndex];
    const isEmpty = pile.cards.length === 0;
    const card = resolveCardForSource(source);
    let declaredDirection: 'asc' | 'desc' | undefined;
    if (isEmpty && state.config.bidirectionalBuild && card?.value === WILD) {
      const goAsc = window.confirm(
        'Start ascending (from 1)?\nOK = ascending, Cancel = descending.',
      );
      declaredDirection = goAsc ? 'asc' : 'desc';
    }
    dispatch({
      type: 'PLAY_TO_BUILD',
      source,
      buildPileIndex,
      declaredDirection,
    });
  };

  const tryDiscard = (handIndex: number, pileIndex: number, targetIdx: number) => {
    const card = activePlayer.hand[handIndex];
    if (!card) return;
    setPendingDiscard({
      handIndex,
      discardPileIndex: pileIndex,
      targetPlayerIndex: targetIdx,
      cardLabel: card.value === WILD ? 'Skip-Bo (wild)' : String(card.value),
    });
  };

  const onClickBuildPile = (buildPileIndex: number) => {
    const source = sourceFromSelection();
    if (!source) {
      setMessage('select a card first');
      return;
    }
    tryPlayToBuild(source, buildPileIndex);
  };

  const onClickOwnDiscardPile = (pileIndex: number) => {
    if (selection.kind !== 'hand') {
      setMessage('select a hand card to discard');
      return;
    }
    tryDiscard(selection.index, pileIndex, activeIdx);
  };

  const onDragEnd = useCallback(
    (source: DragSourceData, target: DropTargetData | null) => {
      if (!target) return;
      if (target.kind === 'build') {
        tryPlayToBuild(source.source, target.index);
        return;
      }
      if (target.kind === 'discard') {
        if (source.source.from !== 'hand') {
          setMessage('only hand cards can be discarded');
          return;
        }
        tryDiscard(source.source.index, target.index, activeIdx);
      }
    },
    // tryPlayToBuild/tryDiscard are redeclared each render but closure over latest state
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeIdx, state],
  );


  const confirmPendingDiscard = () => {
    if (!pendingDiscard) return;
    dispatch({
      type: 'DISCARD',
      handIndex: pendingDiscard.handIndex,
      discardPileIndex: pendingDiscard.discardPileIndex,
      targetPlayerIndex: pendingDiscard.targetPlayerIndex,
    });
    setPendingDiscard(null);
  };

  const partnershipActive = !!state.config.partnership?.enabled;

  return (
    <DragDropProvider onDragEnd={onDragEnd}>
    <div className="wood-frame min-h-screen p-2 sm:p-3">
      <div className="felt-surface relative rounded-xl overflow-hidden h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)]">
        {/* Header chrome */}
        <header className="absolute top-2 sm:top-3 left-3 right-3 sm:left-4 sm:right-4 z-20 flex items-center justify-between text-white gap-2">
          <h1 className="text-base sm:text-lg font-bold tracking-widest shrink-0">
            SKIP<span className="text-[var(--gold)]">·</span>BO
          </h1>

          {/* Status — desktop only, center of header */}
          <div
            className="hidden md:block px-3 py-1 rounded-full border border-white/10 text-xs text-white/90 text-center mx-4 truncate max-w-xl"
            style={{ background: 'rgba(0,0,0,0.45)' }}
          >
            {state.phase === 'finished' ? (
              <span className="text-[var(--gold)] font-bold tracking-wider">
                {partnershipActive
                  ? `TEAM ${(state.winningTeamIndex ?? 0) + 1} WINS`
                  : `${players[state.winningTeamIndex ?? 0].name.toUpperCase()} WINS`}
              </span>
            ) : (
              <span>
                <span className="text-[var(--gold)] font-semibold">
                  {activePlayer.name}
                </span>{' '}
                — pick a card, then a target
              </span>
            )}
            {message && <span className="ml-3 text-red-300">{message}</span>}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
            <button
              onClick={() => setRulesetOpen(true)}
              className="bg-black/40 hover:bg-black/55 border border-white/15 px-2 sm:px-3 py-1 rounded flex items-center gap-1"
              title="View ruleset"
            >
              <span className="hidden sm:inline">ruleset: </span>
              <span>{state.config.ruleset}</span>
              <span className="text-[var(--gold)]">ⓘ</span>
            </button>
            {partnershipActive && (
              <span
                className="bg-black/40 border border-white/15 px-1.5 sm:px-2 py-1 rounded"
                title="Partnership mode"
              >
                <span className="hidden sm:inline">partnerships</span>
                <span className="sm:hidden">👥</span>
              </span>
            )}
            <button
              onClick={() => setNewGameOpen(true)}
              className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-2 sm:px-3 py-1 rounded whitespace-nowrap"
            >
              New Game
            </button>
          </div>
        </header>

        {/* Status ribbon — mobile only, full-width below header */}
        <div className="md:hidden absolute top-10 left-2 right-2 z-10 flex justify-center pointer-events-none">
          <div
            className="px-3 py-1 rounded-full border border-white/10 text-[11px] text-white backdrop-blur-sm text-center"
            style={{ background: 'rgba(0,0,0,0.45)' }}
          >
            {state.phase === 'finished' ? (
              <span className="text-[var(--gold)] font-bold tracking-wider">
                {partnershipActive
                  ? `TEAM ${(state.winningTeamIndex ?? 0) + 1} WINS`
                  : `${players[state.winningTeamIndex ?? 0].name.toUpperCase()} WINS`}
              </span>
            ) : (
              <span>
                <span className="text-[var(--gold)] font-semibold">
                  {activePlayer.name}
                </span>{' '}
                — pick a card, then a target
              </span>
            )}
            {message && <span className="ml-3 text-red-300">{message}</span>}
          </div>
        </div>

        {/* Desktop: absolute seats around the table center */}
        <div className="hidden md:contents">
          <TableCenter
            buildPiles={state.buildPiles}
            drawPileCount={state.drawPile.length}
            completedPileCount={state.completedBuildPiles.length}
            config={state.config}
            onClickBuildPile={onClickBuildPile}
          />
          {players.map((p, i) => {
            const isActive = i === activeIdx;
            const teamIndex = teamForPlayerId(p.id);
            const teamColor =
              teamIndex !== null ? TEAM_COLORS[teamIndex % TEAM_COLORS.length] : null;
            return (
              <Seat
                key={p.id}
                position={seatOf(i)}
                player={p}
                playerIndex={i}
                isActive={isActive}
                isYou={isActive}
                teamIndex={teamIndex}
                teamColor={teamColor}
                selection={isActive ? selection : { kind: 'none' }}
                cardSize={players.length > 4 ? 'sm' : 'md'}
                onSelectHand={(idx) =>
                  setSelection((prev) =>
                    prev.kind === 'hand' && prev.index === idx
                      ? { kind: 'none' }
                      : { kind: 'hand', index: idx },
                  )
                }
                onSelectStock={() => {
                  if (activePlayer.stockPile.length === 0) return;
                  setSelection((prev) =>
                    prev.kind === 'stock' ? { kind: 'none' } : { kind: 'stock' },
                  );
                }}
                onSelectDiscard={(pileIdx) => {
                  if (activePlayer.discardPiles[pileIdx].length === 0) return;
                  setSelection((prev) =>
                    prev.kind === 'discard' && prev.pileIndex === pileIdx
                      ? { kind: 'none' }
                      : { kind: 'discard', pileIndex: pileIdx },
                  );
                }}
                onClickDiscardTarget={onClickOwnDiscardPile}
              />
            );
          })}
        </div>

        {/* Mobile: custom compact layout — see MobileBoard component */}
        <MobileBoard
          state={state}
          activePlayer={activePlayer}
          activeIdx={activeIdx}
          selection={selection}
          teamColorFor={teamInfoForPlayerId}
          opponents={players
            .map((p, i) => ({ player: p, index: i }))
            .filter(({ index }) => index !== activeIdx)}
          onSelectHand={(idx) =>
            setSelection((prev) =>
              prev.kind === 'hand' && prev.index === idx
                ? { kind: 'none' }
                : { kind: 'hand', index: idx },
            )
          }
          onSelectStock={() => {
            if (activePlayer.stockPile.length === 0) return;
            setSelection((prev) =>
              prev.kind === 'stock' ? { kind: 'none' } : { kind: 'stock' },
            );
          }}
          onSelectDiscard={(pileIdx) => {
            if (activePlayer.discardPiles[pileIdx].length === 0) return;
            setSelection((prev) =>
              prev.kind === 'discard' && prev.pileIndex === pileIdx
                ? { kind: 'none' }
                : { kind: 'discard', pileIndex: pileIdx },
            );
          }}
          onClickBuildPile={onClickBuildPile}
          onClickOwnDiscardPile={onClickOwnDiscardPile}
        />
      </div>

      <NewGameModal
        open={newGameOpen}
        onCancel={() => setNewGameOpen(false)}
        onStart={startGame}
        defaultPlayerCount={players.length}
      />
      <RulesetInfo
        open={rulesetOpen}
        onClose={() => setRulesetOpen(false)}
        config={state.config}
        playerNames={players.map((p) => p.name)}
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
    </div>
    </DragDropProvider>
  );
}
