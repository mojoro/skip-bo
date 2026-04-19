import { applyAction } from '@engine/engine';
import type { Room } from '../types';
import type { ClientMessage, ServerMessage } from './protocol';
import { slotIndexForPlayerId } from './mapping';

export type DispatchEffect =
  | { kind: 'sendTo'; sessionId: string; message: ServerMessage }
  | { kind: 'broadcastState' }
  | {
      kind: 'broadcastChat';
      chat: Extract<ServerMessage, { type: 'chat' }>;
    }
  | { kind: 'afterCommit' }
  | { kind: 'createRematch'; requesterSessionId: string };

export interface DispatchDeps {
  now: () => number;
}

function sanitizeChat(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
}

export function dispatchMessage(
  room: Room,
  sessionId: string,
  msg: ClientMessage,
  deps: DispatchDeps,
): DispatchEffect[] {
  if (msg.type === 'chat') {
    const slotIndex = slotIndexForPlayerId(room, sessionId);
    if (slotIndex < 0) return [];
    const slot = room.slots[slotIndex];
    if (!slot || slot.kind !== 'human') return [];
    const clean = sanitizeChat(msg.text);
    if (clean.length === 0) return [];
    return [
      {
        kind: 'broadcastChat',
        chat: {
          type: 'chat',
          fromSlotIndex: slotIndex,
          fromName: slot.name,
          text: clean,
          sentAt: deps.now(),
        },
      },
    ];
  }

  if (msg.type === 'requestRematch') {
    const stateVersion = room.game?.stateVersion ?? 0;
    if (room.phase !== 'finished' || !room.game) {
      return [
        {
          kind: 'sendTo',
          sessionId,
          message: { type: 'actionError', reason: 'notFinished', stateVersion },
        },
      ];
    }
    return [{ kind: 'createRematch', requesterSessionId: sessionId }];
  }

  if (msg.type !== 'action') return [];

  // action
  const stateVersion = room.game?.stateVersion ?? 0;
  if (room.phase !== 'playing' || !room.game) {
    return [
      {
        kind: 'sendTo',
        sessionId,
        message: { type: 'actionError', reason: 'notPlaying', stateVersion },
      },
    ];
  }
  const current = room.game.players[room.game.currentPlayerIndex];
  if (!current || current.id !== sessionId) {
    return [
      {
        kind: 'sendTo',
        sessionId,
        message: {
          type: 'actionError',
          reason: 'notYourTurn',
          stateVersion,
        },
      },
    ];
  }
  const slotIndex = slotIndexForPlayerId(room, sessionId);
  const slot = room.slots[slotIndex];
  if (!slot || slot.kind !== 'human' || !slot.connected) {
    return [
      {
        kind: 'sendTo',
        sessionId,
        message: {
          type: 'actionError',
          reason: 'notConnected',
          stateVersion,
        },
      },
    ];
  }
  const result = applyAction(room.game, msg.action);
  if (!result.ok) {
    return [
      {
        kind: 'sendTo',
        sessionId,
        message: {
          type: 'actionError',
          reason: result.error,
          stateVersion,
        },
      },
    ];
  }
  room.game = result.state;
  return [{ kind: 'broadcastState' }, { kind: 'afterCommit' }];
}
