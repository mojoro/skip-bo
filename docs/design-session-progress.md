# Skip-Bo Game — Design Session Progress

> **Resume instructions:** This file captures a brainstorming session for a browser-based multiplayer Skip-Bo card game. The brainstorming skill (`superpowers:brainstorming`) is in progress. Sections 1-3 of the design have been approved by the user. Continue from **Section 4: Room Manager & Lobby** below. After all sections are approved, write the design doc to `docs/superpowers/specs/`, self-review, get user approval, then invoke the `superpowers:writing-plans` skill.

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

### Section 4: Room Manager & Lobby
- How rooms are created, listed, joined
- HTTP endpoints for lobby operations
- Room lifecycle (create → fill → playing → finished → cleanup)
- How the lobby page polls/subscribes for room list updates

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
