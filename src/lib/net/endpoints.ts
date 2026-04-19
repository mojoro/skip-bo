// Client-side resolution of the game server's HTTP + WS base URLs.
//
// Resolution order:
//   1. Explicit env var (NEXT_PUBLIC_GAME_API_URL / NEXT_PUBLIC_GAME_WS_URL)
//      — lets production deploys pin a wss:// or external domain.
//   2. HTTPS page → same hostname, no explicit port. The single-origin AWS
//      deploy puts nginx on 443 fronting both Next and the game server, so
//      omitting the port routes through nginx.
//   3. HTTP page → `${hostname}:8787`. Works for both single-device dev and
//      LAN play (peer hits the host's :8787 game server alongside :3000 Next).
//   4. SSR pre-hydration → `http://localhost:8787` placeholder. No real
//      requests fire until post-mount once the hostname is known.

const DEFAULT_SERVER_PORT = '8787';

export function gameApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_GAME_API_URL;
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return `http://localhost:${DEFAULT_SERVER_PORT}`;
  if (window.location.protocol === 'https:') return `https://${window.location.hostname}`;
  return `http://${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
}

export function gameWsBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_GAME_WS_URL;
  if (envUrl) return envUrl;
  if (typeof window === 'undefined') return `ws://localhost:${DEFAULT_SERVER_PORT}`;
  if (window.location.protocol === 'https:') return `wss://${window.location.hostname}`;
  return `ws://${window.location.hostname}:${DEFAULT_SERVER_PORT}`;
}
