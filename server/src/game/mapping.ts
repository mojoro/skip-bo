import type { Room } from '../types';

export function slotIndexForPlayerId(room: Room, playerId: string): number {
  return room.slots.findIndex((s) =>
    (s.kind === 'human' && s.sessionId === playerId) ||
    (s.kind === 'ai' && s.botId === playerId),
  );
}

export function playerIndexForSlotIndex(room: Room, slotIndex: number): number {
  if (!room.game) return -1;
  const slot = room.slots[slotIndex];
  if (!slot || (slot.kind !== 'human' && slot.kind !== 'ai')) return -1;
  const id = slot.kind === 'human' ? slot.sessionId : slot.botId;
  return room.game.players.findIndex((p: { id: string }) => p.id === id);
}

export function currentPlayerSlotIndex(room: Room): number {
  if (!room.game) return -1;
  const player = room.game.players[room.game.currentPlayerIndex];
  if (!player) return -1;
  return slotIndexForPlayerId(room, player.id);
}
