import type { WebSocket } from 'ws';
import type { RoomManager } from '../room/manager';
import type { Room } from '../types';
import type { GameRegistry, RegisteredConnection } from './registry';
import { ClientMessageSchema, type ServerMessage } from './protocol';
import { dispatchMessage } from './dispatch';
import { buildGameView, buildSeats } from './view';
import { startGrace, cancelGrace } from './grace';
import { maybeRunBotTurn } from './bot';
import { logger } from '../logger';

const HEARTBEAT_MS = 25_000;
const BACKPRESSURE_LIMIT = 256 * 1024;
const CHAT_RATE_LIMIT = { capacity: 5, refillPerMs: 5 / 10_000 };
const MSG_RATE_LIMIT = { capacity: 10, refillPerMs: 5 / 1_000 };
const ERROR_RATE_LIMIT = { capacity: 3, refillPerMs: 1 / 1_000 };

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
  private isAlive = true;
  private closed = false;
  private cleanedUp = false;
  private readonly log = logger.child({ component: 'gameWs' });
  private readonly msgBucket = { tokens: MSG_RATE_LIMIT.capacity, lastRefill: Date.now() };
  private readonly chatBucket = { tokens: CHAT_RATE_LIMIT.capacity, lastRefill: Date.now() };
  private readonly errorBucket = { tokens: ERROR_RATE_LIMIT.capacity, lastRefill: Date.now() };

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
    // A peer-initiated close puts the socket in CLOSING before our handleClose
    // listener flips `this.closed`. Skipping the send here avoids a noisy
    // `sendAfterClose` error path from ws for every broadcast during that
    // window — we'd do the same cleanup when handleClose finally runs.
    if (this.ws.readyState !== this.ws.OPEN) return;
    if (this.ws.bufferedAmount > BACKPRESSURE_LIMIT) {
      this.log.warn({ roomId: this.room.id, sessionId: this.sessionId, buffered: this.ws.bufferedAmount }, 'backpressureKill');
      this.close(1008, 'slow consumer');
      return;
    }
    try {
      this.ws.send(JSON.stringify(message), (err) => {
        if (!err) return;
        this.log.warn({ err, sessionId: this.sessionId }, 'sendError');
        try { this.ws.terminate(); } catch { /* ignore */ }
      });
    } catch { /* synchronous throw — socket closed mid-send */ }
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try { this.ws.close(code, reason); } catch { /* ignore */ }
  }

  private attach(): void {
    this.ws.on('error', (err) => { this.log.warn({ err }, 'wsError'); });

    const slot = this.room.slots[this.slotIndex];
    if (slot?.kind === 'human') {
      slot.connected = true;
      cancelGrace(this.room, this.slotIndex);
      if (slot.botControlled) slot.botControlled = false;
    }
    this.registry.add(this.room.id, this);
    this.log.info({ roomId: this.room.id, sessionId: this.sessionId, slotIndex: this.slotIndex }, 'attach');

    this.sendHello();
    // Notify peers that this seat's `connected` flag flipped; the joining
    // connection already has the full state via `hello`, so exclude it to
    // avoid sending `hello` + a duplicate `state` back-to-back.
    this.broadcastState(this.sessionId);
    this.startHeartbeat();

    this.ws.on('message', (raw, isBinary) => this.handleMessage(raw, isBinary));
    this.ws.on('pong', () => { this.isAlive = true; });
    this.ws.on('close', (code, reason) => this.handleClose(code, reason.toString()));
  }

  private sendHello(): void {
    if (!this.room.game) { this.close(1008, 'no game'); return; }
    const view = buildGameView(this.room, this.sessionId);
    const hello: ServerMessage = { type: 'hello', stateVersion: this.room.game.stateVersion, view };
    this.send(hello);
  }

  private broadcastState(exceptSessionId?: string): void {
    if (!this.room.game) return;
    const stateVersion = this.room.game.stateVersion;
    const seats = buildSeats(this.room);
    this.registry.forEachInRoom(this.room.id, (conn) => {
      if (exceptSessionId && conn.sessionId === exceptSessionId) return;
      try {
        const view = buildGameView(this.room, conn.sessionId, seats);
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

  private handleMessage(raw: unknown, isBinary: boolean): void {
    if (!takeToken(this.msgBucket, MSG_RATE_LIMIT)) {
      this.log.warn({ sessionId: this.sessionId }, 'rateLimit');
      this.close(1008, 'rate limit');
      return;
    }
    if (isBinary) { this.close(1003, 'binary not supported'); return; }
    let text: string;
    if (typeof raw === 'string') text = raw;
    else if (Buffer.isBuffer(raw)) text = raw.toString('utf-8');
    else if (Array.isArray(raw)) text = Buffer.concat(raw as Buffer[]).toString('utf-8');
    else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf-8');
    else { this.close(1008, 'bad frame'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { this.close(1008, 'bad json'); return; }
    const check = ClientMessageSchema.safeParse(parsed);
    if (!check.success) { this.close(1008, 'bad message'); return; }
    const msg = check.data;
    if (msg.type === 'chat') {
      if (!takeToken(this.chatBucket, CHAT_RATE_LIMIT)) return;
    }
    const effects = dispatchMessage(this.room, this.sessionId, msg, { now: () => Date.now() });
    for (const e of effects) {
      if (e.kind === 'sendTo') {
        if (e.message.type === 'actionError' && e.sessionId === this.sessionId) {
          if (!takeToken(this.errorBucket, ERROR_RATE_LIMIT)) {
            this.log.warn({ sessionId: this.sessionId }, 'errorRateLimit');
            this.close(1008, 'too many illegal actions');
            return;
          }
        }
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
      const endSeats = buildSeats(this.room);
      this.registry.forEachInRoom(this.room.id, (conn) => {
        try {
          const view = buildGameView(this.room, conn.sessionId, endSeats);
          const msg: ServerMessage = { type: 'gameEnded', stateVersion, view, reason: 'winner' };
          conn.send(msg);
        } catch { /* ignore */ }
      });
      // finishGame synchronously emits `roomClosed`, which the index.ts
      // subscriber turns into a 4005 close on every socket in the room. The
      // ws library serializes the already-queued `gameEnded` frame before
      // the close frame, so clients receive both in order without a timer.
      this.manager.finishGame(this.room.id, 'winner');
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
      if (!this.isAlive) {
        this.log.warn({ sessionId: this.sessionId }, 'heartbeatTimeout');
        try { this.ws.terminate(); } catch { /* ignore */ }
        return;
      }
      this.isAlive = false;
      try { this.ws.ping(); } catch { /* ignore */ }
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  private handleClose(code: number, reason: string): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    this.closed = true;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.registry.remove(this.room.id, this);
    this.log.info({ sessionId: this.sessionId, code, reason }, 'detach');

    const slot = this.room.slots[this.slotIndex];
    if (!slot || slot.kind !== 'human' || slot.sessionId !== this.sessionId) return;
    // A 4004 duplicate-session kick evicts THIS connection, and the new
    // connection has already called `attach()` — flipping `connected = true`
    // and registering itself. If we ran the normal disconnect path now we'd
    // stomp the live socket's slot state: mark it offline, arm a 60s grace
    // against it, and broadcast a false "player left" frame. Checking that
    // we're still the registered owner of this sessionId lets a stale close
    // exit quietly.
    if (this.registry.findBySession(this.room.id, this.sessionId) !== undefined) return;
    slot.connected = false;

    if (this.room.phase === 'playing') {
      startGrace(this.room, this.slotIndex, {
        onExpire: () => {
          this.log.info({ sessionId: this.sessionId }, 'graceExpire');
          const newHost = this.manager.migrateHostAwayFromBot(this.room);
          if (newHost) this.log.info({ newHost, from: this.sessionId }, 'hostMigrated');
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
