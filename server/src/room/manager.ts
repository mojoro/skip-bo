import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@engine/types';
import type { Room, Visibility } from '../types';
import { generateRoomCode, normalizeRoomCode } from './code';
import { LobbyEventBus } from './events';
import { projectRoomInfo } from './slots';

export interface CreateRoomInput {
  sessionId: string;
  playerName: string;
  displayName?: string;
  config: GameConfig;
  allowAiFill: boolean;
  visibility: Visibility;
}

export class RoomError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
  }
}

export class RoomManager {
  readonly events = new LobbyEventBus();
  private readonly rooms = new Map<string, Room>();
  private readonly codeIndex = new Map<string, string>();
  private readonly sessionIndex = new Map<string, string>();

  create(input: CreateRoomInput): { room: Room } {
    if (this.sessionIndex.has(input.sessionId)) {
      throw new RoomError('sessionAlreadySeated', `Session ${input.sessionId} is already seated in a room.`);
    }
    const id = randomUUID();
    const code = this.allocateCode();
    const now = Date.now();
    const room: Room = {
      id,
      code,
      displayName: input.displayName ?? `${input.playerName}'s table`,
      visibility: input.visibility,
      phase: 'waiting',
      hostSessionId: input.sessionId,
      config: input.config,
      allowAiFill: input.allowAiFill,
      slots: this.buildInitialSlots(input),
      game: null,
      createdAt: now,
      lastActivityAt: now,
      finishedAt: null,
      kickedSessionIds: new Set(),
      idleTimer: null,
      cleanupTimer: null,
    };
    this.rooms.set(id, room);
    this.codeIndex.set(code, id);
    this.sessionIndex.set(input.sessionId, id);

    if (room.visibility === 'public') {
      this.events.emit('roomAdded', {
        type: 'roomAdded',
        room: projectRoomInfo(room, { context: 'list' }),
      });
    }
    return { room };
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  findByCode(code: string): Room | undefined {
    const id = this.codeIndex.get(normalizeRoomCode(code));
    return id ? this.rooms.get(id) : undefined;
  }

  listPublicWaiting(): Room[] {
    return [...this.rooms.values()].filter(
      (r) => r.visibility === 'public' && r.phase === 'waiting',
    );
  }

  sessionRoomId(sessionId: string): string | undefined {
    return this.sessionIndex.get(sessionId);
  }

  private allocateCode(): string {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateRoomCode();
      if (!this.codeIndex.has(code)) return code;
    }
    throw new RoomError('codeExhaustion', 'Unable to allocate a unique room code.');
  }

  private buildInitialSlots(input: CreateRoomInput): Room['slots'] {
    const slots: Room['slots'] = new Array(input.config.maxPlayers).fill(null)
      .map(() => ({ kind: 'open' as const }));
    slots[0] = {
      kind: 'human',
      sessionId: input.sessionId,
      name: input.playerName,
      connected: true,
      joinedAt: Date.now(),
    };
    return slots;
  }
}
