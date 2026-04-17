import type { GameState } from '@engine/types';
import { createGame } from '@engine/engine';
import type { Room, FinishReason, Slot } from '../types';
import { randomUUID } from 'node:crypto';

export const IDLE_MS = 30 * 60 * 1000;
export const FINISH_CLEANUP_MS = 5 * 60 * 1000;

export function migrateHost(room: Room): 'migrated' | 'empty' {
  const humans = room.slots
    .filter((s): s is Extract<Slot, { kind: 'human' }> => s.kind === 'human')
    .sort((a, b) => a.joinedAt - b.joinedAt);
  if (humans.length === 0) return 'empty';
  room.hostSessionId = humans[0]!.sessionId;
  return 'migrated';
}

export function fillOpenWithAi(room: Room): void {
  room.slots = room.slots.map((slot) =>
    slot.kind === 'open'
      ? { kind: 'ai', botId: `bot-${randomUUID().slice(0, 8)}`, difficulty: 'easy' }
      : slot,
  );
}

export function initializeGameState(room: Room): GameState {
  const players = room.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.kind === 'human' || slot.kind === 'ai')
    .map(({ slot, index }) =>
      slot.kind === 'human'
        ? { id: slot.sessionId, name: slot.name }
        : { id: (slot as Extract<Slot, { kind: 'ai' }>).botId, name: `Bot ${index + 1}` },
    );
  return createGame({
    players,
    ruleset: room.config.ruleset,
    overrides: {
      stockPileSize: room.config.stockPileSize,
      handSize: room.config.handSize,
      bidirectionalBuild: room.config.bidirectionalBuild,
      maxPlayers: room.config.maxPlayers,
    },
    partnership: room.config.partnership,
    seed: room.config.seed,
  });
}

export function markFinished(room: Room, _reason: FinishReason): void {
  room.phase = 'finished';
  room.finishedAt = Date.now();
}
