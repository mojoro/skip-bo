// Client-side resolution of the game server's HTTP + WS base URLs.
//
// When a LAN peer loads the Next app at `http://<host>:3000`, their browser
// must reach the game server at `:8787` on that same host — not the peer's
// own localhost. The old hard-coded `localhost:8787` fallback broke LAN play
// because the browser treats `localhost` as its own machine.
//
// Resolution order:
//   1. Explicit env var (NEXT_PUBLIC_GAME_API_URL / NEXT_PUBLIC_GAME_WS_URL)
//      — lets production deploys pin a wss:// or external domain.
//   2. `${window.location.hostname}:8787` with matching protocol. Works for
//      both localhost (single-device dev) and LAN (peer on the same subnet).
//   3. An SSR-safe `http://localhost:8787` when `window` is undefined. Only
//      hit during the first Next.js render pre-hydration; real requests
//      happen post-mount once the hostname is known.

const DEFAULT_SERVER_PORT = '8787';

export function gameApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_GAME_API_URL;
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return `http://localhost:${DEFAULT_SERVER_PORT}`;
  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
}

export function gameWsBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_GAME_WS_URL;
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return `ws://localhost:${DEFAULT_SERVER_PORT}`;
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
}
