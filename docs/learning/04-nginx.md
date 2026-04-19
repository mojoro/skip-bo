# nginx as reverse proxy

## Web server vs reverse proxy

A **web server** serves static files (HTML, CSS, images) directly from disk. nginx, Apache, and Caddy all started life as web servers.

A **reverse proxy** stands in front of one or more application servers and forwards requests to them. The browser thinks it's talking to nginx; nginx is actually relaying to Node behind the scenes.

nginx does both. For Skip-Bo it's purely a reverse proxy — every request gets forwarded to either Next.js (port 3000) or the WebSocket server (port 8787).

The "reverse" in "reverse proxy" distinguishes it from a forward proxy (the kind a corporate network uses to filter outbound employee traffic). Forward proxy = client picks the proxy. Reverse proxy = server side puts the proxy in front of itself.

## Why we put nginx in front of Node

Couldn't Node just listen on port 443 directly? Technically yes, but:

1. **TLS termination** — nginx handles HTTPS encryption/decryption so the application doesn't have to. One place to manage certificates, one place to upgrade ciphers.
2. **Single public port** — all traffic enters on 443. The Node processes bind to private ports (3000, 8787) that aren't reachable from outside the box. Smaller attack surface.
3. **Routing** — nginx can route by path/host/method. Our app has Next, REST, SSE, and WebSockets all on the same domain — nginx fans them out to the right backend.
4. **Performance** — nginx is C, single-threaded with an event loop, very efficient at moving bytes. It buffers slow clients so Node isn't tied up by them.
5. **Process isolation** — if we restart Node for a deploy, nginx briefly holds connections while we swap. (Limited benefit for our in-memory state, but it's the standard pattern.)

## The `proxy_pass` directive

The core nginx directive for forwarding:

```nginx
location /v1/ {
  proxy_pass http://127.0.0.1:8787;
}
```

Says: any request whose path starts with `/v1/` gets forwarded to the upstream at `127.0.0.1:8787`. The path is preserved (`/v1/rooms` becomes a request to `http://127.0.0.1:8787/v1/rooms`).

Headers flow through too, but a few critical ones get rewritten or stripped — see the WebSocket section below.

## The WebSocket Upgrade dance

This is the one part of nginx that most people get wrong on the first try.

A WebSocket connection starts as a regular HTTP/1.1 request with two special headers:

```http
GET /rooms/abc/game HTTP/1.1
Upgrade: websocket
Connection: Upgrade
```

The server replies `101 Switching Protocols`, and from that moment the same TCP socket is used for raw WebSocket framing instead of HTTP.

**The catch:** `Upgrade` and `Connection` are "hop-by-hop" headers in HTTP/1.1 — they apply only to the immediate connection, not end-to-end. By default nginx strips them when proxying. So the WebSocket handshake reaches Node missing the upgrade signal, Node returns a regular HTTP response, and the browser shows `WebSocket connection to … failed` with no useful detail.

The fix is explicit, and the cleanest pattern uses a `map` directive at the top of the file so the same server block can serve WebSocket and non-WebSocket requests:

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  # ...

  location ~ ^/rooms/[^/]+/game/?$ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;                        # WebSocket needs HTTP/1.1
    proxy_set_header Upgrade $http_upgrade;        # forward the Upgrade header
    proxy_set_header Connection $connection_upgrade;   # set from the map
    proxy_set_header Host $host;                   # preserve original Host
    proxy_read_timeout 3600s;                      # don't close idle WS after 60s
  }
}
```

Every line matters:
- `proxy_http_version 1.1` — nginx defaults to HTTP/1.0 for upstreams; WebSocket needs 1.1.
- `proxy_set_header Upgrade $http_upgrade` — copies the Upgrade header through (the `$http_upgrade` variable is the inbound value).
- `proxy_set_header Connection $connection_upgrade` — the `map` directive resolves this to `upgrade` for WS requests and `close` for everything else. Cleaner than hard-coding `"upgrade"` because the same config can handle HTTP/1.1 keep-alive on non-WS paths.
- `proxy_read_timeout 3600s` — nginx defaults to closing idle connections at 60 seconds; WebSocket connections are intentionally idle most of the time (heartbeats only).

Mess up any of these and the symptom is the same: WebSocket fails with no descriptive error.

## Server-Sent Events also needs special handling

The Skip-Bo lobby uses SSE (a one-way streaming HTTP response — the lobby pushes room-list updates to the browser without polling). Two nginx tweaks for SSE:

```nginx
location = /v1/lobby/stream {
  proxy_pass http://127.0.0.1:8787;
  proxy_buffering off;          # send each chunk to the browser immediately
  proxy_cache off;
  proxy_read_timeout 3600s;
}
```

`proxy_buffering off` is the critical one. nginx's default is to buffer the upstream response and send it to the client in chunks for efficiency — which defeats the entire point of streaming. Without this line the browser receives nothing for ~30 s, then a burst of all queued events at once.

## Versioning note: `listen … http2` was deprecated in 1.25

Older guides show HTTP/2 enabled inline on the listen directive:

```nginx
listen 443 ssl http2;   # pre-1.25 — emits a [warn] on modern nginx
```

nginx 1.25+ split this into a standalone directive:

```nginx
listen 443 ssl;
http2 on;               # current syntax
```

Amazon Linux 2023 ships nginx 1.28, so you'll see the deprecation warning on every reload if you use the old form. The functionality still works; only the configuration style changed.

## Location matching priority (the gotcha you'll hit)

nginx evaluates `location` blocks in this order:

1. `=` (exact match) — highest priority
2. `^~` (longest prefix match, no regex)
3. Regex `~` and `~*` — first match wins, evaluated in file order
4. Plain prefix match — longest wins

We use a regex `~ ^/rooms/[^/]+/game/?$` for the WebSocket route because it needs to win over the plain `location /` (Next.js catch-all) but only match the WS path, not the page render at `/rooms/[roomId]`.

If you wrote `location /rooms/` instead, that prefix would catch *both* the Next.js page (`/rooms/abc`) and the WS handshake (`/rooms/abc/game`) and send everything to port 8787 — which would 404 the page render. The regex narrows it to only the WS endpoint.

## Interview-ready summary

> nginx sits in front of the Node processes as a reverse proxy. It terminates TLS so the application doesn't have to, exposes a single public port (443), and routes traffic to the right internal port by URL path. The WebSocket Upgrade headers (`Upgrade`, `Connection`, `proxy_http_version 1.1`) are critical — nginx strips hop-by-hop headers by default and the WS handshake silently fails without explicit forwarding. SSE needs `proxy_buffering off` to actually stream. Location matching is regex-first then longest-prefix, which lets us route WebSocket and Next.js page requests under the same URL prefix.
