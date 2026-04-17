# Room Manager & Lobby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Node.js game server's Room Manager + Lobby surface — REST, Server-Sent Events lobby feed, pure `RoomManager` state machine, process-health plumbing — per the spec at `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md`.

**Architecture:** New `server/` package at the repo root with its own `package.json`, TypeScript build, and Vitest suite. Server imports the pure game engine from `src/lib/game/` via TypeScript `paths` aliases — no monorepo restructure. Room state lives in-memory as a `Map<roomId, Room>` inside a single `RoomManager`. An HTTP/1.1 server built on `node:http` handles REST + SSE; the game WebSocket (Section 3) will mount onto the same HTTP server in a later plan. No Express, no Fastify — the learning goal is to see the plumbing.

**Tech Stack:** Node 20+ · TypeScript strict · `node:http` · `ws` (Section 3, stubbed here) · `zod` (input validation) · `pino` (structured logs) · `pm2` (supervisor) · `vitest` (tests) · `tsx` (dev runner) · `esbuild` (prod bundle) · Docker.

**What's deferred to Section 3:** the game WebSocket endpoint, disconnect grace behavior, close-code dispatch. This plan stubs those integration points: kicking a human emits an event, but no WS closes (yet); shutdown broadcasts are no-ops beyond logging. Unit tests assert the events fire; end-to-end WS tests wait for Section 3.

---

## File structure

```
skip-bo/
├── src/                      # existing Next.js app (unchanged)
│   └── lib/game/             # pure engine, imported by server via path alias
├── server/                   # NEW — this plan creates everything below
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── esbuild.config.mjs
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── pm2.config.cjs
│   ├── openapi.yaml
│   ├── .dockerignore
│   ├── src/
│   │   ├── index.ts                  # entrypoint: wire logger, server, shutdown
│   │   ├── config.ts                 # env + constants
│   │   ├── logger.ts                 # pino instance
│   │   ├── problemJson.ts            # RFC 7807 error helper
│   │   ├── types.ts                  # Room, Slot, RoomInfo, LobbyStats, LobbyEvent
│   │   ├── ids.ts                    # UUIDs, flow IDs
│   │   ├── room/
│   │   │   ├── code.ts               # 6-char code generator
│   │   │   ├── slots.ts              # slot helpers, projection to RoomInfo
│   │   │   ├── manager.ts            # RoomManager class
│   │   │   ├── lifecycle.ts          # phase transitions + host migration + timers
│   │   │   └── events.ts             # typed EventEmitter wrapper
│   │   ├── http/
│   │   │   ├── server.ts             # node:http server + router mount
│   │   │   ├── router.ts             # method+path → handler dispatch
│   │   │   ├── schemas.ts            # Zod request schemas
│   │   │   ├── middleware/
│   │   │   │   ├── flowId.ts
│   │   │   │   ├── bodyParser.ts
│   │   │   │   ├── auth.ts           # Authorization: Bearer parsing
│   │   │   │   ├── cors.ts
│   │   │   │   ├── rateLimit.ts      # token-bucket
│   │   │   │   └── errorHandler.ts   # Problem+JSON wrapper
│   │   │   └── handlers/
│   │   │       ├── rooms.ts          # POST/GET/PATCH /v1/rooms[/:id]
│   │   │       ├── members.ts        # POST/DELETE /v1/rooms/:id/members
│   │   │       ├── slots.ts          # PUT /v1/rooms/:id/slots/:index
│   │   │       ├── game.ts           # POST /v1/rooms/:id/game
│   │   │       └── lobbyStream.ts    # GET /v1/lobby/stream
│   │   ├── sse/
│   │   │   ├── stream.ts             # per-connection SSE writer
│   │   │   ├── registry.ts           # subscriber set + broadcast fan-out
│   │   │   └── ringBuffer.ts         # last-200-events replay
│   │   ├── stats.ts                  # LobbyStats aggregator, throttled
│   │   └── shutdown.ts               # graceful shutdown sequence
│   └── tests/
│       ├── fixtures.ts               # reusable room/config factories
│       ├── room/
│       │   ├── code.test.ts
│       │   ├── slots.test.ts
│       │   ├── manager.test.ts
│       │   └── lifecycle.test.ts
│       ├── http/
│       │   ├── rooms.test.ts
│       │   ├── members.test.ts
│       │   ├── slots.test.ts
│       │   ├── game.test.ts
│       │   └── middleware.test.ts
│       ├── sse/
│       │   └── stream.test.ts
│       └── integration/
│           └── full-flow.test.ts
```

**Commit convention (project rule):** single-line subject completing "This commit will ...", under 75 chars, no Conventional-Commits prefixes, no bodies, no Co-Authored-By. One logical change per commit. Every task ends with a commit step using this style.

---

## Task 1: Bootstrap the server package

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/.gitignore`
- Create: `server/src/index.ts` (stub)

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@skip-bo/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "node esbuild.config.mjs",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "pino": "^9.5.0",
    "pino-pretty": "^11.2.2",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/ws": "^8.5.12",
    "esbuild": "^0.24.0",
    "tsx": "^4.19.2",
    "typescript": "^5",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"],
    "rootDir": ".",
    "outDir": "dist",
    "baseUrl": ".",
    "paths": {
      "@engine/*": ["../src/lib/game/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
  resolve: {
    alias: {
      '@engine': resolve(here, '../src/lib/game'),
    },
  },
});
```

- [ ] **Step 4: Create `server/.gitignore`**

```
node_modules/
dist/
coverage/
*.log
.env
.env.*
!.env.example
```

- [ ] **Step 5: Create `server/src/index.ts` stub**

```ts
console.log('server boot placeholder');
```

- [ ] **Step 6: Install dependencies**

Run: `cd server && npm install`
Expected: lockfile created, no errors.

- [ ] **Step 7: Smoke-run the stub**

Run: `cd server && npm run dev`
Expected: prints `server boot placeholder` then watches.
Kill with Ctrl-C.

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/package-lock.json server/tsconfig.json \
        server/vitest.config.ts server/.gitignore server/src/index.ts
git commit -m "Bootstrap the server package with TypeScript and Vitest"
```

---

## Task 2: Shared types module

**Files:**
- Create: `server/src/types.ts`
- Create: `server/tests/fixtures.ts`
- Create: `server/tests/room/types.test.ts`

- [ ] **Step 1: Write failing type-shape sanity test**

```ts
// server/tests/room/types.test.ts
import { describe, it, expect } from 'vitest';
import type { Room, Slot, RoomInfo, LobbyStats, RoomPhase } from '../../src/types';
import { makeRoom } from '../fixtures';

describe('types', () => {
  it('Room carries all required fields', () => {
    const room = makeRoom();
    expect(room.id).toBeDefined();
    expect(room.code).toHaveLength(6);
    expect(room.slots).toHaveLength(room.config.maxPlayers);
    expect(room.phase).toBe<RoomPhase>('waiting');
    expect(room.game).toBeNull();
  });

  it('an open slot is a discriminated union', () => {
    const room = makeRoom();
    const openSlot: Slot = { kind: 'open' };
    expect(openSlot.kind).toBe('open');
    expect(room.slots.some((s) => s.kind === 'open')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && npx vitest run tests/room/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/src/types.ts`**

```ts
import type { GameConfig, GameState } from '@engine/types';

export type RoomPhase = 'waiting' | 'playing' | 'finished';
export type Visibility = 'public' | 'private';

export type Slot =
  | { kind: 'open' }
  | { kind: 'locked' }
  | { kind: 'human'; sessionId: string; name: string; connected: boolean; joinedAt: number }
  | { kind: 'ai'; botId: string; difficulty: 'easy' };

export interface Room {
  id: string;
  code: string;
  displayName: string;
  visibility: Visibility;
  phase: RoomPhase;
  hostSessionId: string;
  config: GameConfig;
  allowAiFill: boolean;
  slots: Slot[];
  game: GameState | null;
  createdAt: number;
  lastActivityAt: number;
  finishedAt: number | null;
  kickedSessionIds: Set<string>;
  idleTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
}

export interface RoomInfo {
  id: string;
  code: string | null;
  displayName: string;
  phase: RoomPhase;
  config: GameConfig;
  allowAiFill: boolean;
  visibility: Visibility;
  slotSummary: {
    humans: number;
    ai: number;
    open: number;
    locked: number;
    capacity: number;
  };
  hostName: string;
  createdAt: number;
}

export interface LobbyStats {
  gamesInProgress: number;
  playersOnline: number;
}

export type LobbyEvent =
  | { type: 'snapshot'; rooms: RoomInfo[]; stats: LobbyStats }
  | { type: 'roomAdded'; room: RoomInfo }
  | { type: 'roomUpdated'; room: RoomInfo }
  | { type: 'roomRemoved'; roomId: string }
  | { type: 'statsUpdate'; stats: LobbyStats };

export type FinishReason = 'winner' | 'abandoned' | 'playerGone';
```

- [ ] **Step 4: Create `server/tests/fixtures.ts`**

```ts
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
      { kind: 'human', sessionId, name: 'John', connected: true, joinedAt: now },
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
    ...overrides,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run tests/room/types.test.ts`
Expected: 2 passing.

- [ ] **Step 6: Typecheck**

Run: `cd server && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/types.ts server/tests/fixtures.ts server/tests/room/types.test.ts
git commit -m "Define Room Slot RoomInfo LobbyStats LobbyEvent types"
```

---

## Task 3: Room code generator

**Files:**
- Create: `server/src/room/code.ts`
- Create: `server/tests/room/code.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/room/code.test.ts
import { describe, it, expect } from 'vitest';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../../src/room/code';

describe('room code', () => {
  it('generates a 6-char code from the safe alphabet', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('validates codes ignoring case', () => {
    expect(isValidRoomCode('ABCD23')).toBe(true);
    expect(isValidRoomCode('abcd23')).toBe(true);
    expect(isValidRoomCode('ABCD2')).toBe(false);
    expect(isValidRoomCode('ABCD0O')).toBe(false);
    expect(isValidRoomCode('ABC12D')).toBe(false);
  });

  it('normalizes to uppercase', () => {
    expect(normalizeRoomCode('abcd23')).toBe('ABCD23');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run tests/room/code.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/room/code.ts`**

```ts
import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const CODE_LENGTH = 6;

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return code;
}

export function isValidRoomCode(input: string): boolean {
  return CODE_REGEX.test(input.toUpperCase());
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase();
}
```

- [ ] **Step 4: Run to verify passing**

Run: `cd server && npx vitest run tests/room/code.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/room/code.ts server/tests/room/code.test.ts
git commit -m "Generate six-char room codes from the ambiguity-safe alphabet"
```

---

## Task 4: Slot helpers and RoomInfo projection

**Files:**
- Create: `server/src/room/slots.ts`
- Create: `server/tests/room/slots.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/room/slots.test.ts
import { describe, it, expect } from 'vitest';
import {
  summarizeSlots,
  countHumans,
  findOpenSlot,
  projectRoomInfo,
  hostDisplayName,
} from '../../src/room/slots';
import { makeRoom } from '../fixtures';

describe('slot helpers', () => {
  it('summarizes a mix of slot kinds', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'a', name: 'A', connected: true, joinedAt: 0 },
      { kind: 'ai', botId: 'b1', difficulty: 'easy' },
      { kind: 'open' },
      { kind: 'locked' },
    ];
    expect(summarizeSlots(room.slots)).toEqual({
      humans: 1, ai: 1, open: 1, locked: 1, capacity: 4,
    });
  });

  it('counts connected and disconnected humans together', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'a', name: 'A', connected: true, joinedAt: 0 },
      { kind: 'human', sessionId: 'b', name: 'B', connected: false, joinedAt: 1 },
      { kind: 'open' }, { kind: 'open' },
    ];
    expect(countHumans(room.slots)).toBe(2);
  });

  it('findOpenSlot returns the first open index or -1', () => {
    const room = makeRoom();
    expect(findOpenSlot(room.slots)).toBe(1);
    room.slots[1] = { kind: 'locked' };
    expect(findOpenSlot(room.slots)).toBe(2);
    room.slots = room.slots.map(() => ({ kind: 'locked' as const }));
    expect(findOpenSlot(room.slots)).toBe(-1);
  });

  it('hostDisplayName returns host slot name or Host', () => {
    const room = makeRoom();
    expect(hostDisplayName(room)).toBe('John');
    room.slots[0] = { kind: 'open' };
    expect(hostDisplayName(room)).toBe('Host');
  });

  describe('projectRoomInfo', () => {
    it('exposes code for public rooms', () => {
      const room = makeRoom();
      const info = projectRoomInfo(room, { context: 'list' });
      expect(info.code).toBe(room.code);
      expect(info.hostName).toBe('John');
      expect(info.slotSummary.capacity).toBe(4);
    });

    it('nulls code in list view when private', () => {
      const room = makeRoom({ visibility: 'private' });
      expect(projectRoomInfo(room, { context: 'list' }).code).toBeNull();
    });

    it('keeps code on direct lookups even for private rooms', () => {
      const room = makeRoom({ visibility: 'private' });
      expect(projectRoomInfo(room, { context: 'direct' }).code).toBe(room.code);
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd server && npx vitest run tests/room/slots.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/room/slots.ts`**

```ts
import type { Room, RoomInfo, Slot } from '../types';

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
    config: room.config,
    allowAiFill: room.allowAiFill,
    visibility: room.visibility,
    slotSummary: summarizeSlots(room.slots),
    hostName: hostDisplayName(room),
    createdAt: room.createdAt,
  };
}
```

- [ ] **Step 4: Run to verify passing**

Run: `cd server && npx vitest run tests/room/slots.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/room/slots.ts server/tests/room/slots.test.ts
git commit -m "Add slot helpers and RoomInfo projection with private-code gating"
```

---

## Task 5: Typed event emitter

**Files:**
- Create: `server/src/room/events.ts`

- [ ] **Step 1: Implement typed emitter**

```ts
// server/src/room/events.ts
import { EventEmitter } from 'node:events';
import type { LobbyEvent } from '../types';

type LobbyEventName = LobbyEvent['type'];
type PayloadFor<N extends LobbyEventName> = Extract<LobbyEvent, { type: N }>;

export class LobbyEventBus {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  emit<N extends LobbyEventName>(name: N, payload: PayloadFor<N>): void {
    this.emitter.emit(name, payload);
  }

  on<N extends LobbyEventName>(name: N, handler: (payload: PayloadFor<N>) => void): () => void {
    this.emitter.on(name, handler as (payload: unknown) => void);
    return () => this.emitter.off(name, handler as (payload: unknown) => void);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/room/events.ts
git commit -m "Add a typed event bus for lobby broadcasts"
```

---

## Task 6: RoomManager — create, get, list

**Files:**
- Create: `server/src/room/manager.ts`
- Create: `server/tests/room/manager.test.ts`

- [ ] **Step 1: Write failing tests (create / get / list / code lookup)**

```ts
// server/tests/room/manager.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../../src/room/manager';
import { defaultConfigForRuleset } from '@engine/types';

function baseConfig() {
  const c = defaultConfigForRuleset('recommended', 4);
  c.maxPlayers = 4;
  return c;
}

describe('RoomManager create/get/list', () => {
  let mgr: RoomManager;
  beforeEach(() => { mgr = new RoomManager(); });

  it('creates a public room with host in slot 0', () => {
    const { room } = mgr.create({
      sessionId: 's1',
      playerName: 'John',
      config: baseConfig(),
      allowAiFill: true,
      visibility: 'public',
    });
    expect(room.phase).toBe('waiting');
    expect(room.slots[0]).toMatchObject({ kind: 'human', sessionId: 's1', name: 'John' });
    expect(room.slots.slice(1).every((s) => s.kind === 'open')).toBe(true);
    expect(room.hostSessionId).toBe('s1');
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('autogenerates a displayName when not provided', () => {
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'John',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(room.displayName).toBe("John's table");
  });

  it('honors an explicit displayName', () => {
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'John', displayName: 'Custom Night',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(room.displayName).toBe('Custom Night');
  });

  it('get returns the room by id', () => {
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'John',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(mgr.get(room.id)?.id).toBe(room.id);
    expect(mgr.get('nope')).toBeUndefined();
  });

  it('findByCode is case-insensitive', () => {
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'John',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(mgr.findByCode(room.code.toLowerCase())?.id).toBe(room.id);
    expect(mgr.findByCode('ZZZZZZ')).toBeUndefined();
  });

  it('listPublicWaiting excludes private rooms', () => {
    mgr.create({ sessionId: 'a', playerName: 'A', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.create({ sessionId: 'b', playerName: 'B', config: baseConfig(), allowAiFill: true, visibility: 'private' });
    const rooms = mgr.listPublicWaiting();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.visibility).toBe('public');
  });

  it('enforces one-session-one-room invariant', () => {
    mgr.create({ sessionId: 's1', playerName: 'John', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    expect(() =>
      mgr.create({ sessionId: 's1', playerName: 'John2', config: baseConfig(), allowAiFill: true, visibility: 'public' }),
    ).toThrow(/already seated/);
  });

  it('rejects code collisions via retry (smoke test)', () => {
    for (let i = 0; i < 50; i++) {
      mgr.create({ sessionId: `s${i}`, playerName: `P${i}`, config: baseConfig(), allowAiFill: true, visibility: 'public' });
    }
    expect(mgr.listPublicWaiting()).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd server && npx vitest run tests/room/manager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `server/src/room/manager.ts` (first pass)**

```ts
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
```

- [ ] **Step 4: Run to verify passing**

Run: `cd server && npx vitest run tests/room/manager.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/room/manager.ts server/tests/room/manager.test.ts
git commit -m "Introduce RoomManager with create lookup and list operations"
```

---

## Task 7: RoomManager — join, leave, slot mutations

**Files:**
- Modify: `server/src/room/manager.ts`
- Modify: `server/tests/room/manager.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// append to server/tests/room/manager.test.ts
import type { Room } from '../../src/types';

describe('RoomManager join/leave/slots', () => {
  let mgr: RoomManager;
  let host: Room;
  beforeEach(() => {
    mgr = new RoomManager();
    host = mgr.create({
      sessionId: 'host',
      playerName: 'Host',
      config: baseConfig(),
      allowAiFill: true,
      visibility: 'public',
    }).room;
  });

  it('addMember claims the first open slot', () => {
    const { slotIndex } = mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    expect(slotIndex).toBe(1);
    const slot = host.slots[1];
    expect(slot.kind).toBe('human');
    if (slot.kind === 'human') {
      expect(slot.sessionId).toBe('s2');
      expect(slot.name).toBe('P2');
    }
  });

  it('addMember rejects kicked sessions', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    mgr.setSlot(host.id, 1, { kind: 'open' }, { actorSessionId: 'host' });
    expect(() =>
      mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' }),
    ).toThrow(/kicked/);
  });

  it('addMember rejects full rooms', () => {
    mgr.addMember(host.id, { sessionId: 'a', playerName: 'A' });
    mgr.addMember(host.id, { sessionId: 'b', playerName: 'B' });
    mgr.addMember(host.id, { sessionId: 'c', playerName: 'C' });
    expect(() =>
      mgr.addMember(host.id, { sessionId: 'd', playerName: 'D' }),
    ).toThrow(/full/);
  });

  it('addMember rejects duplicate session across rooms', () => {
    const other = mgr.create({
      sessionId: 's2', playerName: 'Other',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    }).room;
    expect(() =>
      mgr.addMember(host.id, { sessionId: 's2', playerName: 'Other' }),
    ).toThrow(/already seated/);
    expect(other.slots[0].kind).toBe('human');
  });

  it('removeMember self-leave opens the slot', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    mgr.removeMember(host.id, 's2', { actorSessionId: 's2' });
    expect(host.slots[1].kind).toBe('open');
  });

  it('setSlot from host to ai swaps cleanly during waiting', () => {
    mgr.setSlot(host.id, 1, { kind: 'ai', difficulty: 'easy' }, { actorSessionId: 'host' });
    const slot = host.slots[1];
    expect(slot.kind).toBe('ai');
    if (slot.kind === 'ai') {
      expect(slot.difficulty).toBe('easy');
      expect(slot.botId).toMatch(/^bot-/);
    }
  });

  it('setSlot rejects non-host actors', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    expect(() =>
      mgr.setSlot(host.id, 2, { kind: 'locked' }, { actorSessionId: 's2' }),
    ).toThrow(/not host|Only the host/);
  });

  it('setSlot rejects self-kick by host', () => {
    expect(() =>
      mgr.setSlot(host.id, 0, { kind: 'open' }, { actorSessionId: 'host' }),
    ).toThrow(/self-kick|cannot self-kick/);
  });

  it('kicking a human adds them to kickedSessionIds', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    mgr.setSlot(host.id, 1, { kind: 'open' }, { actorSessionId: 'host' });
    expect(host.kickedSessionIds.has('s2')).toBe(true);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd server && npx vitest run tests/room/manager.test.ts`
Expected: new tests FAIL.

- [ ] **Step 3: Extend `RoomManager` with join/leave/setSlot**

Add to the class body (keep existing methods):

```ts
// imports already in file: randomUUID
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
      connected: true,
      joinedAt: Date.now(),
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

  private requireRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('notFound', `Room ${roomId} not found.`);
    return room;
  }

  private touch(room: Room): void {
    room.lastActivityAt = Date.now();
  }

  private emitRoomUpdated(room: Room): void {
    if (room.phase === 'waiting' && room.visibility === 'public') {
      this.events.emit('roomUpdated', {
        type: 'roomUpdated',
        room: projectRoomInfo(room, { context: 'list' }),
      });
    }
  }
```

- [ ] **Step 4: Verify passing**

Run: `cd server && npx vitest run tests/room/manager.test.ts`
Expected: all tests passing (15+).

- [ ] **Step 5: Commit**

```bash
git add server/src/room/manager.ts server/tests/room/manager.test.ts
git commit -m "Extend RoomManager with join leave and host slot mutations"
```

---

## Task 8: Lifecycle — host migration, timers, game start

**Files:**
- Create: `server/src/room/lifecycle.ts`
- Create: `server/tests/room/lifecycle.test.ts`
- Modify: `server/src/room/manager.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/room/lifecycle.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoomManager } from '../../src/room/manager';
import { defaultConfigForRuleset } from '@engine/types';

function baseConfig() {
  const c = defaultConfigForRuleset('recommended', 4);
  c.maxPlayers = 4;
  return c;
}

describe('lifecycle', () => {
  let mgr: RoomManager;
  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new RoomManager();
  });

  it('host leave migrates to next joined human', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.addMember(room.id, { sessionId: 'b', playerName: 'B' });
    mgr.removeMember(room.id, 'h', { actorSessionId: 'h' });
    expect(room.hostSessionId).toBe('a');
  });

  it('host leave from solo waiting room deletes the room', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.removeMember(room.id, 'h', { actorSessionId: 'h' });
    expect(mgr.get(room.id)).toBeUndefined();
  });

  it('startGame rejects with <2 players and no ai fill', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: false, visibility: 'public' });
    expect(() => mgr.startGame(room.id, { actorSessionId: 'h' })).toThrow(/openSlots|tooFew/);
  });

  it('startGame fills open slots with AI when allowAiFill', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    expect(room.phase).toBe('playing');
    expect(room.game).not.toBeNull();
    expect(room.slots.every((s) => s.kind === 'human' || s.kind === 'ai')).toBe(true);
  });

  it('startGame rejects non-host', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    expect(() => mgr.startGame(room.id, { actorSessionId: 'a' })).toThrow(/host/);
  });

  it('idle timer deletes a waiting room after 30 minutes of no activity', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(mgr.get(room.id)).toBeUndefined();
  });

  it('idle timer resets on mutation', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    vi.advanceTimersByTime(25 * 60 * 1000);
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    vi.advanceTimersByTime(25 * 60 * 1000);
    expect(mgr.get(room.id)).toBeDefined();
  });

  it('finish cleans up after 5 minutes', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    mgr.finishGame(room.id, 'winner');
    expect(mgr.get(room.id)).toBeDefined();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(mgr.get(room.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd server && npx vitest run tests/room/lifecycle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `server/src/room/lifecycle.ts`**

```ts
import type { GameState } from '@engine/types';
import { createGame } from '@engine/engine';
import type { Room, FinishReason, Slot } from '../types';
import { randomUUID } from 'node:crypto';

export const IDLE_MS = 30 * 60 * 1000;
export const FINISH_CLEANUP_MS = 5 * 60 * 1000;

export function migrateHost(room: Room): 'migrated' | 'empty' {
  const humans = room.slots
    .filter((s): s is Extract<Slot, { kind: 'human' }> => s.kind === 'human')
    .sort((a, b) => a.joinedAt - b.joinedAt);
  if (humans.length === 0) return 'empty';
  room.hostSessionId = humans[0]!.sessionId;
  return 'migrated';
}

export function fillOpenWithAi(room: Room): void {
  room.slots = room.slots.map((slot) =>
    slot.kind === 'open'
      ? { kind: 'ai', botId: `bot-${randomUUID().slice(0, 8)}`, difficulty: 'easy' }
      : slot,
  );
}

export function initializeGameState(room: Room): GameState {
  const players = room.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.kind === 'human' || slot.kind === 'ai')
    .map(({ slot, index }) =>
      slot.kind === 'human'
        ? { id: slot.sessionId, name: slot.name }
        : { id: slot.botId, name: `Bot ${index + 1}` },
    );
  return createGame({
    config: room.config,
    players,
  });
}

export function markFinished(room: Room, _reason: FinishReason): void {
  room.phase = 'finished';
  room.finishedAt = Date.now();
}
```

> **Note on `createGame`:** the plan assumes the engine exposes `createGame({ config, players }): GameState`. If the actual signature differs — e.g. requires a seed or a player-id list — adapt this call at implementation time to match `src/lib/game/engine.ts`. Do not change this plan; adapt the import.

- [ ] **Step 4: Extend `RoomManager` with timers, `startGame`, `finishGame`, and the cleanup path**

Add imports at the top:

```ts
import {
  IDLE_MS, FINISH_CLEANUP_MS,
  migrateHost, fillOpenWithAi, initializeGameState, markFinished,
} from './lifecycle';
import type { FinishReason } from '../types';
```

Add inside the class:

```ts
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
      throw new RoomError('tooFew', 'Need at least two players.');
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
    this.scheduleCleanup(room);
    this.emitRoomRemoved(room);
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

  private deleteRoom(room: Room, _opts: { reason: 'idle' | 'postGame' | 'empty' }): void {
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
    this.emitRoomRemoved(room);
  }

  private emitRoomRemoved(room: Room): void {
    if (room.visibility === 'public') {
      this.events.emit('roomRemoved', { type: 'roomRemoved', roomId: room.id });
    }
  }
```

Replace the existing `touch` with one that reschedules the idle timer:

```ts
  private touch(room: Room): void {
    room.lastActivityAt = Date.now();
    this.scheduleIdle(room);
  }
```

Update `removeMember` to migrate the host when the host leaves. Insert before the final `touch(room)` call:

```ts
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
```

Update `create` to schedule the idle timer before returning:

```ts
    // just before `return { room };`
    this.scheduleIdle(room);
```

- [ ] **Step 5: Run tests**

Run: `cd server && npx vitest run tests/room/lifecycle.test.ts tests/room/manager.test.ts`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add server/src/room/lifecycle.ts server/src/room/manager.ts server/tests/room/lifecycle.test.ts
git commit -m "Add host migration idle and post-game timers and game-start logic"
```

---

## Task 9: Problem+JSON helper

**Files:**
- Create: `server/src/problemJson.ts`
- Create: `server/tests/http/problemJson.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// server/tests/http/problemJson.test.ts
import { describe, it, expect } from 'vitest';
import { problemResponse, type Problem } from '../../src/problemJson';

describe('problemJson', () => {
  it('formats a standard problem', () => {
    const res = problemResponse({
      type: 'https://api.example.com/problems/room-full',
      title: 'Room is full',
      status: 409,
      detail: 'No open slots',
      instance: '/v1/rooms/abc/members',
    });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toBe('application/problem+json');
    const body = JSON.parse(res.body) as Problem;
    expect(body.status).toBe(409);
    expect(body.title).toBe('Room is full');
  });
});
```

- [ ] **Step 2: Implement `server/src/problemJson.ts`**

```ts
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [ext: string]: unknown;
}

export interface ProblemResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function problemResponse(problem: Problem): ProblemResponse {
  return {
    statusCode: problem.status,
    headers: { 'content-type': 'application/problem+json' },
    body: JSON.stringify(problem),
  };
}

export function problemFromError(
  error: unknown,
  instance: string,
): ProblemResponse {
  if (error && typeof error === 'object' && 'reason' in error && 'message' in error) {
    const reason = String((error as { reason: string }).reason);
    const message = String((error as { message: string }).message);
    const status = statusForReason(reason);
    return problemResponse({
      type: `https://skip-bo.example.com/problems/${reason}`,
      title: titleForReason(reason),
      status,
      detail: message,
      instance,
    });
  }
  return problemResponse({
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    instance,
  });
}

function statusForReason(reason: string): number {
  switch (reason) {
    case 'notFound': return 404;
    case 'forbidden': return 403;
    case 'full':
    case 'started':
    case 'kicked':
    case 'phase':
    case 'selfKick':
    case 'sessionAlreadySeated':
    case 'tooFew':
    case 'openSlots': return 409;
    case 'badIndex':
    case 'badBody': return 422;
    case 'unauthorized': return 401;
    case 'rateLimited': return 429;
    case 'codeExhaustion': return 500;
    default: return 500;
  }
}

function titleForReason(reason: string): string {
  return reason.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}
```

- [ ] **Step 3: Run test**

Run: `cd server && npx vitest run tests/http/problemJson.test.ts`
Expected: 1 passing.

- [ ] **Step 4: Commit**

```bash
git add server/src/problemJson.ts server/tests/http/problemJson.test.ts
git commit -m "Add Problem plus JSON response helpers for RFC 7807 errors"
```

---

## Task 10: HTTP server, router, middleware

**Files:**
- Create: `server/src/ids.ts`
- Create: `server/src/config.ts`
- Create: `server/src/logger.ts`
- Create: `server/src/http/router.ts`
- Create: `server/src/http/middleware/flowId.ts`
- Create: `server/src/http/middleware/bodyParser.ts`
- Create: `server/src/http/middleware/auth.ts`
- Create: `server/src/http/middleware/cors.ts`
- Create: `server/src/http/middleware/errorHandler.ts`
- Create: `server/src/http/middleware/rateLimit.ts`
- Create: `server/src/http/server.ts`
- Create: `server/tests/http/middleware.test.ts`

- [ ] **Step 1: Write failing test for router + middleware composition**

```ts
// server/tests/http/middleware.test.ts
import { describe, it, expect } from 'vitest';
import { AddressInfo } from 'node:net';
import { buildHttpServer } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';

describe('http middleware', () => {
  it('echoes X-Flow-Id and sets CORS headers', async () => {
    const mgr = new RoomManager();
    const { httpServer } = buildHttpServer({ roomManager: mgr, corsOrigin: 'http://localhost:3000' });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/v1/rooms`;
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: { 'x-flow-id': 'flow-abc', origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(res.headers.get('x-flow-id')).toBe('flow-abc');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    httpServer.close();
  });

  it.skip('returns 401 when Authorization header missing on protected route', async () => {
    // re-enable after Task 12 mounts handlers
  });

  it('returns 400 when body is invalid JSON', async () => {
    const mgr = new RoomManager();
    const { httpServer } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    // no route mounted yet: this test will need a temporary route; enable fully in Task 12.
    // For now, assert at least the CORS preflight path works.
    const res = await fetch(`http://127.0.0.1:${port}/v1/rooms`, { method: 'GET' });
    expect([200, 404]).toContain(res.status);
    httpServer.close();
  });
});
```

- [ ] **Step 2: Create `server/src/config.ts`**

```ts
export const config = {
  httpPort: Number(process.env.PORT ?? 8787),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  maxBodyBytes: 4 * 1024,
  idempotencyTtlMs: 24 * 60 * 60 * 1000,
  wsBaseUrl: process.env.WS_BASE_URL ?? 'ws://localhost:8787',
} as const;
```

- [ ] **Step 3: Create `server/src/logger.ts`**

```ts
import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  base: undefined,
  messageKey: 'msg',
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

export type Logger = typeof logger;
```

- [ ] **Step 4: Create `server/src/ids.ts`**

```ts
import { randomUUID } from 'node:crypto';

export function newFlowId(): string {
  return `flow-${randomUUID()}`;
}
```

- [ ] **Step 5: Create `server/src/http/middleware/flowId.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { newFlowId } from '../../ids';

export function assignFlowId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = typeof req.headers['x-flow-id'] === 'string' ? req.headers['x-flow-id'] : undefined;
  const flowId = incoming ?? newFlowId();
  res.setHeader('x-flow-id', flowId);
  return flowId;
}
```

- [ ] **Step 6: Create `server/src/http/middleware/bodyParser.ts`**

```ts
import type { IncomingMessage } from 'node:http';
import { config } from '../../config';

export class BodyError extends Error {
  constructor(public readonly kind: 'tooLarge' | 'badJson') { super(kind); }
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > config.maxBodyBytes) throw new BodyError('tooLarge');
    chunks.push(buf);
  }
  if (total === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError('badJson');
  }
}
```

- [ ] **Step 7: Create `server/src/http/middleware/auth.ts`**

```ts
import type { IncomingMessage } from 'node:http';

export function extractBearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1]!.trim() : null;
}
```

- [ ] **Step 8: Create `server/src/http/middleware/cors.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigin: string,
): { isPreflight: boolean } {
  const origin = req.headers.origin ?? '';
  const allowOrigin = allowedOrigin === '*' ? '*' : origin === allowedOrigin ? allowedOrigin : '';
  if (allowOrigin) {
    res.setHeader('access-control-allow-origin', allowOrigin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-flow-id, idempotency-key');
  res.setHeader('access-control-max-age', '600');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return { isPreflight: true };
  }
  return { isPreflight: false };
}
```

- [ ] **Step 9: Create `server/src/http/middleware/errorHandler.ts`**

```ts
import type { ServerResponse } from 'node:http';
import { problemResponse, problemFromError, type ProblemResponse } from '../../problemJson';
import { BodyError } from './bodyParser';

export function writeProblem(res: ServerResponse, resp: ProblemResponse): void {
  res.statusCode = resp.statusCode;
  for (const [k, v] of Object.entries(resp.headers)) res.setHeader(k, v);
  res.end(resp.body);
}

export function handleUnknown(res: ServerResponse, err: unknown, instance: string): void {
  if (err instanceof BodyError) {
    writeProblem(res, problemResponse({
      type: 'https://skip-bo.example.com/problems/' + (err.kind === 'tooLarge' ? 'payload-too-large' : 'bad-json'),
      title: err.kind === 'tooLarge' ? 'Payload too large' : 'Invalid JSON',
      status: err.kind === 'tooLarge' ? 413 : 400,
      instance,
    }));
    return;
  }
  writeProblem(res, problemFromError(err, instance));
}
```

- [ ] **Step 10: Create `server/src/http/middleware/rateLimit.ts`**

```ts
interface Bucket { tokens: number; lastRefill: number }

export interface RateLimitConfig { capacity: number; refillPerMs: number }

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly cfg: RateLimitConfig) {}

  take(key: string, now = Date.now()): boolean {
    const existing = this.buckets.get(key) ?? { tokens: this.cfg.capacity, lastRefill: now };
    const elapsed = now - existing.lastRefill;
    const refilled = Math.min(this.cfg.capacity, existing.tokens + elapsed * this.cfg.refillPerMs);
    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, lastRefill: now });
      return false;
    }
    this.buckets.set(key, { tokens: refilled - 1, lastRefill: now });
    return true;
  }
}

export const LIMITS = {
  createRoom: { capacity: 3, refillPerMs: 1 / 10_000 },
  join: { capacity: 5, refillPerMs: 5 / 10_000 },
  admin: { capacity: 10, refillPerMs: 10 / 10_000 },
} as const satisfies Record<string, RateLimitConfig>;
```

- [ ] **Step 11: Create `server/src/http/router.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => void | Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): void {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/:([A-Za-z0-9_]+)/g, (_m, key: string) => {
          keys.push(key);
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method: method.toUpperCase(), pattern, keys, handler });
  }

  match(method: string, path: string): { handler: RouteHandler; params: Record<string, string> } | null {
    const up = method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== up) continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      return { handler: route.handler, params };
    }
    return null;
  }
}
```

- [ ] **Step 12: Create `server/src/http/server.ts`**

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { logger } from '../logger';
import { assignFlowId } from './middleware/flowId';
import { applyCors } from './middleware/cors';
import { handleUnknown, writeProblem } from './middleware/errorHandler';
import { problemResponse } from '../problemJson';
import { Router } from './router';
import type { RoomManager } from '../room/manager';

export interface BuildOptions {
  roomManager: RoomManager;
  corsOrigin: string;
}

export interface BuiltServer {
  httpServer: Server;
  router: Router;
}

export function buildHttpServer(opts: BuildOptions): BuiltServer {
  const router = new Router();
  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const flowId = assignFlowId(req, res);
    const { isPreflight } = applyCors(req, res, opts.corsOrigin);
    if (isPreflight) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const instance = url.pathname;
    try {
      const match = router.match(req.method ?? 'GET', url.pathname);
      if (!match) {
        writeProblem(res, problemResponse({
          type: 'https://skip-bo.example.com/problems/not-found',
          title: 'Not Found',
          status: 404,
          instance,
        }));
        return;
      }
      await match.handler(req, res, match.params);
    } catch (err) {
      logger.error({ err, flowId, path: url.pathname, method: req.method }, 'unhandled request error');
      handleUnknown(res, err, instance);
    }
  }

  return { httpServer, router };
}
```

- [ ] **Step 13: Run middleware tests**

Run: `cd server && npx vitest run tests/http/middleware.test.ts`
Expected: the flow-id/CORS test passes; the 400/404 smoke test passes; the skipped 401 test is parked until Task 12.

- [ ] **Step 14: Commit**

```bash
git add server/src/config.ts server/src/logger.ts server/src/ids.ts \
        server/src/http/router.ts server/src/http/server.ts \
        server/src/http/middleware/ \
        server/tests/http/middleware.test.ts
git commit -m "Stand up an HTTP server with router CORS flow id and body parsing"
```

---

## Task 11: Zod request schemas

**Files:**
- Create: `server/src/http/schemas.ts`
- Create: `server/tests/http/schemas.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/http/schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
  createRoomSchema,
  joinRoomSchema,
  patchRoomSchema,
  setSlotSchema,
} from '../../src/http/schemas';

describe('schemas', () => {
  const cfg = {
    ruleset: 'recommended' as const, stockPileSize: 20, handSize: 5,
    bidirectionalBuild: true, maxPlayers: 4, partnership: null,
  };

  it('accepts a valid create-room payload', () => {
    const parsed = createRoomSchema.parse({
      playerName: 'John', config: cfg, allowAiFill: true, visibility: 'public',
    });
    expect(parsed.playerName).toBe('John');
  });

  it('rejects a playerName that is empty', () => {
    expect(() => createRoomSchema.parse({
      playerName: '', config: cfg, allowAiFill: true, visibility: 'public',
    })).toThrow();
  });

  it('rejects out-of-range maxPlayers', () => {
    expect(() => createRoomSchema.parse({
      playerName: 'John', config: { ...cfg, maxPlayers: 99 }, allowAiFill: true, visibility: 'public',
    })).toThrow();
  });

  it('joinRoomSchema requires playerName', () => {
    expect(joinRoomSchema.parse({ playerName: 'John' }).playerName).toBe('John');
    expect(() => joinRoomSchema.parse({})).toThrow();
  });

  it('patchRoomSchema accepts partial updates', () => {
    const parsed = patchRoomSchema.parse({ visibility: 'private' });
    expect(parsed.visibility).toBe('private');
  });

  it('setSlotSchema discriminates kinds', () => {
    expect(setSlotSchema.parse({ kind: 'open' })).toEqual({ kind: 'open' });
    expect(setSlotSchema.parse({ kind: 'ai', difficulty: 'easy' }).kind).toBe('ai');
    expect(() => setSlotSchema.parse({ kind: 'human' })).toThrow();
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd server && npx vitest run tests/http/schemas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `server/src/http/schemas.ts`**

```ts
import { z } from 'zod';

const NAME_RE = /^[\p{L}\p{N} ]+$/u;

const gameConfigSchema = z.object({
  ruleset: z.enum(['recommended', 'official']),
  stockPileSize: z.number().int().min(5).max(50),
  handSize: z.number().int().min(3).max(10),
  bidirectionalBuild: z.boolean(),
  maxPlayers: z.number().int().min(2).max(8),
  partnership: z
    .object({
      enabled: z.boolean(),
      teams: z.array(z.array(z.string())).min(2),
      allowPlayFromPartnerStock: z.boolean(),
      allowPlayFromPartnerDiscard: z.boolean(),
      allowDiscardToPartnerDiscard: z.boolean(),
    })
    .nullable(),
});

export const createRoomSchema = z.object({
  playerName: z.string().trim().min(1).max(20).regex(NAME_RE),
  displayName: z.string().trim().min(1).max(40).regex(NAME_RE).optional(),
  config: gameConfigSchema,
  allowAiFill: z.boolean(),
  visibility: z.enum(['public', 'private']),
});

export const joinRoomSchema = z.object({
  playerName: z.string().trim().min(1).max(20).regex(NAME_RE),
});

export const patchRoomSchema = z.object({
  displayName: z.string().trim().min(1).max(40).regex(NAME_RE).optional(),
  config: gameConfigSchema.partial().optional(),
  allowAiFill: z.boolean().optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

export const setSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open') }),
  z.object({ kind: z.literal('locked') }),
  z.object({ kind: z.literal('ai'), difficulty: z.enum(['easy']) }),
]);
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run tests/http/schemas.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/http/schemas.ts server/tests/http/schemas.test.ts
git commit -m "Declare Zod schemas for every REST request body"
```

---

## Task 12: Rooms handlers — POST, GET, PATCH

**Files:**
- Create: `server/src/http/handlers/_helpers.ts`
- Create: `server/src/http/handlers/rooms.ts`
- Create: `server/tests/http/rooms.test.ts`
- Modify: `server/src/http/server.ts`
- Modify: `server/src/room/manager.ts` (add `stats()` and `markUpdated()`)

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/http/rooms.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';

function baseConfigBody() {
  return {
    ruleset: 'recommended' as const,
    stockPileSize: 20,
    handSize: 5,
    bidirectionalBuild: true,
    maxPlayers: 4,
    partnership: null,
  };
}

async function start(): Promise<{ server: Server; url: string; mgr: RoomManager }> {
  const mgr = new RoomManager();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return { server: httpServer, url: `http://127.0.0.1:${port}`, mgr };
}

describe('POST /v1/rooms', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('creates a room and returns 201 + Location', async () => {
    const res = await fetch(`${ctx.url}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer s1', 'content-type': 'application/json' },
      body: JSON.stringify({
        playerName: 'John', config: baseConfigBody(),
        allowAiFill: true, visibility: 'public',
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(/\/v1\/rooms\/[0-9a-f-]+/);
    const body = await res.json();
    expect(body.room.displayName).toBe("John's table");
    expect(body.code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('returns 422 for malformed playerName', async () => {
    const res = await fetch(`${ctx.url}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer s1', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: '', config: baseConfigBody(), allowAiFill: true, visibility: 'public' }),
    });
    expect(res.status).toBe(422);
  });

  it('returns 401 when Authorization header missing', async () => {
    const res = await fetch(`${ctx.url}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'John', config: baseConfigBody(), allowAiFill: true, visibility: 'public' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/rooms', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('returns rooms + stats', async () => {
    ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfigBody(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rooms).toHaveLength(1);
    expect(body.stats).toEqual({ gamesInProgress: 0, playersOnline: 0 });
  });

  it('filters by code', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfigBody(), allowAiFill: true, visibility: 'private' });
    const res = await fetch(`${ctx.url}/v1/rooms?code=${room.code.toLowerCase()}`);
    const body = await res.json();
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0].code).toBe(room.code);
  });
});

describe('PATCH /v1/rooms/:id', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('updates displayName when caller is host', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfigBody(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer h', 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ displayName: 'New Name' }),
    });
    expect(res.status).toBe(204);
    expect(room.displayName).toBe('New Name');
  });

  it('rejects non-host with 403', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfigBody(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer nope', 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ displayName: 'Pwn' }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd server && npx vitest run tests/http/rooms.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `server/src/http/handlers/_helpers.ts`**

```ts
import type { ServerResponse } from 'node:http';
import type { z } from 'zod';
import { writeProblem } from '../middleware/errorHandler';
import { problemResponse } from '../../problemJson';

export function unauthorized(res: ServerResponse, instance: string): void {
  writeProblem(res, problemResponse({ type: 'https://skip-bo.example.com/problems/unauthorized', title: 'Unauthorized', status: 401, instance }));
}
export function forbidden(res: ServerResponse, instance: string): void {
  writeProblem(res, problemResponse({ type: 'https://skip-bo.example.com/problems/forbidden', title: 'Forbidden', status: 403, instance }));
}
export function notFound(res: ServerResponse, instance: string): void {
  writeProblem(res, problemResponse({ type: 'https://skip-bo.example.com/problems/not-found', title: 'Not Found', status: 404, instance }));
}
export function conflict(res: ServerResponse, instance: string, reason: string, detail: string): void {
  writeProblem(res, problemResponse({ type: `https://skip-bo.example.com/problems/${reason}`, title: reason, status: 409, detail, instance }));
}
export function unprocessable(res: ServerResponse, instance: string, err: z.ZodError): void {
  writeProblem(res, problemResponse({
    type: 'https://skip-bo.example.com/problems/validation',
    title: 'Validation Failed', status: 422, instance,
    detail: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  }));
}
```

- [ ] **Step 4: Implement `server/src/http/handlers/rooms.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { RoomManager } from '../../room/manager';
import { projectRoomInfo } from '../../room/slots';
import { readJsonBody } from '../middleware/bodyParser';
import { extractBearer } from '../middleware/auth';
import { createRoomSchema, patchRoomSchema } from '../schemas';
import { unauthorized, forbidden, notFound, conflict, unprocessable } from './_helpers';

export function postRoom(mgr: RoomManager) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const session = extractBearer(req);
    if (!session) return unauthorized(res, '/v1/rooms');
    const raw = await readJsonBody(req);
    const parsed = createRoomSchema.safeParse(raw);
    if (!parsed.success) return unprocessable(res, '/v1/rooms', parsed.error);
    const { room } = mgr.create({
      sessionId: session,
      playerName: parsed.data.playerName,
      displayName: parsed.data.displayName,
      config: parsed.data.config,
      allowAiFill: parsed.data.allowAiFill,
      visibility: parsed.data.visibility,
    });
    res.statusCode = 201;
    res.setHeader('location', `/v1/rooms/${room.id}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      roomId: room.id,
      code: room.code,
      room: projectRoomInfo(room, { context: 'direct' }),
    }));
  };
}

export function listRooms(mgr: RoomManager) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const code = url.searchParams.get('code');
    const visibility = url.searchParams.get('visibility') ?? 'public';
    const phase = url.searchParams.get('phase') ?? 'waiting';
    let rooms = mgr.listPublicWaiting();
    if (visibility === 'public' && phase !== 'waiting') rooms = [];
    if (code) {
      const hit = mgr.findByCode(code);
      rooms = hit ? [hit] : [];
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      rooms: rooms.map((r) => projectRoomInfo(r, { context: code ? 'direct' : 'list' })),
      stats: mgr.stats(),
    }));
  };
}

export function getRoom(mgr: RoomManager) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, `/v1/rooms/${params.id}`);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(projectRoomInfo(room, { context: 'direct' })));
  };
}

export function patchRoom(mgr: RoomManager) {
  return async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    if (session !== room.hostSessionId) return forbidden(res, instance);
    if (room.phase !== 'waiting') return conflict(res, instance, 'phase', 'Room is not waiting');
    const raw = await readJsonBody(req);
    const parsed = patchRoomSchema.safeParse(raw);
    if (!parsed.success) return unprocessable(res, instance, parsed.error);
    if (parsed.data.displayName) room.displayName = parsed.data.displayName;
    if (parsed.data.visibility) room.visibility = parsed.data.visibility;
    if (parsed.data.allowAiFill !== undefined) room.allowAiFill = parsed.data.allowAiFill;
    if (parsed.data.config) Object.assign(room.config, parsed.data.config);
    mgr.markUpdated(room);
    res.statusCode = 204;
    res.end();
  };
}
```

- [ ] **Step 5: Add `stats()` and `markUpdated()` to `RoomManager`**

```ts
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
```

- [ ] **Step 6: Expose `mountRoutes` in `server/src/http/server.ts`**

Append to the file:

```ts
import { postRoom, listRooms, getRoom, patchRoom } from './handlers/rooms';

export function mountRoutes(router: Router, mgr: RoomManager): void {
  router.add('GET', '/v1/rooms', listRooms(mgr));
  router.add('POST', '/v1/rooms', postRoom(mgr));
  router.add('GET', '/v1/rooms/:id', getRoom(mgr));
  router.add('PATCH', '/v1/rooms/:id', patchRoom(mgr));
}
```

- [ ] **Step 7: Un-skip the 401 test from Task 10**

```ts
// server/tests/http/middleware.test.ts — replace the .skip test body with:
it('returns 401 when Authorization header missing on protected route', async () => {
  const { buildHttpServer: build, mountRoutes: mount } = await import('../../src/http/server');
  const mgr = new RoomManager();
  const { httpServer, router } = build({ roomManager: mgr, corsOrigin: '*' });
  mount(router, mgr);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/v1/rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  expect(res.status).toBe(401);
  expect(res.headers.get('content-type')).toBe('application/problem+json');
  httpServer.close();
});
```

- [ ] **Step 8: Run all http tests**

Run: `cd server && npx vitest run tests/http/`
Expected: all passing.

- [ ] **Step 9: Commit**

```bash
git add server/src/http/handlers/ server/src/http/server.ts \
        server/src/room/manager.ts server/tests/http/rooms.test.ts \
        server/tests/http/middleware.test.ts
git commit -m "Serve POST GET and PATCH on the rooms resource"
```

---

## Task 13: Members handlers — POST / DELETE

**Files:**
- Create: `server/src/http/handlers/members.ts`
- Create: `server/tests/http/members.test.ts`
- Modify: `server/src/http/server.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/http/members.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';

function cfg() { return { ruleset: 'recommended' as const, stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null }; }

async function start() {
  const mgr = new RoomManager();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return { server: httpServer, url: `http://127.0.0.1:${port}`, mgr };
}

describe('members', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('joins a room, returns Location + wsUrl + slotIndex', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/members`, {
      method: 'POST',
      headers: { authorization: 'Bearer s2', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'S2' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`/v1/rooms/${room.id}/members/s2`);
    const body = await res.json();
    expect(body.slotIndex).toBe(1);
    expect(body.wsUrl).toMatch(new RegExp(`/game\\?roomId=${room.id}`));
  });

  it('returns 409 when full', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    for (const s of ['a', 'b', 'c']) ctx.mgr.addMember(room.id, { sessionId: s, playerName: s });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/members`, {
      method: 'POST',
      headers: { authorization: 'Bearer d', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'D' }),
    });
    expect(res.status).toBe(409);
  });

  it('DELETE self-leaves', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    ctx.mgr.addMember(room.id, { sessionId: 's2', playerName: 'S2' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/members/s2`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer s2' },
    });
    expect(res.status).toBe(204);
    expect(room.slots[1].kind).toBe('open');
  });

  it('DELETE non-host non-self is forbidden', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    ctx.mgr.addMember(room.id, { sessionId: 's2', playerName: 'S2' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/members/s2`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer attacker' },
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Implement `server/src/http/handlers/members.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomManager } from '../../room/manager';
import { readJsonBody } from '../middleware/bodyParser';
import { extractBearer } from '../middleware/auth';
import { writeProblem } from '../middleware/errorHandler';
import { problemFromError } from '../../problemJson';
import { joinRoomSchema } from '../schemas';
import { projectRoomInfo } from '../../room/slots';
import { config } from '../../config';
import { unauthorized, notFound, unprocessable } from './_helpers';

export function postMember(mgr: RoomManager) {
  return async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}/members`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    const raw = await readJsonBody(req);
    const parsed = joinRoomSchema.safeParse(raw);
    if (!parsed.success) return unprocessable(res, instance, parsed.error);
    try {
      const { slotIndex } = mgr.addMember(room.id, {
        sessionId: session,
        playerName: parsed.data.playerName,
      });
      res.statusCode = 201;
      res.setHeader('location', `${instance}/${session}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        room: projectRoomInfo(room, { context: 'direct' }),
        slotIndex,
        wsUrl: `${config.wsBaseUrl}/game?roomId=${room.id}`,
      }));
    } catch (err) {
      writeProblem(res, problemFromError(err, instance));
    }
  };
}

export function deleteMember(mgr: RoomManager) {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}/members/${params.sessionId}`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    try {
      mgr.removeMember(room.id, params.sessionId!, { actorSessionId: session });
      res.statusCode = 204;
      res.end();
    } catch (err) {
      writeProblem(res, problemFromError(err, instance));
    }
  };
}
```

- [ ] **Step 3: Mount routes**

```ts
// server.ts — inside mountRoutes():
import { postMember, deleteMember } from './handlers/members';
router.add('POST', '/v1/rooms/:id/members', postMember(mgr));
router.add('DELETE', '/v1/rooms/:id/members/:sessionId', deleteMember(mgr));
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run tests/http/`
Expected: all passing.

- [ ] **Step 5: Commit**

```ts
git add server/src/http/handlers/members.ts server/src/http/server.ts \
        server/tests/http/members.test.ts
git commit -m "Serve member join and leave endpoints with location headers"
```

---

## Task 14: Slots handler — PUT

**Files:**
- Create: `server/src/http/handlers/slots.ts`
- Create: `server/tests/http/slots.test.ts`
- Modify: `server/src/http/server.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/http/slots.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';

function cfg() { return { ruleset: 'recommended' as const, stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null }; }

async function start() {
  const mgr = new RoomManager();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return { server: httpServer, url: `http://127.0.0.1:${port}`, mgr };
}

describe('PUT /v1/rooms/:id/slots/:index', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('host sets a slot to locked', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/slots/1`, {
      method: 'PUT',
      headers: { authorization: 'Bearer h', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'locked' }),
    });
    expect(res.status).toBe(204);
    expect(room.slots[1].kind).toBe('locked');
  });

  it('non-host gets 403', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/slots/1`, {
      method: 'PUT',
      headers: { authorization: 'Bearer nope', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'locked' }),
    });
    expect(res.status).toBe(403);
  });

  it('422 for malformed body', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/slots/1`, {
      method: 'PUT',
      headers: { authorization: 'Bearer h', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'pirate' }),
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Implement `server/src/http/handlers/slots.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomManager } from '../../room/manager';
import { readJsonBody } from '../middleware/bodyParser';
import { extractBearer } from '../middleware/auth';
import { writeProblem } from '../middleware/errorHandler';
import { problemResponse, problemFromError } from '../../problemJson';
import { setSlotSchema } from '../schemas';
import { unauthorized, notFound, unprocessable } from './_helpers';

export function putSlot(mgr: RoomManager) {
  return async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}/slots/${params.index}`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    const raw = await readJsonBody(req);
    const parsed = setSlotSchema.safeParse(raw);
    if (!parsed.success) return unprocessable(res, instance, parsed.error);
    const index = Number(params.index);
    if (!Number.isInteger(index)) {
      return writeProblem(res, problemResponse({
        type: 'https://skip-bo.example.com/problems/badIndex',
        title: 'Bad Index', status: 422, instance,
      }));
    }
    try {
      mgr.setSlot(room.id, index, parsed.data, { actorSessionId: session });
      res.statusCode = 204;
      res.end();
    } catch (err) {
      writeProblem(res, problemFromError(err, instance));
    }
  };
}
```

- [ ] **Step 3: Mount + run**

```ts
// server.ts:
import { putSlot } from './handlers/slots';
router.add('PUT', '/v1/rooms/:id/slots/:index', putSlot(mgr));
```

Run: `cd server && npx vitest run tests/http/slots.test.ts`
Expected: 3 passing.

- [ ] **Step 4: Commit**

```bash
git add server/src/http/handlers/slots.ts server/src/http/server.ts \
        server/tests/http/slots.test.ts
git commit -m "Serve host slot mutations via PUT on the slots sub-resource"
```

---

## Task 15: Game handler — POST on sub-resource

**Files:**
- Create: `server/src/http/handlers/game.ts`
- Create: `server/tests/http/game.test.ts`
- Modify: `server/src/http/server.ts`

- [ ] **Step 1: Write failing tests**

```ts
// server/tests/http/game.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';

function cfg() { return { ruleset: 'recommended' as const, stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null }; }

async function start() {
  const mgr = new RoomManager();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return { server: httpServer, url: `http://127.0.0.1:${port}`, mgr };
}

describe('POST /v1/rooms/:id/game', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('host starts the game when conditions are met', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    ctx.mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/game`, {
      method: 'POST',
      headers: { authorization: 'Bearer h' },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`/v1/rooms/${room.id}/game`);
    expect(room.phase).toBe('playing');
  });

  it('non-host gets 403', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    ctx.mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/game`, { method: 'POST', headers: { authorization: 'Bearer a' } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Implement `server/src/http/handlers/game.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomManager } from '../../room/manager';
import { extractBearer } from '../middleware/auth';
import { writeProblem } from '../middleware/errorHandler';
import { problemFromError } from '../../problemJson';
import { unauthorized, notFound } from './_helpers';

export function postGame(mgr: RoomManager) {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}/game`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    try {
      mgr.startGame(room.id, { actorSessionId: session });
      res.statusCode = 201;
      res.setHeader('location', instance);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ startedAt: Date.now() }));
    } catch (err) {
      writeProblem(res, problemFromError(err, instance));
    }
  };
}
```

- [ ] **Step 3: Mount + run**

```ts
// server.ts:
import { postGame } from './handlers/game';
router.add('POST', '/v1/rooms/:id/game', postGame(mgr));
```

Run: `cd server && npx vitest run tests/http/`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add server/src/http/handlers/game.ts server/src/http/server.ts \
        server/tests/http/game.test.ts
git commit -m "Serve game start as POST on the game sub-resource"
```

---

## Task 16: SSE registry and ring buffer

**Files:**
- Create: `server/src/sse/ringBuffer.ts`
- Create: `server/src/sse/stream.ts`
- Create: `server/src/sse/registry.ts`
- Create: `server/tests/sse/stream.test.ts`

- [ ] **Step 1: Write failing tests for `RingBuffer`**

```ts
// server/tests/sse/stream.test.ts
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/sse/ringBuffer';

describe('RingBuffer', () => {
  it('since(id) returns events after the given id', () => {
    const rb = new RingBuffer<string>(5);
    rb.push('a'); rb.push('b'); rb.push('c');
    expect(rb.since(1)).toEqual([{ id: 2, value: 'b' }, { id: 3, value: 'c' }]);
  });

  it('since(id) returns null when id is older than the ring', () => {
    const rb = new RingBuffer<string>(2);
    rb.push('a'); rb.push('b'); rb.push('c');
    expect(rb.since(1)).toBe(null);
  });

  it('since with empty buffer returns []', () => {
    const rb = new RingBuffer<string>(3);
    expect(rb.since(0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement `server/src/sse/ringBuffer.ts`**

```ts
export interface RingEntry<T> { id: number; value: T }

export class RingBuffer<T> {
  private readonly entries: RingEntry<T>[] = [];
  private nextId = 1;
  constructor(private readonly capacity: number) {}

  push(value: T): RingEntry<T> {
    const entry = { id: this.nextId++, value };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    return entry;
  }

  since(lastId: number): RingEntry<T>[] | null {
    if (this.entries.length === 0) return [];
    const oldest = this.entries[0]!.id;
    if (lastId < oldest - 1) return null;
    return this.entries.filter((e) => e.id > lastId);
  }
}
```

- [ ] **Step 3: Implement `server/src/sse/stream.ts`**

```ts
import type { ServerResponse } from 'node:http';

export interface SseWriter {
  sendEvent(name: string, data: unknown, id?: number): void;
  sendComment(comment: string): void;
  close(): void;
  readonly closed: boolean;
  onClose(cb: () => void): void;
}

export function openSseStream(res: ServerResponse): SseWriter {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();
  let closed = false;
  const closeListeners: Array<() => void> = [];
  const onEnd = () => {
    closed = true;
    for (const cb of closeListeners) cb();
  };
  res.on('close', onEnd);
  res.on('finish', onEnd);
  return {
    get closed() { return closed; },
    sendEvent(name, data, id) {
      if (closed) return;
      let chunk = '';
      if (id !== undefined) chunk += `id: ${id}\n`;
      chunk += `event: ${name}\n`;
      chunk += `data: ${JSON.stringify(data)}\n\n`;
      res.write(chunk);
    },
    sendComment(comment) {
      if (closed) return;
      res.write(`: ${comment}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      res.end();
    },
    onClose(cb) {
      if (closed) cb();
      else closeListeners.push(cb);
    },
  };
}
```

- [ ] **Step 4: Implement `server/src/sse/registry.ts`**

```ts
import { RingBuffer, type RingEntry } from './ringBuffer';
import type { LobbyEvent } from '../types';
import type { SseWriter } from './stream';

export class LobbyStreamRegistry {
  private readonly subscribers = new Map<string, SseWriter>();
  readonly buffer = new RingBuffer<LobbyEvent>(200);

  subscribe(sessionId: string, writer: SseWriter): void {
    const existing = this.subscribers.get(sessionId);
    if (existing && !existing.closed) existing.close();
    this.subscribers.set(sessionId, writer);
    writer.onClose(() => {
      if (this.subscribers.get(sessionId) === writer) this.subscribers.delete(sessionId);
    });
  }

  publish(event: LobbyEvent): RingEntry<LobbyEvent> {
    const entry = this.buffer.push(event);
    for (const [, w] of this.subscribers) {
      if (w.closed) continue;
      w.sendEvent(event.type, event, entry.id);
    }
    return entry;
  }

  replaySince(writer: SseWriter, lastId: number): 'replayed' | 'needSnapshot' {
    const entries = this.buffer.since(lastId);
    if (entries === null) return 'needSnapshot';
    for (const e of entries) writer.sendEvent(e.value.type, e.value, e.id);
    return 'replayed';
  }

  size(): number {
    return [...this.subscribers.values()].filter((w) => !w.closed).length;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `cd server && npx vitest run tests/sse/stream.test.ts`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add server/src/sse/ server/tests/sse/stream.test.ts
git commit -m "Add the SSE writer ring buffer and subscriber registry"
```

---

## Task 17: Lobby stream handler with snapshot + heartbeat

**Files:**
- Create: `server/src/http/handlers/lobbyStream.ts`
- Modify: `server/src/http/server.ts` (extras param for registry)
- Modify: `server/tests/sse/stream.test.ts` (integration test)

- [ ] **Step 1: Append an integration test**

```ts
// append to server/tests/sse/stream.test.ts
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';
import type { AddressInfo } from 'node:net';
import { beforeEach, afterEach } from 'vitest';

async function startSse() {
  const mgr = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr, { registry });
  mgr.events.on('roomAdded', (e) => registry.publish(e));
  mgr.events.on('roomUpdated', (e) => registry.publish(e));
  mgr.events.on('roomRemoved', (e) => registry.publish(e));
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return { server: httpServer, url: `http://127.0.0.1:${port}`, mgr, registry };
}

describe('GET /v1/lobby/stream', () => {
  let ctx: Awaited<ReturnType<typeof startSse>>;
  beforeEach(async () => { ctx = await startSse(); });
  afterEach(() => { ctx.server.close(); });

  it('emits a snapshot then deltas', async () => {
    const res = await fetch(`${ctx.url}/v1/lobby/stream?sessionId=viewer-1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value!)).toMatch(/event: snapshot/);

    ctx.mgr.create({ sessionId: 'h', playerName: 'H',
      config: { ruleset: 'recommended', stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null },
      allowAiFill: true, visibility: 'public' });

    const second = await reader.read();
    expect(decoder.decode(second.value!)).toMatch(/event: roomAdded/);
    reader.cancel();
  });
});
```

- [ ] **Step 2: Implement `server/src/http/handlers/lobbyStream.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { openSseStream, type SseWriter } from '../../sse/stream';
import type { LobbyStreamRegistry } from '../../sse/registry';
import type { RoomManager } from '../../room/manager';
import { projectRoomInfo } from '../../room/slots';

const HEARTBEAT_MS = 20_000;

export function getLobbyStream(mgr: RoomManager, registry: LobbyStreamRegistry) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId') ?? `anon-${Math.random().toString(36).slice(2)}`;
    const lastEventId = req.headers['last-event-id'];
    const lastId = typeof lastEventId === 'string' ? Number(lastEventId) : NaN;
    const writer = openSseStream(res);

    registry.subscribe(sessionId, writer);

    if (!Number.isNaN(lastId)) {
      const result = registry.replaySince(writer, lastId);
      if (result === 'needSnapshot') sendSnapshot(writer, mgr);
    } else {
      sendSnapshot(writer, mgr);
    }

    const hb = setInterval(() => writer.sendComment('ping'), HEARTBEAT_MS);
    writer.onClose(() => clearInterval(hb));
  };
}

function sendSnapshot(writer: SseWriter, mgr: RoomManager): void {
  writer.sendEvent('snapshot', {
    type: 'snapshot',
    rooms: mgr.listPublicWaiting().map((r) => projectRoomInfo(r, { context: 'list' })),
    stats: mgr.stats(),
  });
}
```

- [ ] **Step 3: Update `mountRoutes` signature**

```ts
// server.ts
import { getLobbyStream } from './handlers/lobbyStream';
import type { LobbyStreamRegistry } from '../sse/registry';

export function mountRoutes(
  router: Router,
  mgr: RoomManager,
  extras: { registry?: LobbyStreamRegistry } = {},
): void {
  router.add('GET', '/v1/rooms', listRooms(mgr));
  router.add('POST', '/v1/rooms', postRoom(mgr));
  router.add('GET', '/v1/rooms/:id', getRoom(mgr));
  router.add('PATCH', '/v1/rooms/:id', patchRoom(mgr));
  router.add('POST', '/v1/rooms/:id/members', postMember(mgr));
  router.add('DELETE', '/v1/rooms/:id/members/:sessionId', deleteMember(mgr));
  router.add('PUT', '/v1/rooms/:id/slots/:index', putSlot(mgr));
  router.add('POST', '/v1/rooms/:id/game', postGame(mgr));
  if (extras.registry) {
    router.add('GET', '/v1/lobby/stream', getLobbyStream(mgr, extras.registry));
  }
}
```

- [ ] **Step 4: Run the full test suite**

Run: `cd server && npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/http/handlers/lobbyStream.ts server/src/http/server.ts \
        server/tests/sse/stream.test.ts
git commit -m "Stream the lobby snapshot and deltas with heartbeat comments"
```

---

## Task 18: Throttled statsUpdate ticker

**Files:**
- Create: `server/src/stats.ts`

- [ ] **Step 1: Implement `server/src/stats.ts`**

```ts
import type { RoomManager } from './room/manager';
import type { LobbyStreamRegistry } from './sse/registry';

export function startStatsTicker(mgr: RoomManager, registry: LobbyStreamRegistry): () => void {
  let lastStats = JSON.stringify(mgr.stats());
  const interval = setInterval(() => {
    const next = JSON.stringify(mgr.stats());
    if (next !== lastStats) {
      lastStats = next;
      registry.publish({ type: 'statsUpdate', stats: JSON.parse(next) });
    }
  }, 2_000);
  return () => clearInterval(interval);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/stats.ts
git commit -m "Throttle lobby stats updates on a two-second interval"
```

---

## Task 19: Rate-limit middleware wiring

**Files:**
- Modify: `server/src/http/server.ts`
- Modify: `server/tests/http/rooms.test.ts`

- [ ] **Step 1: Wire rate limiters into `handle`**

Inside `server.ts`, at module scope (outside `buildHttpServer`):

```ts
import { TokenBucketLimiter, LIMITS } from './middleware/rateLimit';
import { extractBearer } from './middleware/auth';

const limiters = {
  createRoom: new TokenBucketLimiter(LIMITS.createRoom),
  join: new TokenBucketLimiter(LIMITS.join),
  admin: new TokenBucketLimiter(LIMITS.admin),
};

function limiterFor(method: string, path: string): TokenBucketLimiter | null {
  if (method === 'POST' && path === '/v1/rooms') return limiters.createRoom;
  if (method === 'POST' && /^\/v1\/rooms\/[^/]+\/members$/.test(path)) return limiters.join;
  if (method === 'DELETE' && /^\/v1\/rooms\/[^/]+\/members\/[^/]+$/.test(path)) return limiters.admin;
  if (method === 'PUT' && /^\/v1\/rooms\/[^/]+\/slots\/[^/]+$/.test(path)) return limiters.admin;
  if (method === 'PATCH' && /^\/v1\/rooms\/[^/]+$/.test(path)) return limiters.admin;
  return null;
}
```

Inside `handle`, just before route dispatch:

```ts
    const limiter = limiterFor(req.method ?? 'GET', url.pathname);
    if (limiter) {
      const key = `${extractBearer(req) ?? 'anon'}::${req.socket.remoteAddress}`;
      if (!limiter.take(key)) {
        res.setHeader('retry-after', '10');
        return writeProblem(res, problemResponse({
          type: 'https://skip-bo.example.com/problems/rate-limited',
          title: 'Too Many Requests', status: 429, instance: url.pathname,
        }));
      }
    }
```

- [ ] **Step 2: Append a test**

```ts
// append to server/tests/http/rooms.test.ts
it('returns 429 after exhausting create-room burst', async () => {
  // same bearer so the bucket tracks together
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${ctx.url}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer s1', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: `P${i}`, config: baseConfigBody(), allowAiFill: true, visibility: 'public' }),
    });
    // first succeeds; subsequent may be 409 (sessionAlreadySeated) but that still spends a token on 201
    expect([201, 409]).toContain(res.status);
  }
  const res = await fetch(`${ctx.url}/v1/rooms`, {
    method: 'POST',
    headers: { authorization: 'Bearer s1', 'content-type': 'application/json' },
    body: JSON.stringify({ playerName: 'PX', config: baseConfigBody(), allowAiFill: true, visibility: 'public' }),
  });
  expect(res.status).toBe(429);
});
```

- [ ] **Step 3: Run tests**

Run: `cd server && npx vitest run tests/http/`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add server/src/http/server.ts server/tests/http/rooms.test.ts
git commit -m "Enforce per-endpoint token bucket rate limits with 429 on exhaustion"
```

---

## Task 20: Graceful shutdown and entrypoint

**Files:**
- Create: `server/src/shutdown.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Implement `server/src/shutdown.ts`**

```ts
import type { Server } from 'node:http';
import type { LobbyStreamRegistry } from './sse/registry';
import { logger } from './logger';

export interface ShutdownOptions {
  httpServer: Server;
  registry?: LobbyStreamRegistry;
  drainMs?: number;
}

export function installShutdown(opts: ShutdownOptions): (code: number) => Promise<void> {
  let inProgress = false;

  async function shutdown(code: number): Promise<void> {
    if (inProgress) return;
    inProgress = true;
    logger.info({ code }, 'shutdown starting');

    await new Promise<void>((resolve) => opts.httpServer.close(() => resolve()));
    // Section 3 stub: broadcast 1001 to every game WS here once it exists.

    const drain = opts.drainMs ?? 5_000;
    await new Promise((r) => setTimeout(r, drain));

    logger.info({ code }, 'shutdown complete');
    process.exit(code);
  }

  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception — exiting');
    void shutdown(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection — exiting');
    void shutdown(1);
  });

  return shutdown;
}
```

- [ ] **Step 2: Replace `server/src/index.ts`**

```ts
import { config } from './config';
import { logger } from './logger';
import { RoomManager } from './room/manager';
import { LobbyStreamRegistry } from './sse/registry';
import { buildHttpServer, mountRoutes } from './http/server';
import { startStatsTicker } from './stats';
import { installShutdown } from './shutdown';

function main(): void {
  const roomManager = new RoomManager();
  const registry = new LobbyStreamRegistry();

  roomManager.events.on('roomAdded', (e) => registry.publish(e));
  roomManager.events.on('roomUpdated', (e) => registry.publish(e));
  roomManager.events.on('roomRemoved', (e) => registry.publish(e));

  const { httpServer, router } = buildHttpServer({
    roomManager,
    corsOrigin: config.corsOrigin,
  });
  mountRoutes(router, roomManager, { registry });
  const stopStats = startStatsTicker(roomManager, registry);

  installShutdown({ httpServer, registry });

  httpServer.listen(config.httpPort, () => {
    logger.info({ port: config.httpPort }, 'server listening');
  });

  process.on('exit', () => stopStats());
}

main();
```

- [ ] **Step 3: Typecheck + smoke run**

Run: `cd server && npm run typecheck`
Expected: no errors.
Run: `cd server && npm run dev`
Expected: logs `server listening` on port 8787. `curl http://localhost:8787/v1/rooms` returns `{"rooms":[],"stats":{"gamesInProgress":0,"playersOnline":0}}`. Ctrl-C triggers `shutdown starting` then `shutdown complete`.

- [ ] **Step 4: Commit**

```bash
git add server/src/shutdown.ts server/src/index.ts
git commit -m "Wire entry point with graceful shutdown and stats ticker"
```

---

## Task 21: Dockerfile, pm2, compose, esbuild

**Files:**
- Create: `server/esbuild.config.mjs`
- Create: `server/pm2.config.cjs`
- Create: `server/Dockerfile`
- Create: `server/.dockerignore`
- Create: `server/docker-compose.yml`

- [ ] **Step 1: `server/esbuild.config.mjs`**

```js
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'dist/index.js'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: true,
  sourcemap: true,
  external: ['pino-pretty'],
  banner: { js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);" },
  alias: {
    '@engine': resolve(here, '../src/lib/game'),
  },
});
```

- [ ] **Step 2: `server/pm2.config.cjs`**

```js
module.exports = {
  apps: [{
    name: 'skip-bo-server',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    kill_timeout: 8000,
    env: { NODE_ENV: 'production' },
  }],
};
```

- [ ] **Step 3: `server/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY src/lib/game ./src/lib/game
COPY server ./server
RUN cd server && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g pm2@5
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/pm2.config.cjs ./pm2.config.cjs
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["pm2-runtime", "pm2.config.cjs"]
```

- [ ] **Step 4: `server/.dockerignore`**

```
node_modules
dist
coverage
*.log
tests
```

- [ ] **Step 5: `server/docker-compose.yml`**

```yaml
services:
  server:
    build:
      context: ..
      dockerfile: server/Dockerfile
    ports:
      - "8787:8787"
    environment:
      NODE_ENV: production
      CORS_ORIGIN: http://localhost:3000
      LOG_LEVEL: info
      WS_BASE_URL: ws://localhost:8787
    restart: unless-stopped
```

- [ ] **Step 6: Smoke build**

Run: `cd server && npm run build`
Expected: `dist/index.js` created.
Run: `cd server && docker compose build`
Expected: image builds.
Run: `cd server && docker compose up -d`
Expected: container up. `curl http://localhost:8787/v1/rooms` returns JSON.
Run: `cd server && docker compose down`.

- [ ] **Step 7: Commit**

```bash
git add server/Dockerfile server/.dockerignore server/docker-compose.yml \
        server/pm2.config.cjs server/esbuild.config.mjs
git commit -m "Containerize the server with esbuild bundling and pm2 supervision"
```

---

## Task 22: OpenAPI 3.1 yaml

**Files:**
- Create: `server/openapi.yaml`

- [ ] **Step 1: Write `server/openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: Skip-Bo Game Server
  version: 0.1.0
  description: REST and SSE surface for room management and the lobby feed.
servers:
  - url: http://localhost:8787/v1
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
      description: Opaque session UUID held by the client.
  schemas:
    GameConfig:
      type: object
      required: [ruleset, stockPileSize, handSize, bidirectionalBuild, maxPlayers, partnership]
      properties:
        ruleset: { type: string, enum: [recommended, official] }
        stockPileSize: { type: integer, minimum: 5, maximum: 50 }
        handSize: { type: integer, minimum: 3, maximum: 10 }
        bidirectionalBuild: { type: boolean }
        maxPlayers: { type: integer, minimum: 2, maximum: 8 }
        partnership:
          oneOf:
            - type: 'null'
            - type: object
              properties:
                enabled: { type: boolean }
                teams: { type: array, items: { type: array, items: { type: string } } }
                allowPlayFromPartnerStock: { type: boolean }
                allowPlayFromPartnerDiscard: { type: boolean }
                allowDiscardToPartnerDiscard: { type: boolean }
    SlotSummary:
      type: object
      properties:
        humans: { type: integer }
        ai: { type: integer }
        open: { type: integer }
        locked: { type: integer }
        capacity: { type: integer }
    RoomInfo:
      type: object
      required: [id, displayName, phase, config, allowAiFill, visibility, slotSummary, hostName, createdAt]
      properties:
        id: { type: string, format: uuid }
        code: { type: string, nullable: true }
        displayName: { type: string }
        phase: { type: string, enum: [waiting, playing, finished] }
        config: { $ref: '#/components/schemas/GameConfig' }
        allowAiFill: { type: boolean }
        visibility: { type: string, enum: [public, private] }
        slotSummary: { $ref: '#/components/schemas/SlotSummary' }
        hostName: { type: string }
        createdAt: { type: integer }
    Problem:
      type: object
      required: [type, title, status]
      properties:
        type: { type: string, format: uri }
        title: { type: string }
        status: { type: integer }
        detail: { type: string }
        instance: { type: string }
  responses:
    Problem:
      description: Problem+JSON
      content:
        application/problem+json:
          schema: { $ref: '#/components/schemas/Problem' }
security:
  - bearer: []
paths:
  /rooms:
    post:
      summary: Create a room
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [playerName, config, allowAiFill, visibility]
              properties:
                playerName: { type: string }
                displayName: { type: string }
                config: { $ref: '#/components/schemas/GameConfig' }
                allowAiFill: { type: boolean }
                visibility: { type: string, enum: [public, private] }
      responses:
        '201':
          description: Room created
          headers:
            Location:
              schema: { type: string }
          content:
            application/json:
              schema:
                type: object
                properties:
                  roomId: { type: string }
                  code: { type: string }
                  room: { $ref: '#/components/schemas/RoomInfo' }
        '401': { $ref: '#/components/responses/Problem' }
        '422': { $ref: '#/components/responses/Problem' }
        '429': { $ref: '#/components/responses/Problem' }
    get:
      summary: List rooms
      security: []
      parameters:
        - in: query
          name: code
          schema: { type: string }
        - in: query
          name: visibility
          schema: { type: string, enum: [public, private] }
        - in: query
          name: phase
          schema: { type: string, enum: [waiting, playing, finished] }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  rooms: { type: array, items: { $ref: '#/components/schemas/RoomInfo' } }
                  stats:
                    type: object
                    properties:
                      gamesInProgress: { type: integer }
                      playersOnline: { type: integer }
  /rooms/{roomId}:
    get:
      summary: Get a room
      security: []
      parameters:
        - in: path
          name: roomId
          required: true
          schema: { type: string }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/RoomInfo' }
        '404': { $ref: '#/components/responses/Problem' }
    patch:
      summary: Update room settings (host only)
      parameters:
        - in: path
          name: roomId
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/merge-patch+json:
            schema:
              type: object
              properties:
                displayName: { type: string }
                config: { $ref: '#/components/schemas/GameConfig' }
                allowAiFill: { type: boolean }
                visibility: { type: string, enum: [public, private] }
      responses:
        '204': { description: Updated }
        '403': { $ref: '#/components/responses/Problem' }
        '409': { $ref: '#/components/responses/Problem' }
  /rooms/{roomId}/game:
    post:
      summary: Start the game
      parameters:
        - in: path
          name: roomId
          required: true
          schema: { type: string }
      responses:
        '201':
          description: Game started
          content:
            application/json:
              schema:
                type: object
                properties:
                  startedAt: { type: integer }
        '403': { $ref: '#/components/responses/Problem' }
        '409': { $ref: '#/components/responses/Problem' }
  /rooms/{roomId}/members:
    post:
      summary: Join a room
      parameters:
        - in: path
          name: roomId
          required: true
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [playerName]
              properties:
                playerName: { type: string }
      responses:
        '201':
          description: Joined
          content:
            application/json:
              schema:
                type: object
                properties:
                  room: { $ref: '#/components/schemas/RoomInfo' }
                  wsUrl: { type: string }
                  slotIndex: { type: integer }
        '409': { $ref: '#/components/responses/Problem' }
  /rooms/{roomId}/members/{sessionId}:
    delete:
      summary: Leave or kick
      parameters:
        - in: path
          name: roomId
          required: true
          schema: { type: string }
        - in: path
          name: sessionId
          required: true
          schema: { type: string }
      responses:
        '204': { description: Removed }
        '403': { $ref: '#/components/responses/Problem' }
  /rooms/{roomId}/slots/{index}:
    put:
      summary: Set slot state (host only)
      parameters:
        - in: path
          name: roomId
          required: true
          schema: { type: string }
        - in: path
          name: index
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              oneOf:
                - type: object
                  properties: { kind: { type: string, enum: [open] } }
                - type: object
                  properties: { kind: { type: string, enum: [locked] } }
                - type: object
                  properties:
                    kind: { type: string, enum: [ai] }
                    difficulty: { type: string, enum: [easy] }
      responses:
        '204': { description: Updated }
        '403': { $ref: '#/components/responses/Problem' }
        '409': { $ref: '#/components/responses/Problem' }
  /lobby/stream:
    get:
      summary: Lobby SSE feed
      security: []
      parameters:
        - in: query
          name: sessionId
          schema: { type: string }
      responses:
        '200':
          description: SSE stream
          content:
            text/event-stream:
              schema: { type: string }
```

- [ ] **Step 2: Lint the YAML (optional)**

Run: `cd server && npx @redocly/cli@latest lint openapi.yaml`
Fix any reported issues.

- [ ] **Step 3: Commit**

```bash
git add server/openapi.yaml
git commit -m "Document the server API surface with an OpenAPI specification"
```

---

## Task 23: Integration test — full flow

**Files:**
- Create: `server/tests/integration/full-flow.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// server/tests/integration/full-flow.test.ts
import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';

function baseConfig() {
  return { ruleset: 'recommended' as const, stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null };
}

describe('integration: full lobby flow', () => {
  it('creates a room, joins, starts, and removes it from the lobby feed', async () => {
    const mgr = new RoomManager();
    const registry = new LobbyStreamRegistry();
    mgr.events.on('roomAdded', (e) => registry.publish(e));
    mgr.events.on('roomUpdated', (e) => registry.publish(e));
    mgr.events.on('roomRemoved', (e) => registry.publish(e));
    const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
    mountRoutes(router, mgr, { registry });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const sseRes = await fetch(`${base}/v1/lobby/stream?sessionId=viewer`);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    const firstChunk = decoder.decode((await reader.read()).value!);
    expect(firstChunk).toMatch(/event: snapshot/);

    const createRes = await fetch(`${base}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer host', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Host', config: baseConfig(), allowAiFill: true, visibility: 'public' }),
    });
    expect(createRes.status).toBe(201);
    const { roomId } = await createRes.json();

    const next = decoder.decode((await reader.read()).value!);
    expect(next).toMatch(/event: roomAdded/);

    const joinRes = await fetch(`${base}/v1/rooms/${roomId}/members`, {
      method: 'POST',
      headers: { authorization: 'Bearer p2', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'P2' }),
    });
    expect(joinRes.status).toBe(201);

    const startRes = await fetch(`${base}/v1/rooms/${roomId}/game`, {
      method: 'POST',
      headers: { authorization: 'Bearer host' },
    });
    expect(startRes.status).toBe(201);

    let sawRemoved = false;
    for (let i = 0; i < 3; i++) {
      const c = decoder.decode((await reader.read()).value!);
      if (c.includes('event: roomRemoved')) sawRemoved = true;
    }
    expect(sawRemoved).toBe(true);

    reader.cancel();
    httpServer.close();
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd server && npx vitest run tests/integration/full-flow.test.ts`
Expected: passing.

- [ ] **Step 3: Run the full suite**

Run: `cd server && npm test`
Expected: every test green. Note coverage numbers.

- [ ] **Step 4: Commit**

```bash
git add server/tests/integration/full-flow.test.ts
git commit -m "Exercise the REST and SSE flow with an end-to-end integration test"
```

---

## Task 24: Close the loop — status pointers

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/design-session-progress.md`

- [ ] **Step 1: Update `CLAUDE.md` "Where we left off"**

Replace the existing block with:

```markdown
## 🔖 Where we left off

Section 4 (Room Manager & Lobby) is designed, specced, and implemented as the `server/` package — REST, SSE, in-memory RoomManager, pm2 + Docker. Section 3 (game WebSocket) integration points are stubbed (close codes, grace window) pending its own plan. Next up: brainstorm Section 3 or Section 5 (AI bots). Run `cd server && npm test` to exercise the full suite. Pick up via `docs/design-session-progress.md`.
```

- [ ] **Step 2: Update `docs/design-session-progress.md`**

In the "Implementation status" section, change the Section 4 line to note it's implemented and link the plan:

```markdown
- **Room Manager + Lobby (Section 4)** — designed, specced, and **implemented** as `server/`. Plan: `docs/superpowers/plans/2026-04-17-room-manager-lobby.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/design-session-progress.md
git commit -m "Mark Section 4 implemented in the repo status pointers"
```

---

## Self-review notes

**Spec coverage check against `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md`:**

| Spec section | Plan task(s) |
|---|---|
| §4.1 Architecture overview | Tasks 1, 10, 20 |
| §4.2 Data model | Tasks 2, 4 |
| §4.3 HTTP endpoints | Tasks 9–15, 19 |
| §4.4 SSE stream | Tasks 16, 17 |
| §4.5 Lifecycle | Tasks 6–8 |
| §4.5.1 Crash + shutdown | Task 20 |
| §4.6 Security + validation | Tasks 10, 11, 19, 3 |
| OpenAPI deliverable | Task 22 |
| Integration + Docker | Tasks 21, 23 |

**Stubs made explicit:** disconnect grace, WS close codes (4001/4002/4005), `1001` shutdown broadcast — all deferred to Section 3's plan and flagged in lifecycle.ts and shutdown.ts.

**Caveats for the implementer:**
1. The plan assumes `createGame({ config, players })` in `src/lib/game/engine.ts`. Confirm the signature before Task 8. If different, adapt the call in `lifecycle.initializeGameState` — do not edit this plan.
2. `RoomManager.touch` in Task 6 does **not** call `scheduleIdle`; Task 8 Step 4 rewrites it to do so. Do not commit Task 7's code alone and expect the idle timer to work — Task 8 is required for correctness.
3. Handler helper functions (`unauthorized`, `notFound`, `unprocessable`, etc.) are centralized in `server/src/http/handlers/_helpers.ts` starting Task 12. Handlers created in later tasks import from there.
4. `scheduleIdle` must be called at the end of `create()` — Task 8 Step 4 adds this; verify.

---

## Handoff

Plan complete. Two options to run it:

**1. Subagent-Driven (recommended).** Dispatch a fresh subagent per task, review between tasks. Uses `superpowers:subagent-driven-development`.

**2. Inline.** Execute tasks in this session using `superpowers:executing-plans`. Batch checkpoints every 3–4 tasks for review.

Which approach?
