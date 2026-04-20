# Skip-Bo

A browser-based multiplayer implementation of the Skip-Bo card game.

**Live:** [skipbo.johnmoorman.com](https://skipbo.johnmoorman.com)

This repository is the artifact of a deliberate learning exercise. The goal was not to ship the best Skip-Bo clone on the web, it was to take three topics I had only skimmed in prior work (real-time networking, drag-and-drop at the browser event layer, and production deploy on a plain Linux box) and build them from first principles rather than reach for the library that abstracts each one away. The README is structured accordingly: the sections below walk through each of those topics, the decisions made, and the trade-offs accepted.

## Context

The project was built during the first week of a ten-week portfolio sprint ("10 projects in 10 weeks"). The design goals and scope were set in advance:

1. Build the game engine as a pure TypeScript module with no UI concerns.
2. Build the drag-and-drop layer from scratch rather than install `@dnd-kit/react` or HTML5 Drag-and-Drop API.
3. Build the real-time multiplayer layer on raw `ws` rather than Socket.io, Colyseus, Partykit, or Supabase Realtime.
4. Deploy to a single EC2 instance with host-level nginx and Let's Encrypt rather than Vercel + Ably, Fly.io, or any managed PaaS that hides the networking.

The learning bet was that each constraint would force contact with fundamentals that the abstractions hide. That bet paid off on all four.

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────┐
│ Browser (React 19, Next.js 16 App Router, Turbopack)    │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Pure engine (src/lib/game) — deterministic        │  │
│  │ Drag-and-drop (src/lib/dnd) — pointer events      │  │
│  │ WebSocket hook (src/lib/net/useGameSocket)        │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │ HTTPS + WSS (single origin)
                          ▼
┌─────────────────────────────────────────────────────────┐
│ nginx (host level)                                      │
│  • TLS termination (Let's Encrypt, Mozilla Intermediate)│
│  • WS upgrade proxy (/rooms/:id/game)                   │
│  • SSE passthrough with buffering off (/v1/lobby/stream)│
│  • Routes REST to :8787, HTML/static to :3000           │
└─────────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐         ┌───────────────────────────┐
│ web container   │         │ srv container             │
│ Next.js         │         │ Node + raw ws             │
│ standalone      │         │ REST + SSE + WebSocket    │
│ :3000           │         │ RoomManager (in-memory)   │
│                 │         │ GameRegistry              │
└─────────────────┘         │ :8787                     │
                            └───────────────────────────┘
```

Both containers sit on one `t4g.small` Amazon Linux 2023 instance in `eu-central-1`. All traffic (HTML, REST, SSE, WebSocket) terminates at the same origin, which eliminates CORS from the architecture.

## Stack

| Layer      | Choice                                                            |
| ---------- | ----------------------------------------------------------------- |
| Frontend   | Next.js 16 (App Router, Turbopack), React 19, TypeScript strict   |
| Styling    | Tailwind CSS 4                                                    |
| Game server| Node 20, raw `ws@8`, Zod, Pino, esbuild                           |
| Testing    | Vitest (148 main tests, 153 server tests), Playwright MCP for UI  |
| Deploy     | Docker Compose, host nginx, Let's Encrypt, EC2 t4g.small          |
| CI/CD      | Manual `deploy/deploy.sh` from laptop (GitHub Actions is planned) |

No state management library (React state and context only). No drag-and-drop library. No UI component library. No socket framework. Those were the deliberate constraints of the exercise.

## Design decisions

### 1. Game engine as a pure functional core

`src/lib/game/` is a self-contained module with no React, no DOM, no network. The signature is:

```ts
createGame(options): GameState
applyAction(state, action): GameState
getPlayerView(state, sessionId): PlayerView
```

Every state transition is a pure function. The randomness is bounded: a single `mulberry32(seed)` instance drives all shuffles and any future chance-based rules. Seed the game twice, get byte-for-byte identical play.

The payoff from keeping the engine pure:

- **60 unit tests run in under half a second.** No fixtures, no mocks. `applyAction` takes state and returns state; a test is three lines.
- **The hot-seat and networked variants share the engine verbatim.** `/local` dispatches actions through `useState`, `/rooms/:id` dispatches them through a WebSocket. The UI cannot tell the difference.
- **Server authority is a one-line change.** The server calls `applyAction` with the canonical state, rejects illegal actions at the engine boundary, broadcasts the new state. No re-implementation on the server side.
- **Deterministic replay is free.** During debugging, capturing the action log plus seed lets me reconstruct any game.

The ruleset is expressed as configuration (`GameConfig`) rather than branching logic, so switching between recommended and official Mattel rules is a prop change rather than a code change. Partnership mode (teams of 2 or more playing into shared build piles) is a three-flag permission system rather than a fork of the engine.

### 2. Drag-and-drop without a library

The hand-rolled stack under `src/lib/dnd/` does one thing: move a card from A to B with a pointer, get out of the way. Pointer Events (rather than separate mouse and touch listeners) unify laptop trackpad and phone screen behind one API.

**Architecture.** A single `DragDropProvider` mounts its window-level listeners once for the component tree's lifetime. State lives in an external `DragDropStore` class rather than React state, so a pointermove at 120Hz does not re-render every `useDroppable` consumer on the board. Each hook subscribes only to its own primitive slice (`isOver`, `isDragging`) through `useSyncExternalStore`, so only the component whose boolean actually changed re-renders.

**Performance.** Pointermove on a fast-finger drag fires at 120+ Hz on modern touch hardware. The handler is coalesced into a single `requestAnimationFrame` per paint: it caches the latest coordinates, schedules one frame, and inside the frame does the ghost transform, the rect-based hit-test against every registered drop target, and notifies subscribers if the hover slice changed. Without the rAF gate this was the single biggest source of jank on mid-range Android.

**Pointer capture.** When the movement threshold crosses (4 px by default), the drag grabs pointer capture on the source element. A fast drag that leaves the viewport or loses focus to the OS still routes pointerup back to the captured element, which keeps the listeners from orphaning.

**Accessibility gap.** There is no keyboard drag affordance. The game is usable with taps and clicks (every draggable has a click handler for a select-then-target flow), but a proper roving-tabindex keyboard drag is a known follow-up.

The code is ~200 lines total across four files. `@dnd-kit/react` would have shipped in a day. Writing it by hand took three, and it forced me to understand pointer capture, touch-action, stale closures in React 19, and the `useSyncExternalStore` contract at a level the library would have hidden.

### 3. Real-time multiplayer on raw `ws`

Next on Vercel cannot hold a long-lived WebSocket connection, and the game server's job is precisely to hold long-lived connections with in-memory state. So the multiplayer piece is a separate Node process under `server/`.

**One server, many protocols.** A single HTTP server handles REST (room lifecycle, slot management, chat history, admin actions), Server-Sent Events (the lobby stream pushes room-list deltas), and WebSocket (per-game connection, `/rooms/:id/game`). The upgrade handler verifies the session id from the handshake URL, runs an origin check (CSWSH defense), confirms the session owns a seat in the room, and attaches a `GameConnection` that owns the socket for its lifetime.

**Protocol.** Zod-validated client messages on the way in (`action`, `chat`, `requestRematch`), a tagged union of server messages on the way out (`hello`, `state`, `gameEnded`, `actionError`, `chat`, `rematchReady`). Every state broadcast carries a monotonically increasing `stateVersion`. The client drops frames whose version is strictly less than its watermark, which defends against the reconnect race that otherwise rewinds the UI to an earlier turn.

**Heartbeats at the protocol level.** `ws.ping()` / `ws.pong()` rather than a custom ping message. Browsers handle the pong transparently. The server pings every 25 seconds and terminates on the first missed pong, which means dead-connection detection runs in at most 50 seconds from the last successful round trip.

**Resilience details that earned their keep:**

- **16 KB `maxPayload`.** The largest legitimate game action is about 500 bytes. Anything over 16 KB gets dropped before the engine sees it.
- **Per-connection token buckets.** Separate budgets for game messages (10 burst, 5/s refill), chat (5 burst, 0.5/s refill), and illegal-action errors (3 burst, 1/s refill). A chatty client cannot starve the action path; a buggy client spraying illegal actions cannot drown out legitimate traffic.
- **REST rate limiter** keyed on compound `bearer::remoteAddress`. WS upgrade limiter keyed on remote IP only (the session id is not yet verified at handshake time, so an unverified value cannot key the bucket).
- **Disconnect grace.** 60 seconds. If a player's socket drops mid-game, the seat stays theirs; a random-legal-move bot takes their turns once grace expires so the game does not stall. They can reclaim the seat any time before the game ends by reconnecting.
- **Backpressure.** If a connection's buffered output exceeds 256 KB (slow consumer), the server closes it with 1008 rather than accumulating memory.
- **Rematch.** The finish screen keeps the socket alive. `requestRematch` creates a new room server-side with the same humans re-seated at their slot indices; the first human to attach claims host via the existing `migrateHostAwayFromBot` path.

**Client `useGameSocket` hook.** Exponential backoff with jitter for reconnects (`500 * 2^attempt` capped at 10 s, `×(0.5 + rand/2)` jitter). Bounded outbound queue of 32 messages (FIFO-evicts under backpressure so buggy clients cannot OOM their own tab). Watermark-based stale frame drop so out-of-order delivery during reconnect does not rewind UI state.

**Testing.** 153 server-side tests including full end-to-end integration flows that actually open WebSocket handshakes against a live ephemeral server, play out hot-seat turns, exercise disconnect grace by letting timers expire, and assert bot takeover.

### 4. Production deploy on a single box

A single `t4g.small` Amazon Linux 2023 instance in `eu-central-1`. Two Docker containers composed by `docker-compose`: `web` is the Next.js standalone build, `srv` is the esbuilt WebSocket server. Host-level nginx terminates TLS and routes by path. Let's Encrypt issues the certificate via the webroot ACME challenge.

Deploys run from my laptop with a two-script loop:

- `deploy/bootstrap.sh` does one-time host setup (Docker, buildx, Compose, swap, cert, nginx).
- `deploy/deploy.sh` is the repeatable deploy: git reset on the host, `docker compose up -d --build` to rebuild and replace the containers, nginx config sync, reload, health checks.

**Single-origin was a deliberate call.** Everything (HTML, REST, SSE, WebSocket) lives at `https://skipbo.johnmoorman.com`. That keeps CORS out of the architecture entirely, which is one less thing to think about when debugging.

**TLS is Mozilla Intermediate 2026.** TLS 1.2 and 1.3 only, 2-year HSTS, security headers, no OCSP stapling (Let's Encrypt sunsetted OCSP on 2025-08-06; certs issued after 2025-05-07 carry no OCSP responder URL). That configuration earns an A on SSL Labs out of the box, no hand-tuning.

**The trap I learned the most from** was the WebSocket upgrade through nginx. The `Upgrade` and `Connection` headers are hop-by-hop in HTTP/1.1, meaning proxies strip them by default. The handshake reaches Node missing exactly the signal that makes it a WebSocket handshake, Node returns 404 or 426, and the browser reports only "WebSocket connection failed" with no detail. The fix is explicit:

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

location ~ ^/rooms/[^/]+/game/?$ {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
}
```

`proxy_http_version 1.1` because nginx defaults to 1.0 for upstreams and WebSocket requires 1.1. The two `proxy_set_header` lines put the hop-by-hop headers back end-to-end. `proxy_read_timeout 3600s` because WebSocket connections are intentionally idle most of the time and nginx's 60-second default idle timeout would bounce every player off the server once a minute.

SSE needed its own tweak: `proxy_buffering off` on the lobby stream path, otherwise nginx buffers the upstream response and defeats the whole point of streaming.

**What I did not roll by hand.** nginx abstracts a great deal (TLS handshake, HTTP/1.1 and HTTP/2 parsing, TCP-level tuning, the reverse-proxy loop itself). I made a deliberate choice to keep those abstractions. Rolling TLS from scratch is an actively dangerous exercise; rolling an HTTP/2 server is weeks of work that would not advance the learning target. The honest framing is "I picked which abstractions to keep and which to lift the hood on, and here's why" rather than "I built it all from scratch."

## Repository tour

```
src/
├── app/                  # Next.js App Router pages + OG image
├── components/           # React UI (Board, Card, Seat, Lobby, PreGameRoom, ...)
└── lib/
    ├── game/             # Pure engine (createGame, applyAction, getPlayerView)
    ├── dnd/              # Hand-rolled drag-and-drop stack
    ├── net/              # Client networking (useGameSocket, useLobbyStream, API)
    ├── layout/           # Seat positioning for 2-8 players
    └── view/             # Engine → view-model adapters

server/
├── src/
│   ├── game/             # WebSocket handshake, connection, dispatch, broadcast
│   ├── room/             # RoomManager (in-memory), lifecycle, slot state
│   ├── http/             # REST handlers, middleware (auth, rate limit, CORS, body)
│   ├── sse/              # Lobby stream registry + ring buffer
│   └── index.ts          # Process entry point, wiring
├── openapi.yaml          # REST + SSE contract
└── tests/                # Vitest — 153 tests incl. full-flow integration

deploy/
├── bootstrap.sh          # One-time host setup
├── deploy.sh             # Repeatable laptop → EC2 deploy
├── nginx.conf            # Production nginx (TLS, WS upgrade, SSE, security headers)
└── README.md             # Operations runbook

docs/
├── design-session-progress.md      # Locked design brief
├── game-websocket-audit-fixes.md   # Four audit passes, every finding + fix
├── section-6-audit-fixes.md
├── section-6.5-audit-fixes.md
├── superpowers/specs/              # Design specs per section
├── superpowers/plans/              # Execution plans per section
└── learning/                       # Interview-prep companion (EC2, Docker, nginx, TLS)

Dockerfile.web                      # Next.js standalone image
server/Dockerfile                   # esbuild + pm2-runtime image
docker-compose.yml                  # Orchestrates web + srv
```

## Running locally

**First time:**

```bash
npm install
npm --prefix server install
```

**Main app (Next.js):**

```bash
npm run dev                  # next dev at http://localhost:3000
npm test                     # vitest run (148 tests)
npx tsc --noEmit             # typecheck
npm run lint                 # ESLint
```

**Game server (separate process):**

```bash
npm --prefix server run build
npm --prefix server start    # esbuild → node dist/index.js at :8787
npm --prefix server test     # vitest run (153 tests)
```

`tsx watch` does not work for the server yet (cross-package ESM/CJS issue, tracked as follow-up #14). Rebuild with `npm run build` after server changes.

No `.env.local` is required for dev. `src/lib/net/endpoints.ts` derives `ws://<page-host>:8787` from the page hostname, so both `localhost` and LAN IP loads resolve correctly. LAN peers connect to `http://<host-ip>:3000` without additional configuration.

**Full production stack locally (Docker):**

```bash
docker compose build
docker compose up -d
```

## Trade-offs (things deliberately not done)

**No persistence.** All room and game state lives in server memory. A deploy drops in-flight games. This is appropriate for the scale: a single-instance, hobby-scale deployment. Adding Redis or Postgres for durability would be a full redesign (stateful server behind a pub/sub bus, shared room registry, session resumption across instances). That is a different project.

**No real AI.** The bot takes a uniformly random legal move. That is enough for disconnect-grace takeover to keep the game from stalling, but the bot plays poorly. A proper minimax-with-heuristics bot was explicitly scoped out.

**No accounts.** Identity is a session id stored in `localStorage`. The security model is "whoever holds the session id owns the seat," which is fine for v1. Accounts would require a real auth system and an actual secrets store.

**Single-instance scale.** Everything fits in memory on one `t4g.small`. Scaling beyond ~100 concurrent players would need multi-instance with a shared registry. The code is structured so that migration is possible (RoomManager is a clean boundary), but no work toward it has been done.

**sessionId in the WebSocket URL query string.** The current handshake reads `?sessionId=` from the URL. That puts the session id in nginx access logs. The fix is to move it to `Sec-WebSocket-Protocol` (it is the first post-deploy follow-up).

## Planned follow-ups

| #   | Item                                                                           |
| --- | ------------------------------------------------------------------------------ |
| 15  | Move sessionId from WS URL query string to `Sec-WebSocket-Protocol` header     |
| 21  | Wrap `deploy/deploy.sh` in a GitHub Actions workflow                           |
| 12  | Keyboard drag affordance for the DnD layer (roving tabindex, space/arrows)     |
| —   | AI strategy: minimax with legal-move heuristics                                |
| —   | Persistence: optional Redis-backed RoomManager for survive-a-deploy guarantees |

## Testing philosophy

The engine has exhaustive unit tests because it is a pure function. The server has full-flow integration tests that run against a live ephemeral HTTP server with real WebSocket handshakes and real timer expirations, because the shape of the bugs there is timing-related and timing bugs do not show up in unit tests. The UI is verified with Playwright MCP at 390×844 (mobile) and 1280×800 (desktop) screenshots on every visual change, because typecheck and tests verify code correctness, not layout correctness.

I do not have time or value in writing DOM-heavy tests for React components that do not own state. Seat, Card, Lobby, PreGameRoom are visual. Playwright is the correct test surface for them.

## Learning documentation

`docs/learning/` contains my interview-prep companion. It walks through EC2, Docker, nginx, TLS and Let's Encrypt, and the deploy workflow at a level where I can explain each layer without hand-waving. The exercise of writing the "why" down was the test of whether I actually learned a thing or just copy-pasted a working config.

Related personal notes (outside this repo):

- `~/Documents/John-Brain/WebSocket-networking-deep-dive.md`: byte-level walkthrough from TCP up through the WebSocket framing layer, covering the Upgrade handshake and frame format.

## License and trademark

The code in this repository is mine. Skip-Bo® is a trademark of Mattel. This is an unofficial fan project, not affiliated with or endorsed by Mattel.

## Contact

John Moorman · [johnmoorman.com](https://johnmoorman.com) · [github.com/mojoro](https://github.com/mojoro)
