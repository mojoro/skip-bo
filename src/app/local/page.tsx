'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Board from '@/components/Board';
import NewGameModal, {
  NewGameSettings,
  buildPartnershipFromSettings,
  settingsToConfigOverrides,
} from '@/components/NewGameModal';
import { applyAction, createGame } from '@/lib/game/engine';
import { GameAction, GameState } from '@/lib/game/types';
import { engineStateToView } from '@/lib/view/fromEngine';

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

export default function LocalHome() {
  // Defer createGame() to the client so its Math.random() seed matches between
  // hydration passes. Server + first client render show a blank felt; an effect
  // populates the game after mount.
  const [state, setState] = useState<GameState | null>(null);
  const [newGameOpen, setNewGameOpen] = useState(false);

  useEffect(() => {
    setState((prev) => prev ?? defaultInitialGame());
  }, []);

  const { view, seats } = useMemo(() => {
    if (!state) return { view: null, seats: null };
    return engineStateToView(state, state.currentPlayerIndex);
  }, [state]);

  const dispatch = useCallback(
    (action: GameAction) => {
      setState((prev) => {
        if (!prev) return prev;
        const result = applyAction(prev, action);
        return result.ok ? result.state : prev;
      });
    },
    [],
  );

  const startGame = (settings: NewGameSettings) => {
    setState(makeGameFromSettings(settings));
    setNewGameOpen(false);
  };

  if (!state || !view || !seats) {
    return (
      <div className="wood-frame min-h-screen p-2 sm:p-3">
        <div className="felt-surface relative rounded-xl overflow-hidden h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)]" />
      </div>
    );
  }

  return (
    <div className="relative">
      {/* New Game button floats over the Board header */}
      <div className="absolute top-4 right-4 sm:top-5 sm:right-5 z-30">
        <button
          onClick={() => setNewGameOpen(true)}
          className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs whitespace-nowrap"
        >
          New Game
        </button>
      </div>

      <Board
        view={view}
        seats={seats}
        dispatch={dispatch}
        youSlotIndex={state.currentPlayerIndex}
      />

      <NewGameModal
        open={newGameOpen}
        onCancel={() => setNewGameOpen(false)}
        onStart={startGame}
        defaultPlayerCount={state.players.length}
      />
    </div>
  );
}
