'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ActionErrorToast from '@/components/ActionErrorToast';
import Board from '@/components/Board';
import NewGameModal, {
  NewGameSettings,
  buildPartnershipFromSettings,
  settingsToConfigOverrides,
} from '@/components/NewGameModal';
import type { WinModalAction } from '@/components/WinModal';
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

export default function LocalHome() {
  const router = useRouter();
  // First visit: no game yet — the New Game modal opens immediately so the
  // user picks their settings before being dropped onto a table.
  const [state, setState] = useState<GameState | null>(null);
  const [newGameOpen, setNewGameOpen] = useState(true);
  // Remembers the last settings the user chose so "Play again" can restart
  // with identical config.
  const [lastSettings, setLastSettings] = useState<NewGameSettings | null>(null);
  // Surfaces illegal-action feedback through the same toast the online game
  // uses. Reset to a new object each rejection so ActionErrorToast retriggers.
  const [actionError, setActionError] = useState<{ reason: string } | null>(null);

  const { view, seats } = useMemo(() => {
    if (!state) return { view: null, seats: null };
    return engineStateToView(state, state.currentPlayerIndex);
  }, [state]);

  const dispatch = useCallback(
    (action: GameAction) => {
      setState((prev) => {
        if (!prev) return prev;
        const result = applyAction(prev, action);
        if (!result.ok) {
          setActionError({ reason: result.error });
          return prev;
        }
        return result.state;
      });
    },
    [],
  );

  const startGame = (settings: NewGameSettings) => {
    setLastSettings(settings);
    setState(makeGameFromSettings(settings));
    setNewGameOpen(false);
  };

  // Cancel is an escape hatch. Before the first game exists it means "I
  // changed my mind" — send them back to the lobby. Mid-game it just closes
  // the modal and keeps the current table intact.
  const handleCancel = () => {
    if (state) setNewGameOpen(false);
    else router.push('/');
  };

  const playAgain = useCallback(() => {
    if (!lastSettings) return;
    setState(makeGameFromSettings(lastSettings));
  }, [lastSettings]);

  const winActions: WinModalAction[] = useMemo(
    () => [
      { key: 'again', label: 'Play again', variant: 'primary', onClick: playAgain },
      { key: 'new', label: 'New Game', onClick: () => setNewGameOpen(true) },
      { key: 'online', label: 'Play online', href: '/' },
    ],
    [playAgain],
  );

  if (!state || !view || !seats) {
    return (
      <>
        <div className="wood-frame min-h-screen p-2 sm:p-3">
          <div className="felt-surface relative rounded-xl overflow-hidden h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)]" />
        </div>
        <NewGameModal
          open={newGameOpen}
          onCancel={handleCancel}
          onStart={startGame}
          defaultPlayerCount={2}
        />
      </>
    );
  }

  return (
    <>
      <ActionErrorToast error={actionError} />

      <Board
        view={view}
        seats={seats}
        dispatch={dispatch}
        youSlotIndex={state.currentPlayerIndex}
        winActions={winActions}
        headerAction={
          <button
            onClick={() => setNewGameOpen(true)}
            className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs whitespace-nowrap"
          >
            New Game
          </button>
        }
      />

      <NewGameModal
        open={newGameOpen}
        onCancel={handleCancel}
        onStart={startGame}
        defaultPlayerCount={state.players.length}
      />
    </>
  );
}
