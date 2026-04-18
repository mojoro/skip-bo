import type { Room } from '../types';
import type { GameAction, GameState } from '@engine/types';
import { applyAction } from '@engine/engine';
import { currentPlayerSlotIndex } from './mapping';

export const BOT_MOVE_DELAY_MS = 800;

export interface BotDeps {
  onAfterMove: () => void;
}

export function maybeRunBotTurn(room: Room, deps: BotDeps): void {
  if (room.phase !== 'playing' || !room.game) return;
  const slotIndex = currentPlayerSlotIndex(room);
  if (slotIndex < 0) return;
  const slot = room.slots[slotIndex];
  if (!slot) return;
  const isBotSeat =
    slot.kind === 'ai' ||
    (slot.kind === 'human' && slot.botControlled);
  if (!isBotSeat) return;
  if (room.botPending.has(slotIndex)) return;
  room.botPending.add(slotIndex);
  const handle = setTimeout(() => {
    room.botPending.delete(slotIndex);
    if (room.phase !== 'playing' || !room.game) return;
    if (currentPlayerSlotIndex(room) !== slotIndex) return;
    const action = pickRandomLegalAction(room.game);
    if (!action) return;
    const result = applyAction(room.game, action);
    if (!result.ok) return;
    room.game = result.state;
    deps.onAfterMove();
  }, BOT_MOVE_DELAY_MS);
  handle.unref();
}

export function pickRandomLegalAction(state: GameState): GameAction | null {
  const me = state.players[state.currentPlayerIndex];
  if (!me) return null;

  // Try PLAY_TO_BUILD from stock
  for (let bp = 0; bp < 4; bp++) {
    const action: GameAction = {
      type: 'PLAY_TO_BUILD',
      source: { from: 'stock', playerIndex: state.currentPlayerIndex },
      buildPileIndex: bp,
    };
    if (applyAction(state, action).ok) return action;
    const asc: GameAction = { ...action, declaredDirection: 'asc' };
    if (applyAction(state, asc).ok) return asc;
    const desc: GameAction = { ...action, declaredDirection: 'desc' };
    if (applyAction(state, desc).ok) return desc;
  }

  // Try PLAY_TO_BUILD from hand
  for (let h = 0; h < me.hand.length; h++) {
    for (let bp = 0; bp < 4; bp++) {
      const action: GameAction = {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: h },
        buildPileIndex: bp,
      };
      if (applyAction(state, action).ok) return action;
      const asc: GameAction = { ...action, declaredDirection: 'asc' };
      if (applyAction(state, asc).ok) return asc;
      const desc: GameAction = { ...action, declaredDirection: 'desc' };
      if (applyAction(state, desc).ok) return desc;
    }
  }

  // Try PLAY_TO_BUILD from own discards
  for (let dp = 0; dp < 4; dp++) {
    for (let bp = 0; bp < 4; bp++) {
      const action: GameAction = {
        type: 'PLAY_TO_BUILD',
        source: { from: 'discard', playerIndex: state.currentPlayerIndex, pileIndex: dp },
        buildPileIndex: bp,
      };
      if (applyAction(state, action).ok) return action;
    }
  }

  // Fallback: DISCARD first hand card to first discard pile
  if (me.hand.length > 0) {
    return {
      type: 'DISCARD',
      handIndex: 0,
      discardPileIndex: 0,
      targetPlayerIndex: state.currentPlayerIndex,
    };
  }
  return null;
}
