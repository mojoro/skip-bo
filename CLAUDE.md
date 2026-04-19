# Skip-Bo

Browser multiplayer Skip-Bo card game. Part of John Moorman "10 projects 10 weeks" sprint; learning goals: real-time networking, from-scratch drag-drop, AWS deploy. **Build from scratch — no frameworks that abstract learning target.**

Repo: https://github.com/mojoro/skip-bo

## 🔖 Where we left off

Section 6.5 (lobby + AoE2-style pre-game room) shipped on `feature/section-6.5-lobby`. Landing page is now the lobby (SSE-backed public rooms list, create/join forms, display-name gate). `/rooms/[roomId]` phase-branches between `<PreGameRoom>` (waiting) and `<Board>` (playing). Game WS handshake now accepts waiting-phase connections so one socket covers both views — `broadcastRoomState` fans out a state frame to every connected waiting-phase socket whenever a REST mutation fires (join/leave/slot-change/config-patch/start).

**Next up — Section 5 (AI bots).** Random-legal stub at `server/src/game/bot.ts`. Replace with rule-based / heuristic strategy. Same `applyAction` contract. Section 7 (AWS deploy) after that.

**Running it locally:** `npm --prefix server run build` then `npm --prefix server start` (tsx watch broken per #14). Next dev needs `.env.local` at repo root with both `NEXT_PUBLIC_GAME_WS_URL=ws://localhost:8787` and `NEXT_PUBLIC_GAME_API_URL=http://localhost:8787`.

**Follow-ups:**
- #4. `patchRoomSchema` allows partial `config` merges that silently resize below seated count — drop `config` from PATCH or add config-aware handler.
- #6. DELETE `/v1/rooms/:id/members/:sessionId` returns 204 when target session not seated (no-op); consider 404 for clearer signal.
- #7. Slot handler validation order: Zod body parse before integer-index guard — cosmetic 422 type mismatch.
- #8. Branch coverage thin on slot + game handlers: no explicit 401 / 404 / 409 (phase) tests at handler level.
- #9. Module-level rate limiters in `server.ts` shared across tests within process. Audit-4 worked around with unique bearers; proper fix is an exported `resetLimiters()` helper.
- #10. Root `.dockerignore` missing — `docker compose build` at context `..` ships `node_modules`/`.next`/`.git` to Docker daemon. Add before first real image build.
- #11. SSE full-flow test reads raw chunks with `.includes(...)` rather than accumulating `\n\n`-delimited buffer; `reader.cancel()` + `httpServer.close()` not awaited at teardown.
- #13. Root `tsconfig.json` picks up `server/` TS files but lacks `@engine/*` alias (lives in `server/tsconfig.json`). Either exclude `server/` from root tsconfig or teach it alias.
- #14. `npm run dev` (tsx watch) fails — cross-package ESM/CJS boundary. Workaround: `npm --prefix server run build` then `npm --prefix server start`.
- #15. Audit-4 deferred: sessionIds still land in server attach/detach/rate-limit/action-error logs, no React-level test driving `useGameSocket` through mount/unmount/visibility, chat sanitizer only strips ASCII C0/DEL.
- #16. `normalizeRoomCode` only uppercases — does not strip whitespace. JoinByCodeForm should trim/collapse before calling it so `"AB CD"` works for a user who typed with a space.
- #17. `manager.ts` `onWaitingStateChange` comment says "fires after removeMember" but the empty-room deletion path returns before calling `emitStateChange` — comment is stale (no runtime bug, just misleading).
- #18. `broadcastRoomState` computes `seats` before the per-connection loop; if `buildSeats` throws the entire fan-out silently aborts. Low risk today but violates the stated resilience guarantee.

**Audit 3+4 closed these prior follow-ups:** #1 (setSlot displacement) via audit-3 #H, #2/#3 (finishGame cleanup) in Section 3 Task 2, #5 (`connected: false` semantics) resolved — means "not WS-attached".

**State:** server suite 139/139, main-app suite 138/138, server typecheck clean. Root `npx tsc --noEmit` still fails only on follow-up #13 (`@engine/*` alias).

## Status snapshot

- **Engine (done):** pure TypeScript module under `src/lib/game/`. Deterministic mulberry32 shuffle, ruleset enum (recommended / official), partnership mode with 3 permission flags. 60 Vitest tests covering deck composition, createGame defaults, PLAY_TO_BUILD across sources/directions, DISCARD + turn advance, win condition singles + partnerships, PlayerView visibility.
- **UI (done, single-player hot-seat):** desktop tabletop layout (green felt + wood frame, seats around table) for 2-4 players; compact stacked layout (opponents scroll above, active zone pinned bottom) on mobile always + desktop when 5+ players. Mattel card palette. Responsive via Tailwind `md` breakpoint + runtime player-count check.
- **Drag and drop (done):** custom stack under `src/lib/dnd/` — no library. Pointer Events with movement threshold, imperative transform on floating ghost, rect-based hit-test, Escape cancels. `DragDropProvider` / `useDraggable` / `useDroppable`.
- **Modals (done):** `NewGameModal`, `RulesetInfo`, `ConfirmDialog` (end-turn confirm), `WildDirectionPicker` (inline asc/desc choice, replaces `window.confirm`).
- **Networking — Room Manager + Lobby (done):** `server/` package with REST (rooms/members/slots/game), SSE lobby stream with snapshot+deltas+heartbeat, in-memory `RoomManager` (idle + post-game cleanup, host migration), Zod schemas, Problem+JSON errors, token-bucket rate limits, graceful shutdown, esbuild+pm2+Dockerfile. 69 Vitest tests including full-flow integration test. OpenAPI 3.1 spec at `server/openapi.yaml`.
- **Networking — game WebSocket + client hook (done):** `server/src/game/` adds raw-`ws` upgrade handler, per-socket `GameConnection`, `GameRegistry`, pure dispatch, per-slot 60 s grace, bot takeover (random legal move stub), full-flow integration tests. Client `useGameSocket` hook handles exponential backoff, terminal-code-aware reconnect, visibility-driven resume, bounded send queue. Hot-seat demo moved to `/local`; `/rooms/[roomId]` renders networked state.
- **Shared Board + rematch (done):** `src/components/Board.tsx` is the single tabletop renderer consumed by both `/local` (local engine dispatch via `src/lib/view/fromEngine.ts`) and `/rooms/[roomId]` (socket dispatch). `SeatViewModel` in `src/lib/view/seat.ts` unifies self/opponent/empty seat shape. WinModal is actions-based — callers pass `WinModalAction[]`. Rematch flow: client sends `requestRematch` over the still-alive post-finish socket, server creates a new room via `RoomManager.createRematchRoom` (fresh seed, seated humans preserved at their slot indices, bot-controlled until they attach, first human to attach claims host via `migrateHostAwayFromBot`), broadcasts `rematchReady`. Old room lives ~5 min then `deleteRoom` closes any lingering sockets with 4005.
- **Lobby + pre-game room (done):** Landing page at `/` is now a lobby: SSE-subscribed public rooms list (`useLobbyStream` → `/v1/lobby/stream`), create-room form (opens `NewGameModal`, POSTs to `/v1/rooms`), join-by-code form, display-name gate backed by localStorage. `/rooms/[roomId]` phase-branches on `socket.view.view === null`: waiting → `<PreGameRoom>` (slot list with host dropdown, config summary with host edit, chat panel, start-game button); playing → `<Board>`. Handshake accepts both `waiting` and `playing` phase; `broadcastRoomState` fans out `state` frames over all connected sockets on every REST mutation and game start.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind 4 · Vitest · no DnD library · raw `ws@8` on server.

## Commands

Root (Next.js app):

```
npm run dev        # next dev
npm test           # vitest run (96 tests)
npm run test:watch # watch mode
npm run lint       # ESLint
npx tsc --noEmit   # typecheck (root — still flags @engine/* under server/, follow-up #13)
```

Server (WS + REST):

```
cd server
npm run build && npm start   # esbuild → node dist/index.js (tsx watch is broken, follow-up #14)
npm test                     # vitest run (135 tests)
npx tsc --noEmit             # typecheck — clean
```

Networked client needs `.env.local` at the repo root:

```
NEXT_PUBLIC_GAME_WS_URL=ws://localhost:8787
```

Without it, `useGameSocket` falls back to `ws://<page-host>` and can't reach the server.

## Layout

```
src/
├── app/
│   ├── page.tsx            # Home + Board inner component
│   ├── layout.tsx
│   └── globals.css         # tabletop theme, felt/wood, card-back pattern
├── components/
│   ├── Card.tsx            # presentational, Mattel palette
│   ├── DraggableCard.tsx   # wraps Card with useDraggable
│   ├── DroppableZone.tsx   # wraps children with useDroppable
│   ├── DragGhost.tsx       # floating card following the pointer
│   ├── Seat.tsx            # desktop tabletop seat (absolute-positioned)
│   ├── TableCenter.tsx     # desktop draw/build/completed piles
│   ├── MobileBoard.tsx     # compact stacked layout
│   ├── MobileOpponentStrip.tsx
│   ├── WildDirectionPicker.tsx
│   ├── NewGameModal.tsx
│   ├── RulesetInfo.tsx
│   └── ConfirmDialog.tsx
├── lib/
│   ├── game/               # pure engine + tests
│   │   ├── types.ts
│   │   ├── rng.ts          # mulberry32
│   │   ├── deck.ts         # 162-card Skip-Bo deck
│   │   ├── engine.ts       # createGame, applyAction, getPlayerView
│   │   ├── testHelpers.ts
│   │   └── *.test.ts
│   ├── dnd/                # custom drag and drop
│   │   ├── context.tsx     # DragDropProvider, pointer listeners, ghost transform, hit-test
│   │   ├── hooks.ts        # useDraggable (pointerdown + threshold), useDroppable (registry)
│   │   └── types.ts        # DragSourceData, DropTargetData
│   └── layout/
│       └── seating.ts      # desktop seat presets for 2..8
└── docs/
    ├── design-session-progress.md   # networking design brief, locked sections
    └── superpowers/specs/           # brainstorming specs (if added)
```

## What's next (prioritized)

### 1. Lobby UI

Server lobby (REST + SSE at `/v1/rooms` + `/v1/lobby/stream`) is fully wired but the browser has no UI beyond the minimal landing page at `src/app/page.tsx`. Build:
- Public-waiting-rooms list driven by SSE subscription (`snapshot` + `roomAdded` / `roomUpdated` / `roomRemoved` / `stats` / `heartbeat` events).
- Create-room form → `POST /v1/rooms` → redirect to `/rooms/[roomId]`.
- Join-by-code flow → `POST /v1/rooms/by-code/{code}/members` + redirect.
- Presence: "N games in progress · M online" badge from the SSE `stats` event.
- Seat the "Play online" path from the /local WinModal which already routes to `/`.

Rematch rooms appear in the lobby when their visibility is `public` (see `RoomManager.createRematchRoom` — preserves source room's visibility). The 4003 handshake reject on stale old-room URLs is a known rough edge: if a user reloads after rematch, their session is remapped to the new room and the old URL bounces with "invalid session". Consider redirecting to the new room when `rematchBySourceRoom` has an entry — otherwise document as a follow-up.

### 2. Section 5 — AI bots (real strategy)

Random-legal stub exists at `server/src/game/bot.ts`. Replace with server-side rule-based or heuristic bot. Same `applyAction` contract. Artificial turn delay for natural feel. Ships solo play — half the UX cost for full game loop coverage.

### 3. Section 7 — AWS deploy

EC2 + Docker (`server/Dockerfile` already builds) + nginx reverse proxy with explicit `Upgrade` header forwarding (classic WS gotcha). Let's Encrypt SSL. CI/CD via GitHub Actions or manual deploy script. Post-deploy: set `CORS_ORIGIN`, switch client `NEXT_PUBLIC_GAME_WS_URL` to `wss://…`, close follow-up #15 sessionId-in-logs concern by moving out of URL query into a subprotocol or cookie.

### 4. UI polish (deferred by user)

Useful but not ship gates:
- Highlight valid build/discard targets when card selected or dragged.
- Card-fly animation on play.
- Turn transition banner between hot-seat handoffs.
- Scoreboard across games.

## Locked design references

- `docs/design-session-progress.md` — brainstorming progress. Sections 1 (engine), 2/3 (WS protocol), 4 (Room Manager), 6 (Frontend — shared Board + rematch) **approved + shipped**. Sections 5 (AI), 7 (AWS), 8 (Testing) **not drafted**.
- `docs/game-websocket-audit-fixes.md` — four audit passes over Section 3, every finding + fix documented with commit SHAs and file:line cites.
- `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md` — Section 4 spec (shipped). Reference for style.
- `docs/superpowers/specs/2026-04-18-game-websocket-design.md` — Section 3 spec (shipped). Reference for style.
- `docs/superpowers/plans/2026-04-17-room-manager-lobby.md` — Section 4 plan (executed Tasks 1–24). Reference for task granularity.
- `docs/superpowers/plans/2026-04-18-game-websocket.md` — Section 3 plan (executed). Reference for task granularity.
- `~/Documents/John-Brain/WebSocket-networking-deep-dive.md` — personal notes on stack from TCP up through WS, byte-level detail on Upgrade handshake + protocol-level framing.

## Conventions

- **Commits:** single-line subject, imperative completing "This commit will…", no body, no Co-Authored-By, no Conventional-Commits prefixes. If change won't fit 75 chars, split further. `git log --oneline` should read as build tutorial.
- **Atomic commits:** one logical change per commit. Commit as you go, not at end.
- **Build from scratch:** DnD was `@dnd-kit/react`, ripped out — hand-rolling is the point. Same for WebSocket: stick with raw `ws`.
- **Verify UI in-browser:** Playwright MCP screenshot at 390×844 (mobile) + 1280×800 (desktop) when change affects layout. Typecheck + tests not enough for visual claims.
- **Use context7 MCP for library docs** instead of guessing from training data.
- **Hot-seat first, networking later:** every engine action routes through `applyAction(state, action)`, same contract server will speak. Client dispatch swaps `useState` → `sendOverWS` with minimal change.

## Known constraints

- No auth / accounts (by design for v1 — sessionId sufficient).
- No persistence — all state in-memory on server, no DB.
- `/rooms/[roomId]` renders the full tabletop via the shared Board component; rematch works over the same socket post-finishGame.
- Lobby UI beyond the minimal landing page is not built yet — server has REST + SSE ready. See "What's next" §1.
- AI is a random-legal stub — Section 5 replaces it with real strategy.
- `demo-snapshot` branch preserved locally (pre-rebase state), not pushed.