# 2026-04-20 — post-deploy polish pass

Follow-up session after the 2026-04-19 single-box AWS ship. Goal: take the
production site from "it runs" to "it looks and feels 2026." Shipped live on
`https://skipbo.johnmoorman.com` the same day (commit range `b64351c..f918287`,
27 atomic commits).

Test suite stayed green throughout: main-app 148/148, server 153/153,
`npx tsc --noEmit` clean.

## Themes

1. **Metadata & branding.** Replace create-next-app scaffolding with
   Skip-Bo brand assets (favicon, OG image, manifest, canonical URL, legal
   attribution).
2. **Desktop tabletop bugs.** Fix drag-drop drops that silently failed on
   desktop, restore the Ruleset modal that got lost in the Board refactor,
   add an actual rules tutorial, and fix a handful of visual regressions
   (card highlight clipping, seat orientation, header button overlap).
3. **Connection-loss UX.** Redirect 4003 sockets to the lobby instead of
   stranding the user on a dead-end panel; stop auto-booting a local game
   behind the user's back.
4. **In-game chat.** Wire a collapsible chat dock into the online game
   (the backend already supported chat; only the waiting room surfaced it).
5. **Mobile UX overhaul.** Eliminate the white Safari bars, stop the
   layout from locking the URL bar on-screen, and keep the chat dock above
   the virtual keyboard instead of heaving the page around.

## Commit-by-commit

### 1. Metadata & branding (`6ff4651…f687dd2`)

| Commit | Summary |
| --- | --- |
| `6ff4651` | Delete unused `public/*.svg` defaults from create-next-app. |
| `16ec151` | Brand favicon: `src/app/icon.svg` (navy card + gold "SB") plus `apple-icon.tsx` ImageResponse for iOS home screens. |
| `d9d879e` | `opengraph-image.tsx` (1200×630 ImageResponse: felt tabletop, wood frame, fanned card stack, headline, URL). `twitter-image.tsx` re-exports it. |
| `fe52942` | PWA `manifest.ts` with theme colors + `robots.ts`. |
| `f80007a` | `layout.tsx` upgraded: title template, `metadataBase`, OpenGraph, Twitter, keywords, canonical, robots + googleBot `max-image-preview: large`, `format-detection`. Split `themeColor`/`colorScheme` into the separate `Viewport` export Next 16 wants. |
| `f687dd2` | Global `SiteFooter` renders a small trademark attribution pill: *"Skip-Bo® is a trademark of Mattel · unofficial fan project · source"* with a GitHub link. |

### 2. Desktop tabletop bug cluster (`27dca39…253c212`)

| Commit | Summary |
| --- | --- |
| `27dca39` | **Root cause for "can drag but cannot drop."** `MobileBoardView` and the desktop `SeatView`/`TableCenter` both mount simultaneously and registered identical DnD target ids (`build-0`, `discard-target-…`). Whichever mounted last overwrote the other in the Map registry — and the overwritten targets were the `display:none` ones, which return zero-rect bounding boxes, so the hit test silently failed. Prefixed mobile ids with `m-` so both layouts coexist in the registry without collision. |
| `6d8870b` | Dropped `overflow-x-auto` from the hand row in `Seat.tsx` — browsers promote overflow-y to `auto` when one axis is non-visible, clipping the hover lift and the gold card-glow ring. Default `overflow: visible` restores both. |
| `240ad0c` | Rotate `side='left'` / `side='right'` seats by 180° (swapped `rotate-90` / `-rotate-90`) so players 2 and 4 face the table center the way a real player would. |
| `f79812f` | `/local` was positioning the *New Game* button with `absolute top-4 right-4 z-30`, which covered the new *Rules* / *Ruleset* buttons rendered inside the Board header at `z-20`. Moved the button through Board's existing `headerAction` prop so all header chrome lives in the same flex. |
| `cae4d55` | `RulesetInfo` still accepted the engine's private `GameConfig` (string-id teams, `seed`). Switched it to `PublicGameConfig` so the Board can pass `view.config` directly. |
| `c713b1f` | Restored the *Ruleset* modal behind a header button on the Board — originally lost during the `/local` → shared Board migration (`a6c0086`). |
| `f6a53d1` | Added `HowToPlay.tsx`, a tutorial-style modal (goal, zone, turn flow, wild cards, tactics, winning). Opens from a new *Rules* header button. *Rules* = tutorial, *Ruleset* = current game numbers. |
| `689a8d9` | Room page now redirects to `/` on close code 4003 (server's "invalid session / no slot"), instead of showing a dead-end "Disconnected" panel the user could only escape via browser chrome. |
| `253c212` | Favicon SB mark: `dominant-baseline="central"` + removed trailing `letter-spacing` so the glyph sits in the visual center of the card at 16×16. |

### 3. Connection-loss & local-game polish (`30a48fe…c244f29`)

| Commit | Summary |
| --- | --- |
| `30a48fe` | `/local` used to auto-start a default 2-player game on mount. Now it opens `NewGameModal` immediately; cancel on the initial visit navigates back to `/` instead of stranding the user on an empty felt. |
| `542a186` | Extracted the action-rejected toast (`fixed top-14, rose-900 bg`) into `ActionErrorToast.tsx` so both contexts stay in sync. `/rooms` already had it; just switched it to consume the shared component. |
| `c291fa5` | Surfaced local-game engine rejections on `/local` too — `applyAction({ok:false, error})` now feeds the same toast the online game uses. |
| `c244f29` | HowToPlay modal: restructure into `max-h-[90dvh] flex-col overflow-hidden` with a `shrink-0` pinned header + an `overflow-y-auto` body, so the header is flush with the modal top rather than scrolling content past it. |

### 4. Navigation & chat (`f1a04f8…3f94232`)

| Commit | Summary |
| --- | --- |
| `f1a04f8` | Wrapped the Board header "SKIP·BO" heading in a `<Link href="/">` with a gold hover affordance and an `aria-label="Back to lobby"` — universal escape hatch on both local and online games. |
| `3f94232` | New `GameChatDock.tsx`. Collapsed state = 44px circle at the felt's bottom-left with an SVG bubble + unread badge; expanded = a 320-wide panel with message list (auto-scroll to tail) + 200-char input. Board takes optional `chat?: ChatEntry[]` + `onSendChat?: (text) => void` props; `/rooms` passes `socket.chat` / `socket.sendChat`, `/local` leaves them undefined so no dock mounts. |

### 5. Mobile UX overhaul (`4f90646…9d93f56`)

Reported by the user from real-device testing: white bars top+bottom on iOS
Safari, Start Game button inaccessible in the waiting room because the URL
bar wouldn't dismiss, and the chat keyboard heaving the whole page around.

| Commit | Summary |
| --- | --- |
| `4f90646` | Mobile viewport baselines. `html`/`body` painted `var(--felt-deep)` so `viewport-fit: cover` safe-area regions stop flashing white. Dropped `body { overflow: hidden }` so waiting-room content can scroll when the URL bar squeezes the viewport. Added `overscroll-behavior: none` (no bounce chain), `-webkit-tap-highlight-color: transparent`, and `touch-action: none` on `.felt-surface` so Pointer-Events drag doesn't fight native scroll. Viewport export declares `interactiveWidget: 'resizes-content'` so modern browsers shrink the layout when the virtual keyboard opens. |
| `3526f37` | Tabletop restructure: wood-frame uses `h-[100dvh] flex flex-col`, felt-surface is `flex-1 min-h-0`. Inline `max(0.5rem, env(safe-area-inset-*))` padding on all four sides of the wood-frame means the felt naturally shrinks to fit notch + home indicator on iPhone. No more brittle `calc(100vh - 24px)` math. |
| `47f34fe` | Same dvh + safe-area treatment on the lobby, waiting room, landing page, and the `/rooms` frame wrapper — the scroll-based pages, where the real win is URL-bar dismissal and the *Start Game* button becoming reachable again. |
| `a6eeb98` | `SiteFooter` now pinned with `bottom: max(0.375rem, env(safe-area-inset-bottom))` so it sits above the iOS home indicator gesture bar instead of behind it. |
| `9d93f56` | Chat dock switched from `absolute` inside felt to `position: fixed` + `visualViewport` tracking. On browsers that honor `interactiveWidget: resizes-content` (Chrome, iOS 17.4+) the layout shrinks and `keyboardOffset` stays at 0. On older iOS Safari, `visualViewport.resize`/`scroll` events compute `layoutHeight - vv.height - vv.offsetTop` and the dock's `bottom` absorbs the difference, floating above the keyboard instead of the page lurching. Input also gets `enterKeyHint="send"`, `autoComplete="off"`, `autoCorrect="off"`. |

### 6. Deploy unblock (`f918287`)

Commit `6ff4651` deleted every file in `public/`, which left the directory
empty. Git doesn't track empty directories, so the host's build context
had no `public/` at all, and `Dockerfile.web`'s `COPY --from=build /app/public
./public` failed with *"/app/public: not found"* on the first deploy attempt.
Added `public/.gitkeep` so the directory is preserved.

## Known gaps after this session

- The in-game chat dock on mobile keeps the same 320-wide panel; on very
  narrow screens (<360px) the max-width clamp (`max-w-[92vw]`) handles it
  but the UX could benefit from a bottom-sheet full-width variant.
- `interactiveWidget: 'resizes-content'` has partial support. iOS 17.3 and
  earlier ignore it; the `visualViewport` fallback handles the chat dock,
  but other `fixed` elements (e.g. future overlays) would need similar
  treatment if they appear over the keyboard.
- The old trademark footer can collide with the chat dock button when both
  sit in the bottom-left area on narrow screens — not hit during this pass,
  acceptable for now.
- `RulesetInfo` team labels assume slot-indexed names; in a `/rooms`
  partnership game with renamed players it works, but the copy is still
  generic. Worth revisiting if partnership mode ever gets more airtime.

## Production state (2026-04-20)

- Live: `https://skipbo.johnmoorman.com` (HTTP/2 200 through nginx 1.28.3).
- Containers: `skip-bo-web` (Next.js standalone) recreated on deploy;
  `skip-bo-srv` (raw-ws) unchanged (image cache hit).
- Health checks pass: `:8787` ok, `:3000` ok.
- AWS free plan still expires 2026-10-19 — reminder for 2026-09-19 stands.

## Files touched

```
public/.gitkeep                        new
src/app/globals.css                    mobile viewport baselines
src/app/icon.svg                       new (favicon)
src/app/apple-icon.tsx                 new
src/app/opengraph-image.tsx            new
src/app/twitter-image.tsx              new
src/app/manifest.ts                    new
src/app/robots.ts                      new
src/app/layout.tsx                     metadata + viewport + SiteFooter
src/app/page.tsx                       dvh + safe-area
src/app/local/page.tsx                 NewGameModal gate + dvh + action error + toast
src/app/rooms/[roomId]/page.tsx        4003 redirect + toast extract + chat props + dvh
src/components/Board.tsx               Ruleset + Rules buttons, dvh, flex-1, chat dock, Link
src/components/HowToPlay.tsx           new (tutorial modal)
src/components/RulesetInfo.tsx         PublicGameConfig migration
src/components/ActionErrorToast.tsx    new (shared)
src/components/GameChatDock.tsx        new (collapsible, keyboard-aware)
src/components/SiteFooter.tsx          new, safe-area pinned
src/components/Seat.tsx                left/right orientation swap + overflow fix
src/components/MobileBoard.tsx         DnD id prefix
src/components/lobby/Lobby.tsx         dvh + safe-area
src/components/room/PreGameRoom.tsx    dvh + safe-area
```
