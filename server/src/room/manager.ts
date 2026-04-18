import { randomUUID } from 'node:crypto';
import type { GameConfig } from '@engine/types';
import type { Room, Visibility, FinishReason } from '../types';
import { generateRoomCode, normalizeRoomCode } from './code';
import { LobbyEventBus } from './events';
import { projectRoomInfo } from './slots';
import {
  IDLE_MS, FINISH_CLEANUP_MS,
  migrateHost, fillOpenWithAi, initializeGameState, markFinished,
} from './lifecycle';

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
  private _allowPostDeleteEmit = false;

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
      botPending: new Set<number>(),
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
    this.scheduleIdle(room);
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

  addMember(
    roomId: string,
    input: { sessionId: string; playerName: string },
  ): { slotIndex: number } {
    const room = this.requireRoom(roomId);
    if (room.phase !== 'waiting') {
      throw new RoomError('started', 'Room has already started.');
    }
    if (room.kickedSessionIds.has(input.sessionId)) {
      throw new RoomError('kicked', 'Session was kicked from this room.');
    }
    if (this.sessionIndex.has(input.sessionId)) {
      throw new RoomError('sessionAlreadySeated', `Session ${input.sessionId} is already seated in a room.`);
    }
    const slotIndex = room.slots.findIndex((s) => s.kind === 'open');
    if (slotIndex < 0) {
      throw new RoomError('full', 'Room is full.');
    }
    room.slots[slotIndex] = {
      kind: 'human',
      sessionId: input.sessionId,
      name: input.playerName,
      connected: false,
      joinedAt: Date.now(),
      graceDeadline: null,
      graceTimer: null,
      botControlled: false,
    };
    this.sessionIndex.set(input.sessionId, room.id);
    this.touch(room);
    this.emitRoomUpdated(room);
    return { slotIndex };
  }

  removeMember(
    roomId: string,
    targetSessionId: string,
    opts: { actorSessionId: string },
  ): void {
    const room = this.requireRoom(roomId);
    const selfLeave = opts.actorSessionId === targetSessionId;
    const isHost = opts.actorSessionId === room.hostSessionId;
    if (!selfLeave && !isHost) {
      throw new RoomError('forbidden', 'Only the target or the host may remove a member.');
    }
    const idx = room.slots.findIndex(
      (s) => s.kind === 'human' && s.sessionId === targetSessionId,
    );
    if (idx < 0) return;
    room.slots[idx] = { kind: 'open' };
    this.sessionIndex.delete(targetSessionId);
    if (!selfLeave) {
      room.kickedSessionIds.add(targetSessionId);
    }
    if (targetSessionId === room.hostSessionId) {
      const result = migrateHost(room);
      if (result === 'empty') {
        if (room.phase === 'waiting') {
          this.deleteRoom(room, { reason: 'empty' });
          return;
        }
        // playing: grace-window handling is Section 3; stub by finishing immediately.
        markFinished(room, 'abandoned');
        this.scheduleCleanup(room);
        this.emitRoomRemoved(room);
        return;
      }
    }
    this.touch(room);
    this.emitRoomUpdated(room);
  }

  setSlot(
    roomId: string,
    index: number,
    desired: { kind: 'open' | 'locked' } | { kind: 'ai'; difficulty: 'easy' },
    opts: { actorSessionId: string },
  ): void {
    const room = this.requireRoom(roomId);
    if (opts.actorSessionId !== room.hostSessionId) {
      throw new RoomError('forbidden', 'Only the host may set slots.');
    }
    if (room.phase !== 'waiting') {
      throw new RoomError('phase', 'Slots are immutable after the game starts.');
    }
    if (index < 0 || index >= room.slots.length) {
      throw new RoomError('badIndex', 'Slot index out of range.');
    }
    const current = room.slots[index];
    if (!current) {
      throw new RoomError('badIndex', 'Slot index out of range.');
    }
    if (current.kind === 'human' && current.sessionId === room.hostSessionId) {
      throw new RoomError('selfKick', 'Host cannot self-kick.');
    }
    if (current.kind === 'human' && desired.kind === 'open') {
      room.kickedSessionIds.add(current.sessionId);
      this.sessionIndex.delete(current.sessionId);
    }
    if (desired.kind === 'ai') {
      room.slots[index] = {
        kind: 'ai',
        botId: `bot-${randomUUID().slice(0, 8)}`,
        difficulty: desired.difficulty,
      };
    } else {
      room.slots[index] = { kind: desired.kind };
    }
    this.touch(room);
    this.emitRoomUpdated(room);
  }

  startGame(roomId: string, opts: { actorSessionId: string }): void {
    const room = this.requireRoom(roomId);
    if (opts.actorSessionId !== room.hostSessionId) {
      throw new RoomError('forbidden', 'Only the host may start the game.');
    }
    if (room.phase !== 'waiting') {
      throw new RoomError('phase', 'Room has already started.');
    }
    const humans = room.slots.filter((s) => s.kind === 'human').length;
    const open = room.slots.filter((s) => s.kind === 'open').length;
    if (humans < 2 && !(room.allowAiFill && humans >= 1 && humans + open >= 2)) {
      throw new RoomError('tooFew', 'tooFew: need at least two players.');
    }
    if (open > 0) {
      if (!room.allowAiFill) {
        throw new RoomError('openSlots', 'Open slots remain; enable AI fill or wait for players.');
      }
      fillOpenWithAi(room);
    }
    room.phase = 'playing';
    room.game = initializeGameState(room);
    this.touch(room);
    this.clearIdleTimer(room);
    this.emitRoomRemoved(room);
  }

  finishGame(roomId: string, reason: FinishReason): void {
    const room = this.requireRoom(roomId);
    if (room.phase !== 'playing') return;
    markFinished(room, reason);
    this.clearIdleTimer(room);
    this.scheduleCleanup(room);
    this.emitRoomRemoved(room);
  }

  stats(): { gamesInProgress: number; playersOnline: number } {
    let games = 0;
    const sessions = new Set<string>();
    for (const room of this.rooms.values()) {
      if (room.phase === 'playing') games++;
      for (const slot of room.slots) {
        if (slot.kind === 'human' && slot.connected) sessions.add(slot.sessionId);
      }
    }
    return { gamesInProgress: games, playersOnline: sessions.size };
  }

  markUpdated(room: Room): void {
    this.touch(room);
    this.emitRoomUpdated(room);
  }

  private scheduleIdle(room: Room): void {
    if (room.phase !== 'waiting') return;
    this.clearIdleTimer(room);
    room.idleTimer = setTimeout(() => {
      this.deleteRoom(room, { reason: 'idle' });
    }, IDLE_MS);
  }

  private clearIdleTimer(room: Room): void {
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
  }

  private scheduleCleanup(room: Room): void {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      this.deleteRoom(room, { reason: 'postGame' });
    }, FINISH_CLEANUP_MS);
  }

  private deleteRoom(room: Room, opts: { reason: 'idle' | 'postGame' | 'empty' }): void {
    this.rooms.delete(room.id);
    this.codeIndex.delete(room.code);
    for (const slot of room.slots) {
      if (slot.kind === 'human') this.sessionIndex.delete(slot.sessionId);
    }
    this.clearIdleTimer(room);
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    for (const slot of room.slots) {
      if (slot.kind === 'human' && slot.graceTimer) {
        clearTimeout(slot.graceTimer);
        slot.graceTimer = null;
        slot.graceDeadline = null;
      }
    }
    // postGame rooms were already removed from the lobby by finishGame — don't double-emit.
    if (opts.reason !== 'postGame') {
      this._allowPostDeleteEmit = true;
      try { this.emitRoomRemoved(room); } finally { this._allowPostDeleteEmit = false; }
    }
  }

  private emitRoomRemoved(room: Room): void {
    if (room.visibility !== 'public') return;
    if (!this.rooms.has(room.id) && !this._allowPostDeleteEmit) return;
    this.events.emit('roomRemoved', { type: 'roomRemoved', roomId: room.id });
  }

  private requireRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('notFound', `Room ${roomId} not found.`);
    return room;
  }

  private touch(room: Room): void {
    room.lastActivityAt = Date.now();
    this.scheduleIdle(room);
  }

  private emitRoomUpdated(room: Room): void {
    if (room.phase === 'waiting' && room.visibility === 'public') {
      this.events.emit('roomUpdated', {
        type: 'roomUpdated',
        room: projectRoomInfo(room, { context: 'list' }),
      });
    }
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
      connected: false,
      joinedAt: Date.now(),
      graceDeadline: null,
      graceTimer: null,
      botControlled: false,
    };
    return slots;
  }
}
