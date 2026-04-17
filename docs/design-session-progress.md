# Skip-Bo Game — Design Session Progress

> **Resume instructions (fresh Claude — read this first):**
>
> 1. Read `CLAUDE.md` in repo root for the full status snapshot.
> 2. Sections 1, 2 (rewritten as 3), 3, and **4 are approved**. Section 4 spec lives at `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md`. Next up is **Section 5: AI Bot Engine** — invoke `superpowers:brainstorming` and pick up there.
> 3. After all design sections are approved, each gets its own spec doc under `docs/superpowers/specs/`, self-review, user approval, then `superpowers:writing-plans`.
> 4. Sections 1 and 3 are partially implemented as an offline hot-seat demo — see "Implementation status" below so you don't re-discuss solved problems.
>
> **Don't re-brainstorm approved sections.** Confirm which section is next, ask clarifying questions there, and continue.

## Implementation status since brainstorming started

A full offline hot-seat demo was built between brainstorming Section 3 and returning to Section 4. Treat everything in this list as *done* and *reviewed by the user*; don't re-architect.

- **Engine (Section 1)** — implemented as a pure TypeScript module in `src/lib/game/`. Deterministic mulberry32 shuffle. Ruleset enum `recommended` / `official`. Partnership mode with three permission flags. 60 Vitest tests covering deck, createGame, PLAY_TO_BUILD, DISCARD + turn advance, win condition (singles and partnerships), and PlayerView hiding.
- **WebSocket protocol (Section 2 → rewrote as Section 3)** — design-only, **not yet implemented**. The rewrite added: HTTP Upgrade origin check (CSWSH), protocol-level `ws.ping()` heartbeat, close codes (1000/1008/1009/4001-4005), backpressure cap via `bufferedAmount`, 16 KB `maxPayload`, token-bucket rate limit, 60s disconnect grace window, duplicate-session kick (4004), state version numbers on broadcasts, exponential backoff + jitter reconnect. See the rewritten Section 3 further down in this file.
- **Architecture (Section 3 original)** — two-service split (Vercel Next.js + AWS EC2 Node `ws` server) — approved, **server side not yet built**.
- **UI (partial Section 6)** — built without a formal brainstorm. Desktop "tabletop" layout (green felt, wood frame, seats absolute-positioned around the center) for 2-4 players. Compact stacked layout (opponents scroll above, active zone pinned bottom) for mobile always and desktop when 5+ players. Mattel-style card palette. **When we reach Section 6, treat it as a write-up of the shipped UI, not a fresh design.**
- **Drag and drop** — custom stack under `src/lib/dnd/`, no library. Pointer Events with movement threshold, imperative ghost transform, rect-based hit-test, Escape cancels. `DragDropProvider` + `useDraggable` + `useDroppable`. Inline `WildDirectionPicker` (replaces `window.confirm`).
- **Modals** — `NewGameModal`, `RulesetInfo`, `ConfirmDialog` (end-turn confirm).
- **Repo** — pushed to https://github.com/mojoro/skip-bo (public). `main` is the single branch; `demo-snapshot` preserved locally.

- **Room Manager + Lobby (Section 4)** — designed, **not yet implemented**. Full spec at `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md`. REST endpoints (Zalando-aligned, versioned `/v1/`), SSE lobby stream with deltas, host-controlled slots, 30-min idle + 5-min post-game cleanup, pm2 supervision + graceful shutdown, Problem+JSON errors, camelCase JSON, `Authorization: Bearer <sessionId>`. OpenAPI 3.1 yaml is a deliverable at build time.

**Still to build:** server, client WS hook, room manager + lobby implementation (Section 4 spec'd), AI bots (Section 5), frontend architecture write-up (Section 6), AWS deploy (Section 7), testing strategy for the network layer (Section 8). UI polish list lives in `CLAUDE.md`.

## Project Context

- **Owner:** John Moorman (johnmoorman@gmail.com)
- **Portfolio:** https://johnmoorman.com/work/
- **Goal:** Part of a "10 projects in 10 weeks" sprint for mid-level fullstack interview prep
- **Timeline:** 3 days
- **Key learning targets:** Real-time WebSocket plumbing, AWS deployment, game state management, AI opponents — specifically filling gaps in deployment/networking interview knowledge

## Hard Constraints

- **No accounts/auth** for now. Architecture should allow adding later.
- **No managed game frameworks** (no Colyseus, no PartyKit). John wants to build the networking/room management/state sync himself — that IS the learning goal.
- **No Socket.IO.** Raw `ws` library. Learn the protocol from the ground up.
- **Visual polish level:** B — polished card game feel with animations (Framer Motion), card faces with numbers, responsive. Not high-fidelity textures/particles but well beyond a prototype.
- **AI bot opponents:** Yes, rule-based. Required for solo play.
- **Up to 8 players** per game.
- **Lobby system** so strangers can find open games.

## Decisions Locked

### Architecture: Two Services

| Service | Responsibility | Deployed to |
|---|---|---|
| **Next.js frontend** | All UI — lobby, game board, rules/landing. No game logic. | Vercel |
| **Node.js game server** | All game state, validation, room management, AI. HTTP endpoints for lobby + WebSocket for gameplay. | AWS EC2 |

```
┌─────────────────────────┐       ┌──────────────────────────────────────┐
│  Next.js (Vercel)       │       │  AWS EC2                             │
│                         │       │  ┌──────────────────────────────┐    │
│  - Lobby UI             │  WSS  │  │ nginx (reverse proxy + SSL)  │    │
│  - Game Board           │◄─────►│  └──────────┬───────────────────┘    │
│  - Landing page         │       │             ▼                        │
│                         │  HTTPS│  ┌──────────────────────────────┐    │
│  REST ──────────────────┼──────►│  │ Docker: Node.js game server  │    │
│                         │       │  │  - ws WebSocket server       │    │
│                         │       │  │  - Room manager              │    │
│                         │       │  │  - Game engine               │    │
│                         │       │  │  - AI bots                   │    │
│                         │       │  └──────────────────────────────┘    │
└─────────────────────────┘       └──────────────────────────────────────┘
```

**Why two services:** Next.js on Vercel is serverless — can't hold WebSocket connections. Game server needs long-lived connections and in-memory state. This split is a real interview talking point about serverless limitations.

**Why AWS EC2 (not Railway/Fly.io):** John's interview weakness is deployment/networking. EC2 gives hands-on experience with security groups, SSH, nginx reverse proxy (including WebSocket `Upgrade` header proxying), SSL via Let's Encrypt, Docker. These are all common interview topics.

### Game State Machine (Section 1 — APPROVED)

**Design principle:** Pure functions. `(state, action) => newState`. No side effects, no WebSocket awareness.

```typescript
type GameEngine = {
  createGame(config: GameConfig): GameState
  applyAction(state: GameState, action: GameAction): GameState | GameError
  getPlayerView(state: GameState, playerId: string): PlayerView
}

interface GameConfig {
  stockPileSize: number         // default 20, variants: 10, 15, 30
  handSize: number              // default 5, some play with 7
  maxPlayers: number            // 2-8
  bidirectionalBuild: boolean   // default true
}

interface GameState {
  phase: 'waiting' | 'playing' | 'finished'
  drawPile: Card[]
  buildPiles: BuildPile[]       // 4 shared piles
  players: PlayerState[]
  currentPlayerIndex: number
  turnPhase: 'draw' | 'play' | 'discard'
}

interface BuildPile {
  cards: Card[]
  direction: 'asc' | 'desc' | null  // null = empty, awaiting first card
}

// Bidirectional build rules:
// - First card on empty pile must be 1 or 12 (or wild)
// - Placing 1 locks direction to ascending (1→12)
// - Placing 12 locks direction to descending (12→1)
// - Complete pile (reaches 12 ascending or 1 descending) → recycled into draw pile
// - Skip-Bo wilds can be played as any number in either direction

interface PlayerState {
  id: string
  stockPile: Card[]             // win condition: empty this
  hand: Card[]                  // up to handSize cards
  discardPiles: Card[][]        // 4 personal discard piles
}

type GameAction =
  | { type: 'DRAW' }
  | { type: 'PLAY_TO_BUILD'; source: CardSource; buildPileIndex: number }
  | { type: 'DISCARD'; handIndex: number; discardPileIndex: number }

type CardSource =
  | { from: 'hand'; index: number }
  | { from: 'stock' }
  | { from: 'discard'; pileIndex: number }
```

**Information hiding:** `getPlayerView()` filters the full state per player — they see their own hand, top of their stock pile, public build piles, and opponent card counts only. Prevents cheating.

**Turn structure:** Draw up to handSize → play cards to build piles (optional, repeatable) → discard to end turn. If hand empties during play, draw handSize more and continue.

**Validation:** `applyAction` returns `GameState | GameError`. Invalid moves rejected with descriptive errors. Client can optimistically validate but server is authoritative.

**Phase transitions:**
```
waiting ──(host starts game)──► playing ──(stock pile emptied)──► finished
                                   │                                 │
                                   └──(all but one disconnected)─────┘
```

### WebSocket Protocol (Section 2 — APPROVED)

JSON messages over raw WebSocket. No binary encoding — payloads are ~1-2KB, human-readable for debugging in DevTools.

```typescript
// Client → Server
type ClientMessage =
  | { type: 'JOIN_ROOM'; payload: { roomId: string; playerName: string } }
  | { type: 'GAME_ACTION'; payload: GameAction }
  | { type: 'CHAT'; payload: { text: string } }
  | { type: 'PING' }

// Server → Client
type ServerMessage =
  | { type: 'ROOM_STATE'; payload: RoomInfo }
  | { type: 'GAME_STATE'; payload: PlayerView }
  | { type: 'ACTION_ERROR'; payload: { message: string } }
  | { type: 'PLAYER_JOINED'; payload: { playerName: string } }
  | { type: 'PLAYER_LEFT'; payload: { playerName: string } }
  | { type: 'CHAT'; payload: { playerName: string; text: string } }
  | { type: 'PONG' }
```

**Full PlayerView broadcast after every action.** No delta patching — state is small enough.

**Heartbeat:** Client sends PING every 15s, server responds PONG. Server marks client disconnected after 45s silence.

**Reconnection:** `sessionId` in localStorage. Reconnecting player gets their seat restored + current GAME_STATE. No replay log needed for turn-based.

## Remaining Design Sections (NOT YET DISCUSSED)

### Section 4: Room Manager & Lobby — **APPROVED**
Full spec: `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md`. See "Implementation status" above for the summary.

### Section 5: AI Bot Engine
- Rule-based strategy
- How bots participate (same interface as human players, just server-side)
- Difficulty levels or single strategy
- Turn timing (artificial delay so it feels natural)

### Section 6: Frontend Architecture
- Next.js App Router structure
- Client-side WebSocket hook
- Game board component hierarchy
- Animation strategy (Framer Motion)
- Responsive design approach

### Section 7: AWS Deployment
- EC2 setup, security groups, Docker
- nginx config for reverse proxy + WebSocket upgrade
- SSL with Let's Encrypt
- CI/CD (GitHub Actions or manual deploy)
- Environment variables, CORS

### Section 8: Testing Strategy
- Unit tests for pure game engine (the easy win)
- Integration tests for WebSocket protocol
- What NOT to test given 3-day timeline

## Research References

| Project | Stack | Notes |
|---|---|---|
| [schrockwell/skipbot](https://github.com/schrockwell/skipbot) | Elixir/Phoenix | Multiplayer Skip-Bo. Uses Phoenix Channels. |
| [georgiee/skipbo-typescript-jest](https://github.com/georgiee/skipbo-typescript-jest) | TypeScript | Game engine only — no multiplayer, no UI. Clean state machine with tests. Good logic reference. |
| [TimVervoort/Skip-Bo](https://github.com/TimVervoort/Skip-Bo) | HTML/CSS/JS | Single-player browser version. Bad UX/rules per John — only reference card designs if at all. |

## User Preferences (Important for Continuing)

- **Autonomous operation.** Make reasonable assumptions, don't ask unless it's destructive or architectural.
- **Separate bash commands.** Never chain with && or ;.
- **Atomic commits.** One logical change per commit. No Co-Authored-By lines.
- **Build from scratch.** Don't recommend frameworks that abstract away the learning goals (networking, WebSockets, deployment).
- **Interview-optimized.** Clean architecture, separation of concerns, things worth talking about in code reviews and interviews.
