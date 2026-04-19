import type { PublicRoomConfig, Room, RoomInfo, Slot } from '../types';
import { slotIndexForPlayerId } from '../game/mapping';

// Wire-safe projection of GameConfig. Mirrors `publicizeConfig` in
// `src/game/view.ts` but reachable from REST + SSE paths. Strips `seed`
// (would let any viewer reconstruct future shuffles — critical for rematch
// rooms where `seed` is pre-set) and remaps `partnership.teams` from engine
// player ids (sessionIds for humans) to slot indices (seat takeover risk).
export function publicizeRoomConfig(room: Room): PublicRoomConfig {
  const { seed: _seed, partnership, ...rest } = room.config;
  if (!partnership) return { ...rest, partnership: null };
  return {
    ...rest,
    partnership: {
      ...partnership,
      teams: partnership.teams.map((team) => team.map((id) => slotIndexForPlayerId(room, id))),
    },
  };
}

export function summarizeSlots(slots: Slot[]): RoomInfo['slotSummary'] {
  const summary = { humans: 0, ai: 0, open: 0, locked: 0, capacity: slots.length };
  for (const slot of slots) {
    if (slot.kind === 'human') summary.humans++;
    else if (slot.kind === 'ai') summary.ai++;
    else if (slot.kind === 'open') summary.open++;
    else summary.locked++;
  }
  return summary;
}

export function countHumans(slots: Slot[]): number {
  return slots.reduce((n, s) => n + (s.kind === 'human' ? 1 : 0), 0);
}

export function findOpenSlot(slots: Slot[]): number {
  return slots.findIndex((s) => s.kind === 'open');
}

export function hostDisplayName(room: Room): string {
  const host = room.slots.find(
    (s) => s.kind === 'human' && s.sessionId === room.hostSessionId,
  );
  return host && host.kind === 'human' ? host.name : 'Host';
}

export function projectRoomInfo(
  room: Room,
  opts: { context: 'list' | 'direct' },
): RoomInfo {
  const codeVisible = opts.context === 'direct' || room.visibility === 'public';
  return {
    id: room.id,
    code: codeVisible ? room.code : null,
    displayName: room.displayName,
    phase: room.phase,
    config: publicizeRoomConfig(room),
    allowAiFill: room.allowAiFill,
    visibility: room.visibility,
    slotSummary: summarizeSlots(room.slots),
    hostName: hostDisplayName(room),
    createdAt: room.createdAt,
  };
}
