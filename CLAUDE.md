# Skip-Bo

Browser multiplayer Skip-Bo card game. Part of John Moorman "10 projects 10 weeks" sprint; learning goals: real-time networking, from-scratch drag-drop, AWS deploy. **Build from scratch — no frameworks that abstract learning target.**

Repo: https://github.com/mojoro/skip-bo

## 🔖 Where we left off

**Live at https://skipbo.johnmoorman.com since 2026-04-19.** Section 7 (single-box AWS deploy) shipped — one Amazon Linux 2023 `t4g.small` in `eu-central-1`, two Docker containers (`web` = Next.js standalone, `srv` = the raw-`ws` server) behind host nginx terminating TLS via Let's Encrypt. Single origin; browser hits only `https://skipbo.johnmoorman.com` for HTML, REST, SSE, and WSS. Two-script deploy loop: one-time `deploy/bootstrap.sh` on the EC2 host, repeatable `deploy/deploy.sh` from the laptop that syncs `main`, rebuilds images, and reloads nginx. Full design + execution log in `docs/superpowers/specs/2026-04-19-aws-deploy-design.md` and `docs/superpowers/plans/2026-04-19-aws-deploy.md`; interview-prep companion in `docs/learning/`.

Sections 6 (shared Board + rematch) and 6.5 (lobby + AoE2-style pre-game room + LAN play) shipped earlier — landing page is the SSE-backed lobby, `/rooms/[roomId]` phase-branches between `<PreGameRoom>` (slot + config editing + chat + copy-able join code) and `<Board>` (playing with Leave + WinModal rematch). `docs/section-6-audit-fixes.md` and `docs/section-6.5-audit-fixes.md` cover the nine audit rounds.

**Next up — no major sections remaining.** Section 5 (real AI bots) was explicitly deferred; the random-legal stub at `server/src/game/bot.ts` is "good enough for now." Possible smaller work: close follow-up #15 (sessionId → `Sec-WebSocket-Protocol` header), widen `GameView.code` to nullable so `src/lib/view/fromEngine.ts` drops the `code: ''` workaround, or wrap `deploy.sh` in a GitHub Actions workflow. **AWS free plan expires 2026-10-19** — calendar reminder for 2026-09-19 (month 5) to decide upgrade-to-paid (~$13/mo) vs shutdown.

**Running it locally:** `npm --prefix server run build` then `npm --prefix server start` (tsx watch broken per #14). `npm run dev` at the root starts Next. LAN peers can connect at `http://<host-ip>:3000` without config — `src/lib/net/endpoints.ts` resolves the game server from the page's hostname, and the HTTPS branch drops the `:8787` suffix so the same code works in production behind nginx. To exercise the full prod image stack locally: `docker compose build && docker compose up -d`.

**Follow-ups:**
- #4. `patchRoomSchema` allows partial `config` merges that silently resize below seated count — drop `config` from PATCH or add config-aware handler.
- #6. DELETE `/v1/rooms/:id/members/:sessionId` returns 204 when target session not seated (no-op); consider 404 for clearer signal.
- #7. Slot handler validation order: Zod body parse before integer-index guard — cosmetic 422 type mismatch.
- #8. Branch coverage thin on slot + game handlers: no explicit 401 / 404 / 409 (phase) tests at handler level.
- #9. Module-level rate limiters in `server.ts` shared across tests within process. Audit-4 worked around with unique bearers; proper fix is an exported `resetLimiters()` helper.
- #11. SSE full-flow test reads raw chunks with `.includes(...)` rather than accumulating `\n\n`-delimited buffer; `reader.cancel()` + `httpServer.close()` not awaited at teardown.
- #14. `npm run dev` (tsx watch) fails — cross-package ESM/CJS boundary. Workaround: `npm --prefix server run build` then `npm --prefix server start`.
- #15. **First post-deploy task.** sessionIds still land in server attach/detach/rate-limit/action-error logs AND in the WS URL query string (nginx access logs capture them). Move to `Sec-WebSocket-Protocol` header per the Section 7 spec's Open follow-ups §1.
- #16. `normalizeRoomCode` only uppercases — does not strip whitespace. JoinByCodeForm should trim/collapse before calling it so `"AB CD"` works for a user who typed with a space.
- #17. `manager.ts` `onWaitingStateChange` comment says "fires after removeMember" but the empty-room deletion path returns before calling `emitStateChange` — comment is stale (no runtime bug, just misleading).
- #18. `broadcastRoomState` computes `seats` before the per-connection loop; if `buildSeats` throws the entire fan-out silently aborts. Low risk today but violates the stated resilience guarantee.
- #19. `GameView.code: string` (non-nullable) in `src/lib/net/protocol.ts:72` forces `src/lib/view/fromEngine.ts:62` to use `code: ''` for local hot-seat games. Widen to `string | null` and audit consumers.
- #20. `server/src/config.ts` reads `WS_BASE_URL`; `server/src/http/handlers/members.ts:33` echoes it back as a `wsUrl` response field that no client code consumes. Either set `WS_BASE_URL=wss://skipbo.johnmoorman.com` in `docker-compose.yml` or drop the field.
- #21. CI/CD via GitHub Actions — workflow wrapping `deploy/deploy.sh` via SSH agent action. See Section 7 spec Open follow-ups §2.
- #22. AWS free plan expires 2026-10-19 — decide upgrade-to-paid or take-down before then.

**Audit 3+4 closed** #1, #2/#3, #5. **Section 7 closed** #10 (root `.dockerignore` exists), #13 (root `tsconfig.json` now excludes `server/`).

**State:** main-app suite 148/148, server suite 153/153, both typechecks clean, live URL serves HTTP/2 with A-grade TLS.

## Status snapshot

- **Engine (done):** pure TypeScript module under `src/lib/game/`. Deterministic mulberry32 shuffle, ruleset enum (recommended / official), partnership mode with 3 permission flags. 60 Vitest tests covering deck composition, createGame defaults, PLAY_TO_BUILD across sources/directions, DISCARD + turn advance, win condition singles + partnerships, PlayerView visibility.
- **UI (done, single-player hot-seat):** desktop tabletop layout (green felt + wood frame, seats around table) for 2-4 players; compact stacked layout (opponents scroll above, active zone pinned bottom) on mobile always + desktop when 5+ players. Mattel card palette. Responsive via Tailwind `md` breakpoint + runtime player-count check.
- **Drag and drop (done):** custom stack under `src/lib/dnd/` — no library. Pointer Events with movement threshold, imperative transform on floating ghost, rect-based hit-test, Escape cancels. `DragDropProvider` / `useDraggable` / `useDroppable`.
- **Modals (done):** `NewGameModal`, `RulesetInfo`, `ConfirmDialog` (end-turn confirm), `WildDirectionPicker` (inline asc/desc choice, replaces `window.confirm`).
- **Networking — Room Manager + Lobby (done):** `server/` package with REST (rooms/members/slots/game), SSE lobby stream with snapshot+deltas+heartbeat, in-memory `RoomManager` (idle + post-game cleanup, host migration), Zod schemas, Problem+JSON errors, token-bucket rate limits, graceful shutdown, esbuild+pm2+Dockerfile. 69 Vitest tests including full-flow integration test. OpenAPI 3.1 spec at `server/openapi.yaml`.
- **Networking — game WebSocket + client hook (done):** `server/src/game/` adds raw-`ws` upgrade handler, per-socket `GameConnection`, `GameRegistry`, pure dispatch, per-slot 60 s grace, bot takeover (random legal move stub), full-flow integration tests. Client `useGameSocket` hook handles exponential backoff, terminal-code-aware reconnect, visibility-driven resume, bounded send queue. Hot-seat demo moved to `/local`; `/rooms/[roomId]` renders networked state.
- **Shared Board + rematch (done):** `src/components/Board.tsx` is the single tabletop renderer consumed by both `/local` (local engine dispatch via `src/lib/view/fromEngine.ts`) and `/rooms/[roomId]` (socket dispatch). `SeatViewModel` in `src/lib/view/seat.ts` unifies self/opponent/empty seat shape. WinModal is actions-based — callers pass `WinModalAction[]`. Rematch flow: client sends `requestRematch` over the still-alive post-finish socket, server creates a new room via `RoomManager.createRematchRoom` (fresh seed, seated humans preserved at their slot indices, bot-controlled until they attach, first human to attach claims host via `migrateHostAwayFromBot`), broadcasts `rematchReady`. Old room lives ~5 min then `deleteRoom` closes any lingering sockets with 4005.
- **Lobby + pre-game room (done):** Landing page at `/` is now a lobby: SSE-subscribed public rooms list (`useLobbyStream` → `/v1/lobby/stream`), create-room form (opens `NewGameModal`, POSTs to `/v1/rooms`), join-by-code form, display-name gate backed by localStorage. `/rooms/[roomId]` phase-branches on `socket.view.view === null`: waiting → `<PreGameRoom>` (slot list with host dropdown, config summary with host edit, chat panel, start-game button); playing → `<Board>`. Handshake accepts both `waiting` and `playing` phase; `broadcastRoomState` fans out `state` frames over all connected sockets on every REST mutation and game start.
- **Production deploy (done):** Live at `https://skipbo.johnmoorman.com`. Single Amazon Linux 2023 `t4g.small` in `eu-central-1`. Two Docker containers (`web` Next.js standalone + `srv` raw-ws server) behind host nginx terminating TLS via Let's Encrypt (webroot ACME). `deploy/bootstrap.sh` does one-time host setup (Docker, buildx, Compose, swap, cert, nginx); `deploy/deploy.sh` does repeatable deploys from the laptop (git reset, docker compose rebuild, nginx sync + reload, health checks). Single origin keeps CORS out; nginx routes by path. TLS config follows Mozilla Intermediate 2026 (TLS 1.2/1.3, HSTS 2yr, security headers). OCSP stapling intentionally omitted — Let's Encrypt sunsetted OCSP on 2025-08-06.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind 4 · Vitest · no DnD library · raw `ws@8` on server.

## Commands

Root (Next.js app):

```
npm run dev        # next dev
npm test           # vitest run (148 tests)
npm run test:watch # watch mode
npm run lint       # ESLint
npx tsc --noEmit   # typecheck (clean)
```

Server (WS + REST):

```
cd server
npm run build && npm start   # esbuild → node dist/index.js (tsx watch is broken, follow-up #14)
npm test                     # vitest run (153 tests)
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

Deploy + infrastructure (repo root):

```
Dockerfile.web              # Next.js standalone build → web container
docker-compose.yml          # orchestrates web + srv on the host
.dockerignore               # keeps both image build contexts lean
server/Dockerfile           # esbuild + pm2-runtime image for the WS+REST server
deploy/
├── bootstrap.sh            # one-time Amazon Linux 2023 host setup
├── deploy.sh               # repeatable laptop → host deploy + nginx sync
├── nginx.conf              # production nginx (TLS, WS upgrade, security headers)
└── README.md               # operations runbook
```

## What's next (prioritized)

No major sections remain. Remaining items are small cleanups from the follow-ups list.

### 1. Close follow-up #15 (first post-deploy task)

Move sessionId out of the WS URL query into the `Sec-WebSocket-Protocol` header. Server reads from `req.headers['sec-websocket-protocol']`; client passes as second arg to `new WebSocket(url, ['session.' + sessionId])`; server selects + echoes the protocol in the 101 response. Closes sessionId-in-nginx-access-logs exposure. ~2–3 hrs incl tests. See Section 7 spec "Open follow-ups" §1.

### 2. GitHub Actions wrap around deploy.sh

Stash the SSH key in GitHub Secrets, write `.github/workflows/deploy.yml` that runs the same host-side commands on push to main. Cleanly a v2 of the deploy story — no rewriting.

### 3. UI polish (deferred by user)

Useful but not ship gates:
- Highlight valid build/discard targets when card selected or dragged.
- Card-fly animation on play.
- Turn transition banner between hot-seat handoffs.
- Scoreboard across games.

### 4. Account-expiry decision (2026-09-19)

AWS free plan expires 2026-10-19. Calendar reminder for 2026-09-19 to pick: upgrade to paid (~$13/mo t4g.small on-demand in eu-central-1), migrate to a cheaper host, or take Skip-Bo offline.

## Locked design references

- `docs/design-session-progress.md` — brainstorming progress. Sections 1 (engine), 2/3 (WS protocol), 4 (Room Manager), 6 (Frontend — shared Board + rematch), 6.5 (lobby + pre-game), 7 (AWS deploy) **approved + shipped**. Section 5 (AI) **deferred**; Section 8 (Testing) **not drafted**.
- `docs/game-websocket-audit-fixes.md` — four audit passes over Section 3, every finding + fix documented with commit SHAs and file:line cites.
- `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md` — Section 4 spec (shipped). Reference for style.
- `docs/superpowers/specs/2026-04-18-game-websocket-design.md` — Section 3 spec (shipped). Reference for style.
- `docs/superpowers/specs/2026-04-19-aws-deploy-design.md` — Section 7 spec (shipped). Reference for deploy design intent.
- `docs/superpowers/plans/2026-04-17-room-manager-lobby.md` — Section 4 plan (executed Tasks 1–24). Reference for task granularity.
- `docs/superpowers/plans/2026-04-18-game-websocket.md` — Section 3 plan (executed). Reference for task granularity.
- `docs/superpowers/plans/2026-04-19-aws-deploy.md` — Section 7 plan (executed by Codex with 4 discovered fixes beyond plan).
- `docs/learning/` — interview-prep conceptual companion covering EC2, Docker, nginx, TLS/Let's Encrypt, and the deploy workflow.
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
- No persistence — all state in-memory on server, no DB. Deploys drop in-flight games.
- `/rooms/[roomId]` renders the full tabletop via the shared Board component; rematch works over the same socket post-finishGame.
- AI is a random-legal stub — Section 5 (real strategy) was deferred per user call.
- Production deploy: single box, single origin, single point of failure — appropriate for hobby scale. Scaling beyond ~100 concurrent players would need a registry-backed multi-instance setup and a shared room state store.
- AWS free plan expires 2026-10-19 — set reminder for 2026-09-19 to decide upgrade/shutdown (see follow-up #22).
- `demo-snapshot` branch preserved locally (pre-rebase state), not pushed.