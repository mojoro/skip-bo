'use client';

import { useMemo, useState } from 'react';
import NewGameModal, {
  NewGameSettings,
  buildPartnershipFromSettings,
  settingsToConfigOverrides,
} from '@/components/NewGameModal';
import RulesetInfo from '@/components/RulesetInfo';
import Seat, { SeatSelection } from '@/components/Seat';
import TableCenter from '@/components/TableCenter';
import { applyAction, createGame } from '@/lib/game/engine';
import { CardSource, GameAction, GameState, WILD } from '@/lib/game/types';
import { getSeatPositions } from '@/lib/layout/seating';

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
  const [state, setState] = useState<GameState>(() => defaultInitialGame());
  const [selection, setSelection] = useState<SeatSelection>({ kind: 'none' });
  const [message, setMessage] = useState<string>('');
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [rulesetOpen, setRulesetOpen] = useState(false);

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

  const onClickBuildPile = (buildPileIndex: number) => {
    const source = sourceFromSelection();
    if (!source) {
      setMessage('select a card first');
      return;
    }
    const pile = state.buildPiles[buildPileIndex];
    const isEmpty = pile.cards.length === 0;
    let declaredDirection: 'asc' | 'desc' | undefined;
    if (isEmpty && state.config.bidirectionalBuild && selectedCard?.value === WILD) {
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

  const onClickOwnDiscardPile = (pileIndex: number) => {
    if (selection.kind !== 'hand') {
      setMessage('select a hand card to discard');
      return;
    }
    dispatch({
      type: 'DISCARD',
      handIndex: selection.index,
      discardPileIndex: pileIndex,
      targetPlayerIndex: activeIdx,
    });
  };

  const partnershipActive = !!state.config.partnership?.enabled;

  return (
    <div className="wood-frame min-h-screen p-2 sm:p-3">
      <div className="felt-surface relative rounded-xl overflow-hidden h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)]">
        {/* Header chrome */}
        <header className="absolute top-3 left-4 right-4 z-20 flex items-center justify-between text-white">
          <h1 className="text-lg font-bold tracking-widest">
            SKIP<span className="text-[var(--gold)]">·</span>BO
          </h1>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setRulesetOpen(true)}
              className="bg-black/40 hover:bg-black/55 border border-white/15 px-3 py-1 rounded flex items-center gap-1"
              title="View ruleset"
            >
              <span>ruleset: {state.config.ruleset}</span>
              <span className="text-[var(--gold)]">ⓘ</span>
            </button>
            {partnershipActive && (
              <span className="bg-black/40 border border-white/15 px-2 py-1 rounded">
                partnerships
              </span>
            )}
            <button
              onClick={() => setNewGameOpen(true)}
              className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-3 py-1 rounded"
            >
              New Game
            </button>
          </div>
        </header>

        {/* Status ribbon */}
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10">
          <div
            className="px-4 py-1.5 rounded-full border border-white/10 text-xs text-white backdrop-blur-sm"
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
            {message && (
              <span className="ml-3 text-red-300">{message}</span>
            )}
          </div>
        </div>

        {/* Central play surface */}
        <TableCenter
          buildPiles={state.buildPiles}
          drawPileCount={state.drawPile.length}
          completedPileCount={state.completedBuildPiles.length}
          config={state.config}
          onClickBuildPile={onClickBuildPile}
        />

        {/* Seats */}
        {players.map((p, i) => {
          const isActive = i === activeIdx;
          const isYou = isActive; // hot-seat: always show active player's cards
          const teamIndex = teamForPlayerId(p.id);
          const teamColor =
            teamIndex !== null ? TEAM_COLORS[teamIndex % TEAM_COLORS.length] : null;
          const position = seatOf(i);
          return (
            <Seat
              key={p.id}
              position={position}
              player={p}
              isActive={isActive}
              isYou={isYou}
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
    </div>
  );
}
