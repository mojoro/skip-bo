import type { GameState, PartnershipRules } from '@engine/types';
import { createGame } from '@engine/engine';
import type { Room, FinishReason, Slot } from '../types';
import { randomUUID } from 'node:crypto';

export const IDLE_MS = 30 * 60 * 1000;
const DEFAULT_FINISH_CLEANUP_MS = 5 * 60 * 1000;
export let FINISH_CLEANUP_MS = DEFAULT_FINISH_CLEANUP_MS;

// Test-only override so rematch and cleanup flows can be exercised without
// idling the suite for 5 real minutes. Passing null restores the default.
export function __setFinishCleanupMsForTest(ms: number | null): void {
  FINISH_CLEANUP_MS = ms ?? DEFAULT_FINISH_CLEANUP_MS;
}

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
  const partnership = room.config.partnership
    ? resolvePartnership(room.config.partnership, players.map((p) => p.id))
    : null;
  return createGame({
    players,
    ruleset: room.config.ruleset,
    overrides: {
      stockPileSize: room.config.stockPileSize,
      handSize: room.config.handSize,
      bidirectionalBuild: room.config.bidirectionalBuild,
      maxPlayers: room.config.maxPlayers,
    },
    partnership,
    seed: room.config.seed,
  });
}

// Partnership teams reference engine player ids (sessionIds for humans,
// botIds for AIs). Clients cannot know every player's id at create time,
// so the stored `partnership.teams` is treated as a hint only — this
// rebuild takes the final, known player id list at startGame and pairs
// opposite seats (index i with index i + half). Pairing matches
// `buildPartnershipFromSettings` in the client's NewGameModal.
export function buildAutoPartnershipTeams(playerIds: string[]): string[][] {
  if (playerIds.length < 4 || playerIds.length % 2 !== 0) return [];
  const half = playerIds.length / 2;
  const teams: string[][] = [];
  for (let i = 0; i < half; i++) teams.push([playerIds[i]!, playerIds[i + half]!]);
  return teams;
}

function resolvePartnership(
  stored: PartnershipRules,
  playerIds: string[],
): PartnershipRules | null {
  if (!stored.enabled) return null;
  // Trust pre-built teams only when they reference the actual player id set —
  // every listed id must be a real player, and every player must appear on
  // some team. Anything short of that (empty, missing members, stale ids from
  // a prior shape) falls through to auto-pairing by slot order.
  const idSet = new Set(playerIds);
  const flat = stored.teams.flat();
  const teamsValid =
    stored.teams.length >= 2
    && stored.teams.every((team) => team.length > 0 && team.every((id) => idSet.has(id)))
    && flat.length === playerIds.length
    && new Set(flat).size === flat.length;
  if (teamsValid) return stored;
  if (playerIds.length < 4 || playerIds.length % 2 !== 0) return null;
  return { ...stored, teams: buildAutoPartnershipTeams(playerIds) };
}

export function markFinished(room: Room, _reason: FinishReason): void {
  room.phase = 'finished';
  room.finishedAt = Date.now();
}
