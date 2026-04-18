import type { WebSocket } from 'ws';
import type { RoomManager } from '../room/manager';
import type { Room } from '../types';
import type { GameRegistry, RegisteredConnection } from './registry';
import { ClientMessageSchema, MAX_CHAT_LEN, type ServerMessage } from './protocol';
import { dispatchMessage } from './dispatch';
import { buildGameView } from './view';
import { startGrace, cancelGrace } from './grace';
import { maybeRunBotTurn } from './bot';
import { logger } from '../logger';

const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const BACKPRESSURE_LIMIT = 256 * 1024;
const CHAT_RATE_LIMIT = { capacity: 5, refillPerMs: 5 / 10_000 };
const MSG_RATE_LIMIT = { capacity: 20, refillPerMs: 10 / 1_000 };

function takeToken(bucket: { tokens: number; lastRefill: number }, cfg: { capacity: number; refillPerMs: number }): boolean {
  const now = Date.now();
  bucket.tokens = Math.min(cfg.capacity, bucket.tokens + (now - bucket.lastRefill) * cfg.refillPerMs);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export interface GameConnectionDeps {
  ws: WebSocket;
  room: Room;
  sessionId: string;
  slotIndex: number;
  manager: RoomManager;
  registry: GameRegistry;
}

export class GameConnection implements RegisteredConnection {
  readonly sessionId: string;
  private readonly ws: WebSocket;
  private readonly room: Room;
  private readonly slotIndex: number;
  private readonly manager: RoomManager;
  private readonly registry: GameRegistry;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatDeadline: NodeJS.Timeout | null = null;
  private closed = false;
  private cleanedUp = false;
  private readonly log = logger.child({ component: 'gameWs' });
  private readonly msgBucket = { tokens: MSG_RATE_LIMIT.capacity, lastRefill: Date.now() };
  private readonly chatBucket = { tokens: CHAT_RATE_LIMIT.capacity, lastRefill: Date.now() };

  constructor(deps: GameConnectionDeps) {
    this.ws = deps.ws;
    this.room = deps.room;
    this.sessionId = deps.sessionId;
    this.slotIndex = deps.slotIndex;
    this.manager = deps.manager;
    this.registry = deps.registry;
    this.attach();
  }

  send(message: unknown): void {
    if (this.closed) return;
    if (this.ws.bufferedAmount > BACKPRESSURE_LIMIT) {
      this.log.warn({ roomId: this.room.id, sessionId: this.sessionId, buffered: this.ws.bufferedAmount }, 'backpressureKill');
      this.close(1008, 'slow consumer');
      return;
    }
    try { this.ws.send(JSON.stringify(message)); } catch { /* ignore — socket closed mid-send */ }
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try { this.ws.close(code, reason); } catch { /* ignore */ }
  }

  private attach(): void {
    const slot = this.room.slots[this.slotIndex];
    if (slot?.kind === 'human') {
      slot.connected = true;
      cancelGrace(this.room, this.slotIndex);
      if (slot.botControlled) slot.botControlled = false;
    }
    this.registry.add(this.room.id, this);
    this.log.info({ roomId: this.room.id, sessionId: this.sessionId, slotIndex: this.slotIndex }, 'attach');

    this.sendHello();
    this.broadcastState();
    this.startHeartbeat();

    this.ws.on('message', (raw) => this.handleMessage(raw));
    this.ws.on('pong', () => this.refreshHeartbeatDeadline());
    this.ws.on('close', (code, reason) => this.handleClose(code, reason.toString()));
    this.ws.on('error', (err) => { this.log.warn({ err }, 'wsError'); });
  }

  private sendHello(): void {
    if (!this.room.game) { this.close(1008, 'no game'); return; }
    const view = buildGameView(this.room, this.sessionId);
    const hello: ServerMessage = { type: 'hello', stateVersion: this.room.game.stateVersion, view };
    this.send(hello);
  }

  private broadcastState(): void {
    if (!this.room.game) return;
    const stateVersion = this.room.game.stateVersion;
    this.registry.forEachInRoom(this.room.id, (conn) => {
      try {
        const view = buildGameView(this.room, conn.sessionId);
        const msg: ServerMessage = { type: 'state', stateVersion, view };
        conn.send(msg);
      } catch (err) {
        this.log.warn({ err, sessionId: conn.sessionId }, 'buildGameView failed during broadcast');
      }
    });
  }

  private broadcastChat(chat: Extract<ServerMessage, { type: 'chat' }>): void {
    this.registry.broadcast(this.room.id, chat);
  }

  private handleMessage(raw: unknown): void {
    if (!takeToken(this.msgBucket, MSG_RATE_LIMIT)) {
      this.log.warn({ sessionId: this.sessionId }, 'rateLimit');
      this.close(1008, 'rate limit');
      return;
    }
    let text: string;
    if (typeof raw === 'string') text = raw;
    else if (raw instanceof Buffer) text = raw.toString('utf-8');
    else { this.close(1008, 'bad frame'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { this.close(1008, 'bad json'); return; }
    const check = ClientMessageSchema.safeParse(parsed);
    if (!check.success) { this.close(1008, 'bad message'); return; }
    const msg = check.data;
    if (msg.type === 'chat') {
      if (!takeToken(this.chatBucket, CHAT_RATE_LIMIT)) return;
      if (msg.text.length > MAX_CHAT_LEN) return;
    }
    const effects = dispatchMessage(this.room, this.sessionId, msg, { now: () => Date.now() });
    for (const e of effects) {
      if (e.kind === 'sendTo') {
        const conn = this.registry.findBySession(this.room.id, e.sessionId);
        if (conn) conn.send(e.message);
      } else if (e.kind === 'broadcastState') {
        this.broadcastState();
      } else if (e.kind === 'broadcastChat') {
        this.broadcastChat(e.chat);
      } else if (e.kind === 'afterCommit') {
        this.onAfterCommit();
      }
    }
  }

  private onAfterCommit(): void {
    if (this.room.game && this.room.game.phase === 'finished') {
      const stateVersion = this.room.game.stateVersion;
      this.registry.forEachInRoom(this.room.id, (conn) => {
        try {
          const view = buildGameView(this.room, conn.sessionId);
          const msg: ServerMessage = { type: 'gameEnded', stateVersion, view, reason: 'winner' };
          conn.send(msg);
        } catch { /* ignore */ }
      });
      this.manager.finishGame(this.room.id, 'winner');
      setTimeout(() => {
        this.registry.forEachInRoom(this.room.id, (conn) => conn.close(4005, 'game ended'));
      }, 150);
      return;
    }
    maybeRunBotTurn(this.room, {
      onAfterMove: () => {
        this.broadcastState();
        this.onAfterCommit();
      },
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      try { this.ws.ping(); } catch { /* ignore */ }
      if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
      this.heartbeatDeadline = setTimeout(() => {
        this.log.warn({ sessionId: this.sessionId }, 'heartbeatTimeout');
        try { this.ws.terminate(); } catch { /* ignore */ }
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_MS);
  }

  private refreshHeartbeatDeadline(): void {
    if (this.heartbeatDeadline) { clearTimeout(this.heartbeatDeadline); this.heartbeatDeadline = null; }
  }

  private handleClose(code: number, reason: string): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    this.closed = true;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.heartbeatDeadline) { clearTimeout(this.heartbeatDeadline); this.heartbeatDeadline = null; }
    this.registry.remove(this.room.id, this);
    this.log.info({ sessionId: this.sessionId, code, reason }, 'detach');

    const slot = this.room.slots[this.slotIndex];
    if (!slot || slot.kind !== 'human') return;
    slot.connected = false;

    if (this.room.phase === 'playing') {
      startGrace(this.room, this.slotIndex, {
        onExpire: () => {
          this.log.info({ sessionId: this.sessionId }, 'graceExpire');
          this.broadcastState();
          maybeRunBotTurn(this.room, {
            onAfterMove: () => { this.broadcastState(); this.onAfterCommit(); },
          });
        },
      });
    }
    this.broadcastState();
  }
}
