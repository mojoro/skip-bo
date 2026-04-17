# Room Manager & Lobby — Design

**Date:** 2026-04-17
**Status:** Approved (pending user review of this document)
**Scope:** Section 4 of the Skip-Bo networking design. Picks up after Sections 1 (engine), 2→3 (WebSocket protocol), and 3 (architecture) were approved and partially implemented.

## Context

Skip-Bo is a browser-based multiplayer card game built as part of John Moorman's "10 projects in 10 weeks" sprint. The primary learning goals are real-time WebSocket plumbing, deployment on AWS, and room/state management written from scratch — no Colyseus, no PartyKit, no Socket.IO.

Architecture was locked earlier:
- **Next.js** frontend on **Vercel** for lobby + game UI.
- **Node.js** game server on **AWS EC2** (Docker + nginx + Let's Encrypt).
- Server owns all game state, validation, rooms, and AI bots. Frontend is a pure renderer over server events.

This document specifies Section 4: how rooms are created, listed, joined, and cleaned up; the HTTP and SSE surfaces; and the lifecycle / security model that binds them together.

## Decisions locked during brainstorming

| # | Question | Answer |
|---|----------|--------|
| 1 | Room discovery model | Public list + private 6-char codes. Host picks at creation. |
| 2 | Lobby update mechanism | Server-Sent Events (`GET /v1/lobby/stream`). |
| 3 | Room creation config | Full surface: display name, ruleset, max players, stock pile size, partnership mode + 3 flags, visibility, AI fill. |
| 4 | Start trigger | Host clicks "Start." Host-leave → migrate to next-joined human. |
| 4b | Slot control | Host can kick, open, lock, or fill-with-AI any slot while `phase === 'waiting'`. |
| 5a | Cleanup timers | Idle waiting room: 30 min. Finished game: 5 min. Abandoned (no humans past grace): immediate. |
| 5b | Lobby list filter | Waiting + public only. Playing/finished rooms excluded. |
| 5c | Aggregate stats | Lobby shows `gamesInProgress` and `playersOnline` in header. |
| 6 | Player identity | Name prompt on first visit, stored in localStorage alongside `sessionId`. Duplicate names in a room get `"(2)"` suffix. |
| 7 | SSE payload | Initial `snapshot` on connect, then deltas (`roomAdded` / `roomUpdated` / `roomRemoved` / `statsUpdate`). |

## 4.1 — Architecture overview

The game server gains a second surface alongside the WebSocket game channel:

- **HTTP REST** for imperative lobby actions (create room, join by code, get room snapshot, host admin actions).
- **Server-Sent Events** (`GET /v1/lobby/stream`) for the live lobby feed — initial snapshot plus deltas.
- **Game WebSocket** (Section 3) remains the only channel once a player is inside a room.

```
Client                          Server (EC2, single Node process)
──────                          ─────────────────────────────────
Lobby page ──HTTP POST /v1/rooms──────────►  RoomManager.create()
Lobby page ──SSE  /v1/lobby/stream────────►  LobbyStream (broadcasts deltas)
Lobby page ──HTTP GET  /v1/rooms/{roomId}─►  RoomManager.get()
Waiting room ──WSS /game?roomId=──────────►  GameConnection + RoomManager
```

`RoomManager` is one in-memory module: `Map<roomId, Room>` plus `Map<code, roomId>` for private lookups. It owns all lifecycle transitions and emits events the `LobbyStream` translates into SSE pushes. The pure game engine (Section 1) is wrapped per-room; `RoomManager` never touches engine internals.

**Single-process scope.** Matches the EC2 deployment decision — no cross-node sync, no Redis. Scale-out is an interview talking point, not code we ship.

## 4.2 — Data model

`Room` is the private authoritative record; `RoomInfo` is the public projection published to the lobby.

```typescript
type RoomPhase = 'waiting' | 'playing' | 'finished'
type Visibility = 'public' | 'private'

interface Room {
  id: string                    // UUID v4
  code: string                  // 6-char, always assigned
  displayName: string           // auto-generated ("John's table"), host-editable
  visibility: Visibility
  phase: RoomPhase
  hostSessionId: string
  config: GameConfig            // ruleset, maxPlayers, stockPileSize, partnership flags
  allowAiFill: boolean
  slots: Slot[]                 // length === config.maxPlayers
  game: GameState | null        // null until phase === 'playing'
  createdAt: number
  lastActivityAt: number        // drives 30-min idle timeout
  finishedAt: number | null     // drives 5-min cleanup
  kickedSessionIds: Set<string> // prevents kicked players from rejoining
}

type Slot =
  | { kind: 'open' }
  | { kind: 'locked' }
  | { kind: 'human'; sessionId: string; name: string; connected: boolean }
  | { kind: 'ai'; botId: string; difficulty: 'easy' }

interface RoomInfo {
  id: string
  code: string | null           // nulled only in the public lobby list + SSE feed when visibility === 'private'; always populated on GET /v1/rooms/{roomId} and GET /v1/rooms?code=
  displayName: string
  phase: RoomPhase
  config: GameConfig
  allowAiFill: boolean
  slotSummary: {
    humans: number
    ai: number
    open: number
    locked: number
    capacity: number            // === config.maxPlayers
  }
  hostName: string
  createdAt: number
}

interface LobbyStats {
  gamesInProgress: number       // count of phase === 'playing'
  playersOnline: number         // unique connected humans + unique lobby SSE subscribers
}
```

**Shape choices.**
- `slots: Slot[]` as a discriminated union beats four parallel arrays.
- `RoomInfo` never exposes session IDs or per-player identities — only `hostName` and aggregate counts.
- `code` nulled for private rooms in the public list; the code is the password.
- `lastActivityAt` and `finishedAt` are separate fields so the two timers live independently.

## 4.3 — HTTP endpoints

Aligned with the [Zalando RESTful API Guidelines](https://opensource.zalando.com/restful-api-guidelines/).

### Conventions

- **Base URL:** `https://api.<domain>/v1/` — URI versioning (§113).
- **Paths:** kebab-case, plural nouns (§129, §134). No verbs in URIs (§138).
- **JSON casing:** **camelCase** (§118 permits a consistent choice). The engine already uses camelCase, so the REST surface matches.
- **Auth:** `Authorization: Bearer <sessionId>`. Opaque identity token, no real auth logic. Missing/bad → 401.
- **Errors:** `application/problem+json` per RFC 7807 (§176). Fields: `type` (stable URI), `title`, `status`, `detail`, `instance`.
- **Tracing:** `X-Flow-Id` echoed on every response (§233).
- **Idempotency:** optional `Idempotency-Key` on POSTs; server dedupes for 24 h (§230).
- **Patch format:** `application/merge-patch+json` (§114).
- **Max body size:** 4 KB; over → 413.

### Rooms

```
POST   /v1/rooms
  body: { playerName, displayName?, config, allowAiFill, visibility }
  → 201 Created, Location: /v1/rooms/{roomId}
    { roomId, code, room: RoomInfo }

GET    /v1/rooms?visibility=public&phase=waiting&code={code}
  default filters: visibility=public, phase=waiting.
  code filter returns 0- or 1-element list.
  cursor pagination documented (§160), capped at 100 rooms.
  → 200 { rooms: RoomInfo[], stats: LobbyStats, next? }

GET    /v1/rooms/{roomId}                 → 200 RoomInfo | 404

PATCH  /v1/rooms/{roomId}
  Content-Type: application/merge-patch+json
  body: { displayName?, config?, allowAiFill?, visibility? }
  → 204 | 403 | 409 (phase !== 'waiting')
```

### Game (sub-resource)

Modelling "start the game" as creating a `game` resource under the room keeps state transitions inside HTTP verbs rather than an RPC verb in the URL.

```
POST   /v1/rooms/{roomId}/game
  → 201 Created, Location: /v1/rooms/{roomId}/game
    { startedAt }
  403 if not host, 409 if < 2 players or already started or open slots without AI fill.
```

### Members (join / leave / kick)

```
POST   /v1/rooms/{roomId}/members
  body: { playerName }
  → 201 Created, Location: /v1/rooms/{roomId}/members/{sessionId}
    { room: RoomInfo, wsUrl, slotIndex }
  409 if full / started / previously kicked.

DELETE /v1/rooms/{roomId}/members/{sessionId}
  → 204
  self-leave if caller === {sessionId}; kick if caller is host.
  host self-leave triggers host migration (§4.5).
```

### Slots (host-only)

`PUT` with full desired state expresses "kick" / "lock" / "fill with bot" without a free-form `action` string.

```
PUT    /v1/rooms/{roomId}/slots/{index}
  body: { kind: 'open' | 'locked' | 'ai', difficulty?: 'easy' }
  → 204 | 403 (not host) | 409 (phase !== 'waiting' or invalid transition)
  setting 'open' on a human slot kicks that player — their game WS closes with 4002.
  setting 'ai' provisions a bot.
```

Humans never arrive via `PUT` — they come through `POST /members`.

### Lobby stream

```
GET    /v1/lobby/stream
  Accept: text/event-stream → 200 text/event-stream   (see §4.4)
```

### Status codes

`200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`, `413`, `422`, `429`. All error bodies are Problem+JSON.

### Rate limits (token bucket on `(sessionId, IP)`)

| Endpoint | Rate | Burst |
|----------|------|-------|
| `POST /rooms` | 1 / 10 s | 3 |
| `POST /members` | 5 / 10 s | — |
| `PUT /slots/*`, `PATCH /rooms/*`, `DELETE /members/*` | 10 / 10 s | — |

Over limit → 429 with `Retry-After`.

### Not adopted from Zalando (with reasons)

- **HATEOAS `_links`** (§164) — single-purpose SPA, discovery has no value.
- **ETags / `If-None-Match`** — SSE obsoletes conditional GETs.
- **Media-type versioning** (§113 preferred) — URI `/v1/` is simpler for one consumer; revisit at v2.

### OpenAPI

Server ships an `openapi.yaml` (OpenAPI 3.1) covering every endpoint above — request/response schemas, Problem+JSON error types, examples. Generated once at implementation time and kept alongside the server source.

## 4.4 — SSE stream: `GET /v1/lobby/stream`

**Transport.** `text/event-stream`, HTTP/1.1 long-lived response. nginx config disables proxy buffering on this path.

**Auth / scope.** Public. `?sessionId=<uuid>` query param lets the server count unique subscribers for `playersOnline` without requiring a bearer.

**Event envelope.**

```typescript
type LobbyEvent =
  | { type: 'snapshot';    rooms: RoomInfo[]; stats: LobbyStats }
  | { type: 'roomAdded';   room: RoomInfo }
  | { type: 'roomUpdated'; room: RoomInfo }
  | { type: 'roomRemoved'; roomId: string }
  | { type: 'statsUpdate'; stats: LobbyStats }
```

Wire format:

```
event: snapshot
id: 42
data: {"type":"snapshot","rooms":[...],"stats":{...}}

event: roomAdded
id: 43
data: {"type":"roomAdded","room":{...}}
```

**Ordering guarantee.** On connect, exactly one `snapshot` is emitted first, then deltas. Clients discard any pre-snapshot deltas.

**Trigger table.**

| Event | Fires when |
|-------|-----------|
| `roomAdded` | `POST /v1/rooms` creates a public room. |
| `roomUpdated` | Config, slot summary, or host name changes on a public waiting room. |
| `roomRemoved` | Room leaves the public-waiting projection: starts, finishes, is deleted, or flips to private. |
| `statsUpdate` | Throttled to ≤ 1 / 2 s; coalesces rapid player-count changes. |

**Heartbeat.** Server writes an SSE comment (`: ping\n\n`) every 20 s to keep idle connections open through nginx and intermediate proxies.

**Reconnection.** `EventSource` auto-reconnects. Server honours `Last-Event-ID` and replays from a 200-event ring buffer; if the gap exceeds the buffer, the server responds with a fresh `snapshot` and a new id sequence.

**Not streamed:** private rooms, `playing`/`finished` rooms (affect `stats.gamesInProgress` only), per-room game state (that's the game WS).

## 4.5 — Room lifecycle

### Phase transitions

```
                 POST /members (first creator)
       ┌──────── from POST /rooms ─────────────┐
       ▼                                        │
  ┌─────────┐   POST /rooms/{id}/game    ┌─────────────┐
  │ waiting │───────────────────────────►│   playing   │
  └─────────┘                            └─────────────┘
       │                                         │
       │ idle 30 min                             │ engine reports winner
       │ OR all humans gone past grace           │ OR all humans gone past grace
       ▼                                         ▼
  ┌──────────┐                            ┌──────────┐
  │ (delete) │◄──── 5 min after ──────────│ finished │
  └──────────┘                            └──────────┘
```

Each transition is a single method on `RoomManager`, emitting events the `LobbyStream` consumes. No other code mutates `room.phase`.

### Host migration

Triggered when the current host's slot leaves (`DELETE /members` on self, WS close past the 60 s grace window from Section 3, or slot-PUT that removes the host). Self-kick via slot-PUT is rejected.

1. Collect human slots, ordered by join time.
2. If any exist → new host = first. Emit `roomUpdated` (hostName changed).
3. If none:
   - Phase `waiting` → delete immediately. Emit `roomRemoved`.
   - Phase `playing` → wait out the 60 s grace window. If still no humans, phase → `finished` (reason: `abandoned`), cleanup timer starts.
4. AI slots never become host. An all-AI room counts as human-empty.

### Disconnect grace (recap)

- During `playing`, a closed WS flips the slot's `connected: false`. Engine behaviour on the disconnected player's turn is owned by Section 1.
- At 60 s still disconnected: if `allowAiFill`, swap slot to `{ kind: 'ai' }` and play continues. Else end the game (`finished`, reason: `playerGone`).

### Kick semantics

- `PUT /slots/{i}` with `{ kind: 'open' }` on a human slot: close their game WS with 4002, reclaim the seat, add `sessionId` to `kickedSessionIds`.
- Kicked players' `POST /members` → 409 until the room is deleted.
- Kick during `playing` is blocked (409). Slot mutations are `waiting`-only.

### AI fill transitions

- **Manual:** host `PUT { kind: 'ai' }` during waiting. Instant swap.
- **Auto on start:** at `POST /game`, any `open` slots fill with AI iff `allowAiFill`; otherwise start is rejected (409 `openSlots`).
- **Auto on disconnect:** covered above.

### Timers

- **Idle waiting-room timer.** Reset on any room mutation. 30 min → delete + `roomRemoved`. Implemented as a single `setTimeout` stored on the room, cleared/reset on mutation.
- **Post-game timer.** Fires 5 min after `finishedAt`. Deletes room + any lingering WS connections (close 4005).
- **Server-crash recovery.** None. See §4.5.1 for process-level handling.

### Invariants

1. `room.slots.length === room.config.maxPlayers` always.
2. Exactly one slot corresponds to `hostSessionId` while at least one human remains.
3. `phase === 'playing'` iff `game !== null`.
4. `finishedAt !== null` iff `phase === 'finished'`.
5. A session occupies at most one slot across all rooms. `POST /members` on a second room auto-`DELETE`s the first.

## 4.5.1 — Crash + graceful shutdown

Game state is in-memory and ephemeral by design. Persistence (Redis, Postgres) was considered and declined for v1: crashes are rare on a supervised Node process, the turn-based game tolerates brief restarts via client reconnect, and adding Redis doubles the ops surface on a 3-day budget. The engine is pure `(state, action) → state` specifically so Redis can be added in a future pass — snapshot `GameState` keyed by `roomId` after every `applyAction`, delete on cleanup.

This section covers **process health**, not game durability.

### Global handlers

```typescript
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting')
  void shutdown(1)
})
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandled rejection — exiting')
  void shutdown(1)
})
```

Let the process die. Don't try to recover — zombie state is worse than a clean restart.

### Supervisor

`pm2` inside the Docker container.
- `autorestart: true`
- `max_restarts: 10`, `min_uptime: 10s` — stop restarting after 10 failures in tight succession; that's a bug, not a blip.
- `kill_timeout: 8000` — 8 s for graceful shutdown before SIGKILL.

### Graceful shutdown (`shutdown(exitCode)`)

1. Stop accepting new connections: `httpServer.close()`.
2. Close all SSE responses with a final `event: shutdown` + `retry: 3000`.
3. Broadcast close code `1001` to every game WS.
4. Drain: poll for 5 s for every socket's `bufferedAmount === 0`, then `ws.terminate()` stragglers.
5. Clear all room and cleanup timers.
6. `process.exit(exitCode)`.

SIGTERM from Docker / pm2 → `shutdown(0)`. Uncaught errors → `shutdown(1)`.

### Logging

Structured JSON to stdout via `pino`. Every line carries `roomId` where scoped, `sessionId` where available, `flowId` on HTTP paths. No PII beyond chosen display names. Docker captures → CloudWatch Logs in prod (Section 7).

## 4.6 — Security & input validation

### Trust boundaries

- **`sessionId` is self-asserted.** Client-generated UUID v4. Server treats matching sessions as "probably the same browser." Any request can claim any session — by design, there's no auth. A malicious client with another player's UUID can impersonate them. Mitigations: WSS + HTTPS only (enforced by nginx), never logged at info level, never shown in UI.
- **Host privilege** is `sessionId === room.hostSessionId`. Same caveat.
- Documented as a v1 limitation. Real auth is the "add accounts later" branch in the locked architecture.

### Input validation

Every HTTP body parsed with Zod. Examples:

- `playerName`: 1–20 chars, Unicode letters/digits/spaces only, trimmed.
- `displayName`: 1–40 chars, same character class.
- `config.maxPlayers`: integer 2–8.
- `config.stockPileSize`: integer in `{10, 15, 20, 30}`.
- Invalid → 422 with Problem+JSON detailing the bad field.

Size caps: bodies > 4 KB → 413. WS already enforces 16 KB `maxPayload`.

### Room code format

- 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 chars — no `0/O/1/I/L`). 32⁶ ≈ 1.07 × 10⁹.
- Generated via `crypto.randomInt` with retry-on-collision. At 1000 active rooms, collision probability per attempt ≈ 10⁻⁶.
- Case-insensitive on lookup; stored uppercase.

### CSWSH / origin

Section 3's game-WS Origin allowlist (Vercel domain) is mirrored on REST via CORS preflight + `Access-Control-Allow-Origin: <vercel-domain>`.

### Rate limits

Detailed in §4.3. Buckets keyed on `(sessionId, IP)` — escaping needs both changed.

### Name squat / impersonation

Invariant 5 in §4.5 (one session = one seat across all rooms) prevents single-session lobby squatting. Duplicate display names collide per Question 6 answer (i) — suffix with `"(2)"`.

### Not addressed in v1

- CAPTCHA / bot sign-up prevention — no accounts, no stakes.
- Abuse reporting / kickvote — host has kick power, that's it.
- DoS beyond rate limits (Slowloris, connection flood) — nginx limits + WS `maxPayload` are the ceiling.

## Open items passed to later sections

| Deferred to | Item |
|-------------|------|
| Section 5 (AI) | Bot difficulty tiers, turn delay, action selection strategy. |
| Section 6 (Frontend) | Lobby page component tree, EventSource hook, room-create form layout. |
| Section 7 (AWS) | nginx config for `/v1/lobby/stream` (buffering off), systemd/Docker Compose wiring, CloudWatch integration. |
| Section 8 (Testing) | Integration-test harness for REST + SSE + WS choreography. |

## Deliverables at implementation time

1. `server/` TypeScript package under the repo — Node.js, `ws`, `pino`, `zod`.
2. `server/openapi.yaml` documenting every endpoint in §4.3.
3. Unit tests for `RoomManager` state transitions and invariants (Vitest, same harness as the engine).
4. Integration test spinning up the HTTP + SSE + WS surfaces against a real socket.
5. `Dockerfile` + `docker-compose.yml` for local development; prod deploy wiring in Section 7.
