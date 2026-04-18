import { randomUUID } from 'node:crypto';
import type { Room } from '../src/types';
import { defaultConfigForRuleset } from '@engine/types';

export function makeRoom(overrides: Partial<Room> = {}): Room {
  const config = defaultConfigForRuleset('recommended', 4);
  config.maxPlayers = 4;
  const now = Date.now();
  const sessionId = overrides.hostSessionId ?? randomUUID();
  return {
    id: randomUUID(),
    code: 'ABCD23',
    displayName: "John's table",
    visibility: 'public',
    phase: 'waiting',
    hostSessionId: sessionId,
    config,
    allowAiFill: true,
    slots: [
      { kind: 'human', sessionId, name: 'John', connected: true, joinedAt: now, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'open' },
      { kind: 'open' },
      { kind: 'open' },
    ],
    game: null,
    createdAt: now,
    lastActivityAt: now,
    finishedAt: null,
    kickedSessionIds: new Set(),
    idleTimer: null,
    cleanupTimer: null,
    botPending: new Set<number>(),
    ...overrides,
  };
}
