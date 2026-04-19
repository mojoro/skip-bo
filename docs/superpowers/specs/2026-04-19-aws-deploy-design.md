# AWS single-box deploy — design (Section 7)

Deploy Skip-Bo to a single Amazon Linux 2023 EC2 instance running two Docker containers (the Next.js frontend and the existing WebSocket+REST server) behind a host-installed nginx that terminates TLS with a Let's Encrypt certificate. Single origin, single bill, single box. Manual bash deploy script for v1; GitHub Actions wraps the same primitive in v2.

## Goals

- Public, HTTPS-only Skip-Bo at `https://skipbo.johnmoorman.com` with a working WSS WebSocket flow.
- Build the AWS plumbing (EC2 provisioning, security groups, DNS, Docker, nginx, Let's Encrypt) by hand so the moving parts are visible — matches the "build from scratch" mandate.
- One-command deploy from the developer's laptop after the bootstrap is done.
- Cost: $0 during the 6-month AWS free plan window.
- Spec + learning docs + commit history that someone could read after the fact and either re-deploy from scratch or defend the design in an interview.

## Non-goals

- No CI/CD in v1. GHA is a v2 layer that re-uses the same host-side commands.
- No container registry. Build images on the EC2 host. Switch to a registry when GHA lands.
- No CDN, no autoscaling, no multi-region, no managed load balancer. Single box can serve the realistic player count for this app many times over.
- No persistent storage. Server state is in-memory by design; deploys drop active games.
- No CSP header. Skip-Bo's React Compiler + Tailwind generate inline styles/scripts that need a nonce-based CSP — separate task.
- No observability stack (Sentry, CloudWatch shipping). Pino → stdout → `docker logs` is enough for v1.
- No closure of follow-up #15 (sessionId in WS URL query) here; explicitly the first post-deploy task — see Open follow-ups.

## Architecture

### Topology

```
                ┌─────────────────────┐
                │   Browser (player)   │
                └──────────┬──────────┘
                           │
                       HTTPS / WSS
                           │
                           ▼
            ┌────────────────────────────────────┐
            │ EC2 t4g.small · eu-central-1        │
            │ skipbo.johnmoorman.com              │
            │                                     │
            │ ┌────────────────────────────────┐  │
            │ │ nginx :443 (Let's Encrypt)     │  │
            │ │  /          → :3000 (Next)     │  │
            │ │  /v1/*      → :8787 (REST)     │  │
            │ │  /v1/lobby/stream (SSE)→ :8787 │  │
            │ │  Upgrade:ws → :8787 (WSS)      │  │
            │ └─────────┬──────────┬───────────┘  │
            │           │          │              │
            │           ▼          ▼              │
            │ ┌──────────────┐ ┌─────────────┐   │
            │ │ docker:web    │ │ docker:srv   │  │
            │ │ next start    │ │ raw ws+REST  │  │
            │ │ :3000         │ │ :8787        │  │
            │ └──────────────┘ └─────────────┘   │
            └────────────────────────────────────┘
```

Browser connects only to `https://skipbo.johnmoorman.com` — same origin for HTML, REST, SSE, and WSS. nginx routes by URL path. Containers bind on `127.0.0.1` (via `network_mode: host`) and are unreachable from outside the box even if the security group changed.

### EC2 instance

| Property        | Value                                          |
|-----------------|------------------------------------------------|
| Instance type   | `t4g.small` (Graviton ARM, 2 vCPU, 2 GB RAM)   |
| AMI             | Amazon Linux 2023 (ARM64)                      |
| Storage         | 8 GB gp3 root volume                           |
| Region          | `eu-central-1` (Frankfurt)                     |
| Public IP       | Elastic IP, attached for stability across stop/start |
| Security group  | inbound 22/80/443 from `0.0.0.0/0`; ports 3000 + 8787 never exposed |

`t4g.small` is chosen over `t2.micro` because the post-July-2025 AWS free plan includes it and the extra GB of RAM removes the "Next.js build OOMs on 1 GB" problem entirely. ARM is transparent — Skip-Bo's Docker images use `node:20-alpine` (multi-arch) and Docker auto-pulls the ARM variant. esbuild and ws are pure JS or have ARM-prebuilt binaries.

### Domain & DNS

Single A record at the registrar that hosts `johnmoorman.com`:

```
skipbo.johnmoorman.com   A   <EC2 elastic IP>   TTL 300
```

300-second TTL makes IP changes propagate quickly during early debugging. Can be raised to 3600+ once stable.

## Components

### Repo layout additions

```
docker-compose.yml              # NEW (replaces server/docker-compose.yml)
Dockerfile.web                   # NEW — Next.js standalone image
.dockerignore                    # NEW — keeps both image builds lean
deploy/
  bootstrap.sh                   # one-time host setup
  deploy.sh                      # repeatable deploy from laptop
  nginx.conf                     # production nginx config
  README.md                      # operations runbook
```

`server/docker-compose.yml` is removed — the new root-level compose file orchestrates both `web` and `srv`.

### `next.config.ts` change (one line)

```ts
const nextConfig: NextConfig = {
  reactCompiler: true,
  output: 'standalone',          // emits self-contained .next/standalone w/ server.js
  allowedDevOrigins: ['192.168.0.29', 'localhost', '127.0.0.1'],
};
```

`output: 'standalone'` makes Next trace exactly which files+modules are needed at runtime and emits a tiny `.next/standalone/` bundle plus a `server.js`. No `npm install` needed at runtime.

### `Dockerfile.web` (new, at repo root)

Adapted from the canonical Vercel `with-docker` example, pinned to `node:20-alpine` to match the existing `server/Dockerfile`. Builds with **webpack** (not Turbopack) to sidestep [issue #88844](https://github.com/vercel/next.js/issues/88844) where Turbopack's standalone emitter omits `serverExternalPackages` deps from `.next/standalone/node_modules`.

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -- --webpack    # explicit webpack; avoids #88844

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build --chown=node:node /app/public ./public
RUN mkdir .next && chown node:node .next
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

### `docker-compose.yml` (new, at repo root)

```yaml
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    network_mode: host           # nginx talks via 127.0.0.1:3000
    restart: unless-stopped
    environment:
      NODE_ENV: production

  srv:
    build:
      context: .
      dockerfile: server/Dockerfile
    network_mode: host           # nginx talks via 127.0.0.1:8787
    restart: unless-stopped
    environment:
      NODE_ENV: production
      CORS_ORIGIN: https://skipbo.johnmoorman.com
      LOG_LEVEL: info
```

### `.dockerignore` (new, at repo root)

```
node_modules
.next
.git
server/node_modules
server/dist
docs
*.md
.env*
.claude
.worktrees
coverage
*.png
.playwright-mcp
```

### Client URL resolution patch (`src/lib/net/endpoints.ts`)

Current logic always appends `:8787` to the resolved hostname. In production behind nginx, the WS lives on 443 with no explicit port. Drop the port suffix when the page is HTTPS:

```ts
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
```

LAN/local dev paths are unchanged. No env var needed in production.

### `deploy/nginx.conf` (production-grade)

```nginx
# Connection upgrade map — clean handling of WS + non-WS in one server block
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 80;
  server_name skipbo.johnmoorman.com;

  # ACME challenge location — served directly, NOT redirected.
  # Used by certbot's webroot method for both initial issue and renewals.
  location /.well-known/acme-challenge/ {
    root /var/www/letsencrypt;
  }

  # Everything else → HTTPS
  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name skipbo.johnmoorman.com;

  ssl_certificate     /etc/letsencrypt/live/skipbo.johnmoorman.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/skipbo.johnmoorman.com/privkey.pem;

  # TLS — Mozilla Intermediate 2026
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:DHE-RSA-CHACHA20-POLY1305;
  ssl_prefer_server_ciphers off;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_session_tickets off;

  # OCSP stapling
  ssl_stapling on;
  ssl_stapling_verify on;

  # Security headers
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  # WebSocket — regex wins over /rooms/ prefix; matches only /rooms/{id}/game
  location ~ ^/rooms/[^/]+/game/?$ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
  }

  # SSE
  location = /v1/lobby/stream {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }

  # REST
  location /v1/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Next.js (catch-all)
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

### `deploy/bootstrap.sh` (one-time host setup)

```bash
#!/usr/bin/env bash
# Setup of fresh Amazon Linux 2023 EC2 box. Run as root: sudo bash bootstrap.sh
set -euo pipefail

DOMAIN=skipbo.johnmoorman.com
EMAIL=johnrmoorman@gmail.com
REPO=https://github.com/mojoro/skip-bo.git

# 1. System packages (all in AL2023 default repos)
dnf update -y
dnf install -y docker nginx certbot python3-certbot-nginx git

# 2. Docker Compose plugin (NOT in AL2023 default repo — manual install)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -sL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 3. Enable Docker + swap
systemctl enable --now docker
usermod -aG docker ec2-user

# 4. Swap (1 GB) — defensive headroom for Docker build spikes on a 2 GB box
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 5. Clone repo to /opt/skip-bo
if [ ! -d /opt/skip-bo ]; then
  git clone "$REPO" /opt/skip-bo
  chown -R ec2-user:ec2-user /opt/skip-bo
fi

# 6. Webroot dir for ACME challenges (used by both initial issue + renewals)
mkdir -p /var/www/letsencrypt

# 7. Temporary HTTP-only nginx config so certbot's webroot challenge can be served
cat > /etc/nginx/conf.d/skipbo.conf <<EOF
server {
  listen 80;
  server_name $DOMAIN;
  location /.well-known/acme-challenge/ {
    root /var/www/letsencrypt;
  }
  location / {
    return 503;
  }
}
EOF
rm -f /etc/nginx/conf.d/default.conf
nginx -t && systemctl enable --now nginx

# 8. Initial TLS issuance via webroot (nginx serves the challenge file)
#    Renewals use the same method by default — no config drift, no downtime.
certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" \
  --email "$EMAIL" --agree-tos --non-interactive

# 9. Install production nginx config (references the cert paths from step 8,
#    preserves the ACME location for future renewals)
cp /opt/skip-bo/deploy/nginx.conf /etc/nginx/conf.d/skipbo.conf
nginx -t && systemctl reload nginx

# 10. Cert renewal hook → reload nginx after every successful renew
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/bash
systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# 11. Verify renewal timer (AL2023 ships it pre-enabled)
systemctl list-timers | grep -q certbot-renew && echo "✓ certbot-renew.timer active"

echo "✓ Bootstrap complete. Run deploy.sh from your laptop to bring up the app."
```

### `deploy/deploy.sh` (repeatable deploys from laptop)

Requires `~/.ssh/config` entry aliasing `skipbo` to the EC2 host:

```
Host skipbo
  HostName <elastic IP>
  User ec2-user
  IdentityFile ~/.ssh/skipbo.pem
```

```bash
#!/usr/bin/env bash
set -euo pipefail

REMOTE=skipbo
REMOTE_DIR=/opt/skip-bo

ssh "$REMOTE" "cd $REMOTE_DIR && git fetch origin main && git reset --hard origin/main"
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose up -d --build"
ssh "$REMOTE" "docker image prune -f"
sleep 5
ssh "$REMOTE" "curl -sf http://127.0.0.1:8787/v1/rooms > /dev/null"
ssh "$REMOTE" "curl -sf http://127.0.0.1:3000/ > /dev/null"
echo "→ Live: https://skipbo.johnmoorman.com"
```

`git reset --hard` (not `pull`) makes the host exactly mirror remote main — predictable, no merge surprises. `docker image prune -f` keeps disk in check (each rebuild dangles the previous image). `curl 127.0.0.1` health checks bypass nginx and verify the containers themselves are healthy.

## Data flow

### Initial bootstrap (one-time, ~10 min)

1. AWS Console → launch EC2 t4g.small in eu-central-1, AL2023 ARM64 AMI, 8 GB gp3, key pair, security group with 22+80+443 inbound.
2. Allocate elastic IP, attach to the instance.
3. Update DNS at registrar: `skipbo` A record → elastic IP.
4. Wait for DNS propagation (≤ 5 min for new records at TTL 300).
5. From laptop: `scp deploy/bootstrap.sh skipbo:/tmp/ && ssh skipbo "sudo bash /tmp/bootstrap.sh"`.
6. From laptop: `./deploy/deploy.sh` to build images and bring up containers.
7. Browser: open `https://skipbo.johnmoorman.com`, verify lobby loads and a two-tab game completes a round.

### Repeatable deploy (~2 min, mostly Docker rebuild time)

1. Edit code locally → commit → `git push origin main`.
2. `./deploy/deploy.sh` from laptop.
3. Script: SSH to host → `git reset --hard origin/main` → `docker compose up -d --build` → prune dangling images → curl health checks.
4. Verify in browser.

In-flight games drop on every container restart. Server's existing `installShutdown` closes WebSockets cleanly with code 1001 ("going away") so clients see the disconnect promptly.

### Cert renewal lifecycle

1. `certbot-renew.timer` fires twice daily (AL2023 default).
2. `certbot renew` checks `/etc/letsencrypt/live/skipbo.johnmoorman.com/`. If within 30 days of expiry, it requests a new cert via HTTP-01 challenge using the webroot method (stored in the renewal config from step 8 of bootstrap).
3. certbot writes the challenge file to `/var/www/letsencrypt/.well-known/acme-challenge/<token>`. nginx's port-80 server block already has a `location /.well-known/acme-challenge/` that serves this directory — the challenge succeeds without restarting nginx.
4. On successful renewal, `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` runs `systemctl reload nginx` to pick up the new cert files. Zero downtime.

### Browser request lifecycle (HTML page)

`GET https://skipbo.johnmoorman.com/`
1. DNS resolves to elastic IP.
2. TCP + TLS handshake to `:443` (nginx terminates).
3. nginx matches `location /` → `proxy_pass http://127.0.0.1:3000`.
4. Next.js `server.js` (in `web` container) returns the rendered HTML.
5. Browser parses, requests static assets at `/_next/static/*` — same path → same `web` container.

### Browser request lifecycle (WebSocket connect)

`WSS https://skipbo.johnmoorman.com/rooms/{id}/game?sessionId={s}`
1. DNS + TLS as above.
2. Browser sends `GET /rooms/{id}/game` with `Upgrade: websocket`, `Connection: Upgrade`.
3. nginx regex `^/rooms/[^/]+/game/?$` matches → `proxy_pass http://127.0.0.1:8787`. The `Upgrade` and `Connection` headers are explicitly forwarded (the `map` directive sets `Connection: upgrade` based on inbound `Upgrade` header).
4. Server's `createGameUpgradeHandler` validates Origin (CSWSH defense), session, and room state; responds `101 Switching Protocols`.
5. nginx promotes the connection; bytes flow bidirectionally with `proxy_read_timeout 3600s` keeping idle sockets alive.

## Security & hardening

- **TLS 1.2 + 1.3 only.** No legacy protocols.
- **Mozilla Intermediate 2026 cipher list.** Strong ECDHE-only AEAD ciphers.
- **HSTS 2 years + `includeSubDomains` + `always`.** Protects subdomains and applies to error responses.
- **OCSP stapling.** nginx fetches revocation status, attaches to handshake — saves clients a round-trip and prevents privacy leak.
- **Security headers:** X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin.
- **CORS_ORIGIN strictly set.** Server refuses to start in `NODE_ENV=production` with `CORS_ORIGIN=*`. Production check at `server/src/index.ts:13`.
- **Origin header validation on WS handshake.** Defense against CSWSH.
- **Containers bound to localhost.** `network_mode: host` exposes them on `127.0.0.1` only; the security group blocks `:3000` and `:8787` from the internet anyway. Defense in depth.
- **SSH key-only auth.** AL2023 default — no password auth. Port 22 open globally is acceptable with key-only auth on a small box.
- **Non-root container processes.** Both `web` (USER node) and `srv` (pm2-runtime as nobody-equivalent inside the container) run unprivileged.

## Cost & account lifecycle

| Phase                   | Window                                | Cost      | Notes                                                 |
|-------------------------|---------------------------------------|-----------|-------------------------------------------------------|
| Free plan (new account) | First 6 months from signup            | $0        | $200 credits + free t4g.small + 8 GB gp3              |
| Decision point          | Month 5                               | —         | Upgrade to paid plan, migrate, or accept shutdown     |
| Paid (post-free)        | Month 7+                              | ~$13/mo   | t4g.small on-demand in eu-central-1 + EBS + transfer  |

**Critical:** the post-July-2025 AWS free plan is **6 months only**, and accounts auto-close on expiry unless upgraded. Resources are deleted after a 90-day grace period. Strategy: at month 5, decide whether the project is worth $13/mo to keep online or whether to take it down before the auto-close. Set a calendar reminder during bootstrap.

Free tier alerts and a $5/mo budget alarm should be configured in AWS Billing day one.

## Operations

| Need                              | Command                                                                     |
|-----------------------------------|------------------------------------------------------------------------------|
| Deploy latest main                | `./deploy/deploy.sh`                                                         |
| Tail server logs                  | `ssh skipbo "docker compose -f /opt/skip-bo/docker-compose.yml logs -f srv"` |
| Tail web logs                     | `ssh skipbo "docker compose -f /opt/skip-bo/docker-compose.yml logs -f web"` |
| Restart without rebuild           | `ssh skipbo "cd /opt/skip-bo && docker compose restart"`                     |
| Roll back to previous SHA         | `ssh skipbo "cd /opt/skip-bo && git reset --hard <sha> && docker compose up -d --build"` |
| Force cert renewal (test only)    | `ssh skipbo "sudo certbot renew --dry-run"`                                  |
| Inspect cert expiry               | `ssh skipbo "sudo certbot certificates"`                                     |
| Memory + CPU snapshot             | `ssh skipbo "docker stats --no-stream && free -h"`                           |

## Open follow-ups (post-deploy)

In priority order:

1. **Close CLAUDE.md follow-up #15** — sessionId currently lands in the WS URL query (`?sessionId=…`), which appears in nginx access logs and any future log aggregation. Move it to the `Sec-WebSocket-Protocol` header (server's `handshake.ts` reads from `req.headers['sec-websocket-protocol']`; client passes as second arg to `new WebSocket(url, ['session.' + sessionId])`; server selects + echoes the protocol in the 101 response). ~2–3 hours including tests. **First post-deploy task.**
2. **Wire GitHub Actions** — workflow at `.github/workflows/deploy.yml` runs the same SSH+docker-compose commands on every push to main. Stash SSH key in GitHub Secrets. ~1 hour.
3. **Migrate to a container registry** when GHA lands — runner can't SSH to build, so it pushes to GHCR (free for public repos), host pulls. Re-introduces a registry but trades it for faster, more predictable deploys.
4. **Add CSP header** — requires Tailwind/React-Compiler-aware nonce-based CSP; non-trivial.
5. **Account-expiry decision** — calendar reminder for month 5 of the free plan.
6. **Migrate to single-cluster ECS or stay on EC2 long-term** — depends on whether Skip-Bo grows beyond hobby use.
7. **CloudWatch logs shipping** — Pino → CloudWatch agent for searchable, persistent logs. Free tier covers ~5 GB ingestion/mo.

## Validation plan

After bootstrap + first deploy, verify each:

- [ ] `https://skipbo.johnmoorman.com` returns 200 with valid TLS (no browser warnings, padlock icon).
- [ ] `curl -I https://skipbo.johnmoorman.com` shows `strict-transport-security`, `x-frame-options`, `x-content-type-options` headers.
- [ ] [SSL Labs test](https://www.ssllabs.com/ssltest/) returns A or A+ for the domain.
- [ ] Lobby loads, "Create room" → redirects to `/rooms/{id}` → pre-game room renders.
- [ ] Two browser tabs (different sessionIds) both join the same room, host starts the game, both see the Board, a turn cycle completes.
- [ ] Server logs (`docker compose logs srv`) show no startup warnings about CORS_ORIGIN.
- [ ] `sudo certbot renew --dry-run` succeeds.
- [ ] `docker stats` shows both containers under 250 MB resident; `free -h` shows < 1 GB used of 2 GB.
- [ ] Deploy `deploy.sh` a second time (no code changes) — verifies the script is idempotent and Docker layer caching produces a fast rebuild.
- [ ] Hard-refresh the browser during a game → WebSocket reconnects within 3 s and the in-progress game restores.
- [ ] AWS Billing dashboard shows $0 used, free-tier alerts configured.
