import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { GameConfig } from '@engine/types';
import type { Room, Visibility, FinishReason } from '../types';
import { generateRoomCode, normalizeRoomCode } from './code';
import { LobbyEventBus } from './events';
import { projectRoomInfo } from './slots';
import {
  IDLE_MS, FINISH_CLEANUP_MS,
  migrateHost, fillOpenWithAi, initializeGameState, markFinished,
} from './lifecycle';
import { clearAllGraceTimers } from '../game/grace';

export interface CreateRoomInput {
  sessionId: string;
  playerName: string;
  displayName?: string;
  config: GameConfig;
  allowAiFill: boolean;
  visibility: Visibility;
}

export interface CreateRematchRoomInput {
  sourceRoom: Room;
  seatedHumans: Array<{
    sessionId: string;
    name: string;
    slotIndex: number;
  }>;
}

export class RoomError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
  }
}

export class RoomManager {
  readonly events = new LobbyEventBus();
  // Internal lifecycle bus. Always fires regardless of visibility — the
  // lobby `roomRemoved` event only fires for public rooms, so any consumer
  // that needs to clean up regardless of visibility (game sockets, future
  // caches) should subscribe here instead.
  private readonly internalEvents = new EventEmitter();
  private readonly rooms = new Map<string, Room>();
  private readonly codeIndex = new Map<string, string>();
  private readonly sessionIndex = new Map<string, string>();
  private _allowPostDeleteEmit = false;

  onRoomClosed(handler: (roomId: string) => void): () => void {
    this.internalEvents.on('roomClosed', handler);
    return () => this.internalEvents.off('roomClosed', handler);
  }

  // Fires when a seated human is kicked out of their slot by the host via
  // setSlot (human→open / human→ai / human→locked). The WS layer subscribes
  // to close any live GameConnection the displaced session might still hold.
  // Today the handshake blocks pre-playing connections, so no socket should
  // exist at displacement time — but if the product ever opens WS during
  // waiting for lobby chat, this keeps the invariant enforced at the event
  // layer instead of by accident of routing.
  onMemberDisplaced(handler: (roomId: string, sessionId: string) => void): () => void {
    this.internalEvents.on('memberDisplaced', handler);
    return () => this.internalEvents.off('memberDisplaced', handler);
  }

  // Fires after any REST mutation visible to sockets already attached to the
  // room: addMember, removeMember, setSlot, markUpdated, and startGame.
  // Consumers (game layer) subscribe to fan-out a `state` frame to every
  // WS-connected session so their view stays live without polling. Covers
  // both waiting-phase mutations and the startGame transition — after start,
  // `buildGameView` returns a populated PlayerView and the same event drives
  // pre-game sockets into the Board.
  onRoomStateChange(handler: (roomId: string) => void): () => void {
    this.internalEvents.on('roomStateChange', handler);
    return () => this.internalEvents.off('roomStateChange', handler);
  }

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
    this.emitStateChange(room);
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
    // Host can't kick mid-game (would orphan the engine player entry and
    // stall turns); self-leave during play flips the seat to bot-controlled
    // and frees the sessionIndex so the leaver can create or join another
    // room immediately, without waiting out the 60 s grace window.
    if (room.phase === 'playing' && !selfLeave) {
      throw new RoomError('phase', 'Members cannot be removed while the game is in progress.');
    }
    const idx = room.slots.findIndex(
      (s) => s.kind === 'human' && s.sessionId === targetSessionId,
    );
    if (idx < 0) return;

    if (room.phase === 'playing') {
      // Mid-game self-leave: bot takeover so the engine keeps a valid player
      // entry at this slot. Grace timer is cancelled — the leave is
      // deliberate, not a transient disconnect.
      const current = room.slots[idx];
      if (current && current.kind === 'human') {
        if (current.graceTimer) {
          clearTimeout(current.graceTimer);
          current.graceTimer = null;
          current.graceDeadline = null;
        }
        current.connected = false;
        current.botControlled = true;
      }
      this.sessionIndex.delete(targetSessionId);
      if (targetSessionId === room.hostSessionId) {
        this.migrateHostAwayFromBot(room);
      }
      // If no live humans remain, end the game — otherwise bots would play
      // each other to completion in an empty room.
      if (this.tryEndAbandonedGame(room)) return;
      this.touch(room);
      this.emitRoomUpdated(room);
      this.emitStateChange(room);
      return;
    }

    // Waiting phase: open the slot.
    room.slots[idx] = { kind: 'open' };
    this.sessionIndex.delete(targetSessionId);
    if (!selfLeave) {
      room.kickedSessionIds.add(targetSessionId);
    }
    if (targetSessionId === room.hostSessionId) {
      const result = migrateHost(room);
      if (result === 'empty') {
        this.deleteRoom(room, { reason: 'empty' });
        return;
      }
    }
    this.touch(room);
    this.emitRoomUpdated(room);
    this.emitStateChange(room);
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
    // A host-driven swap displaces the seated human regardless of what the
    // seat becomes next. The earlier guard only cleared sessionIndex on the
    // open→ path, so a human→ai or human→locked change stranded the
    // session's mapping and blocked them from joining any other room.
    if (current.kind === 'human') {
      room.kickedSessionIds.add(current.sessionId);
      this.sessionIndex.delete(current.sessionId);
      this.internalEvents.emit('memberDisplaced', room.id, current.sessionId);
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
    this.emitStateChange(room);
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
    this.emitStateChange(room);
  }

  // Ends a playing game when no live human remains. "Live" = seated + not
  // bot-controlled; a disconnected-but-inside-grace session still counts so
  // transient flaps don't abandon the game. Returns true when the game ended.
  // Public so the game layer can call it from grace-expiry (the other path
  // where a seat flips to bot-controlled).
  tryEndAbandonedGame(room: Room): boolean {
    if (room.phase !== 'playing') return false;
    const liveHuman = room.slots.some(
      (s) => s.kind === 'human' && !s.botControlled,
    );
    if (liveHuman) return false;
    this.finishGame(room.id, 'abandoned');
    return true;
  }

  finishGame(roomId: string, reason: FinishReason): void {
    const room = this.requireRoom(roomId);
    if (room.phase !== 'playing') return;
    markFinished(room, reason);
    this.clearIdleTimer(room);
    // Grace timers outlive the game otherwise — on expiry they'd flip a
    // botControlled flag and queue a bot turn against a finished engine,
    // producing a spurious broadcast and noisy logs.
    clearAllGraceTimers(room);
    this.scheduleCleanup(room);
    this.emitRoomRemoved(room);
    // Sockets stay open past finishGame so the finished-state WinModal can
    // accept `requestRematch` messages over the same connection. They get
    // closed with 4005 when the post-game cleanup timer runs deleteRoom,
    // which fires roomClosed on its own.
  }

  createRematchRoom(input: CreateRematchRoomInput): { room: Room } {
    const { sourceRoom, seatedHumans } = input;
    const id = randomUUID();
    const code = this.allocateCode();
    const now = Date.now();

    // Build slots: clone source structure, replace each seated slot with the
    // bot-controlled human entry. Slots not named in seatedHumans keep their
    // source shape (ai / open / locked).
    const slots: Room['slots'] = sourceRoom.slots.map((slot) => {
      if (slot.kind === 'ai') return { ...slot };
      if (slot.kind === 'locked') return { kind: 'locked' as const };
      return { kind: 'open' as const };
    });
    for (const entry of seatedHumans) {
      slots[entry.slotIndex] = {
        kind: 'human',
        sessionId: entry.sessionId,
        name: entry.name,
        connected: false,
        joinedAt: now,
        graceDeadline: null,
        graceTimer: null,
        botControlled: true,
      };
    }

    const firstSeated = seatedHumans[0];
    const hostSessionId = firstSeated ? firstSeated.sessionId : '';

    // Fresh seed so the new shuffle differs from the source game.
    const config: GameConfig = {
      ...sourceRoom.config,
      seed: Math.floor(Math.random() * 0xffffffff),
    };

    const room: Room = {
      id,
      code,
      displayName: `${sourceRoom.displayName} (rematch)`,
      visibility: sourceRoom.visibility,
      phase: 'waiting',
      hostSessionId,
      config,
      allowAiFill: sourceRoom.allowAiFill,
      slots,
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
    // Atomic sessionIndex migration: retarget each seated human's mapping to the new room.
    for (const entry of seatedHumans) {
      this.sessionIndex.set(entry.sessionId, id);
    }

    // Start the game immediately.
    room.game = initializeGameState(room);
    room.phase = 'playing';

    if (room.visibility === 'public') {
      this.events.emit('roomAdded', {
        type: 'roomAdded',
        room: projectRoomInfo(room, { context: 'list' }),
      });
    }
    return { room };
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

  allRooms(): Room[] { return [...this.rooms.values()]; }

  markUpdated(room: Room): void {
    this.touch(room);
    this.emitRoomUpdated(room);
    this.emitStateChange(room);
  }

  // Hand the host role to another human when the current host is bot-
  // controlled (i.e. disconnected past grace). Spec line 235 in the Section 3
  // design doc defers to Section 4's migration rule here. Returns the new
  // hostSessionId if a migration happened, else null. No-op if the host seat
  // is still live, or no eligible non-bot human exists.
  migrateHostAwayFromBot(room: Room): string | null {
    const host = room.slots.find(
      (s): s is Extract<Room['slots'][number], { kind: 'human' }> =>
        s.kind === 'human' && s.sessionId === room.hostSessionId,
    );
    if (!host || !host.botControlled) return null;
    const eligible = room.slots
      .filter((s): s is Extract<Room['slots'][number], { kind: 'human' }> =>
        s.kind === 'human'
        && s.sessionId !== room.hostSessionId
        && !s.botControlled,
      )
      .sort((a, b) => a.joinedAt - b.joinedAt);
    const next = eligible[0];
    if (!next) return null;
    room.hostSessionId = next.sessionId;
    return next.sessionId;
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
      if (slot.kind !== 'human') continue;
      // Only delete if still pointing to this room (createRematchRoom migrates entries atomically).
      if (this.sessionIndex.get(slot.sessionId) === room.id) {
        this.sessionIndex.delete(slot.sessionId);
      }
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
    // Signal game-layer cleanup (sockets, future caches) unconditionally. The
    // lobby `roomRemoved` path below is visibility-gated; private rooms rely
    // on this channel instead.
    this.internalEvents.emit('roomClosed', room.id);
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

  private emitStateChange(room: Room): void {
    this.internalEvents.emit('roomStateChange', room.id);
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
