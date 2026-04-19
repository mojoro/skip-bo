# AWS single-box deploy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Skip-Bo to a public HTTPS URL on a single AWS EC2 box following the section 7 design.

**Architecture:** One Amazon Linux 2023 EC2 t4g.small instance runs two Docker containers (Next.js standalone frontend and the existing raw-ws server) behind a host-installed nginx that terminates TLS via Let's Encrypt. Two repeatable bash scripts handle bootstrap and deploy. Single origin, no CORS, no CDN, no registry in v1.

**Tech Stack:** AWS EC2 (Graviton ARM), Amazon Linux 2023, Docker + Compose v2, nginx, certbot/Let's Encrypt (webroot method), Next.js 16 standalone output, Node 20 alpine.

**Spec:** `docs/superpowers/specs/2026-04-19-aws-deploy-design.md`
**Learning docs:** `docs/learning/01-aws-ec2.md` … `docs/learning/06-deploy-workflow.md`

**Repo conventions** (read `CLAUDE.md` if you skipped it):
- Commits: single-line subject, imperative completing "This commit will…", no body, no Co-Authored-By, no Conventional-Commits prefix, ≤75 chars.
- Atomic: one logical change per commit. Commit as you go, not at the end.
- Bash: never chain commands with `&&`/`;`/`||` in tool calls — separate Bash calls per command.

---

## Orchestration model

This plan is structured for a Sonnet 4.6 orchestrator that dispatches subagents in parallel where dependencies allow. Tasks within a wave can run concurrently; waves are sequential. Each task is self-contained — an agent can execute one without reading the others.

| Wave | Tasks                | Parallel?      | Gate before next wave                                                |
|------|----------------------|----------------|----------------------------------------------------------------------|
| 1    | T1, T2, T3, T4       | yes — 4-way    | `npx tsc --noEmit` clean (root); `npm test` 142/142 pass             |
| 2    | T5                   | single         | `docker build -f Dockerfile.web` succeeds                            |
| 3    | T6                   | single         | `docker compose config` valid                                        |
| 4    | T7, T8, T9           | yes — 3-way    | `shellcheck deploy/*.sh` clean                                       |
| 5    | T10                  | single         | local docker compose stack starts and serves /                       |
| —    | **HUMAN GATE H1–H7** | manual         | live URL passes the spec's validation checklist                      |
| 6    | T11                  | single         | CLAUDE.md reflects shipped state                                     |

**Orchestrator dispatch pattern:**
- For parallel waves, send one message with N concurrent Agent tool calls (one per task).
- Between waves, run the gate command and review output before dispatching the next wave.
- Each subagent gets the task block (everything between `### Task N` and the next `###`) plus the "Repo conventions" reminder. They must commit their own work before reporting back.
- Verification commands are exact — copy them verbatim.

---

## Wave 1 — Independent edits (4 parallel)

These four tasks touch disjoint files and have no inter-dependencies. Dispatch all four simultaneously.

### Task 1: Add `output: 'standalone'` to `next.config.ts`

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Edit `next.config.ts` to add the standalone output line**

Replace the existing config block with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: 'standalone',
  // Next.js warns (and in some minor versions blocks) cross-origin dev
  // requests when a LAN peer hits the dev server at `<host>:3000`. Accept
  // private-network hostnames so any peer on the subnet can load the app.
  // Adjust if the host's LAN IP changes. Ignored in production builds.
  allowedDevOrigins: ['192.168.0.29', 'localhost', '127.0.0.1'],
};

export default nextConfig;
```

- [ ] **Step 2: Verify root typecheck still clean**

Run: `npx tsc --noEmit`
Expected: only the pre-existing `@engine/*` alias error from follow-up #13 (in `server/` files). No new errors in `next.config.ts` or anything else under root.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "Emit a Next.js standalone build for the deploy image"
```

---

### Task 2: Patch `src/lib/net/endpoints.ts` for HTTPS port resolution (TDD)

The current `gameApiBaseUrl()` and `gameWsBaseUrl()` always append `:8787` to the hostname. In production behind nginx, the WS lives on 443 with no explicit port. This task adds tests covering all three branches (env override, HTTPS, HTTP/LAN) and patches the implementation.

**Files:**
- Create: `src/lib/net/endpoints.test.ts`
- Modify: `src/lib/net/endpoints.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/net/endpoints.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gameApiBaseUrl, gameWsBaseUrl } from './endpoints';

const ORIGINAL_LOCATION = window.location;

function setLocation(href: string): void {
  // jsdom's location is read-only; replace the whole property to override.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: new URL(href),
  });
}

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
  vi.unstubAllEnvs();
});

describe('gameApiBaseUrl', () => {
  it('returns NEXT_PUBLIC_GAME_API_URL verbatim when set', () => {
    vi.stubEnv('NEXT_PUBLIC_GAME_API_URL', 'https://api.example.com');
    setLocation('http://localhost:3000');
    expect(gameApiBaseUrl()).toBe('https://api.example.com');
  });

  it('drops the port suffix on HTTPS pages so requests route through nginx', () => {
    setLocation('https://skipbo.johnmoorman.com/rooms/abc');
    expect(gameApiBaseUrl()).toBe('https://skipbo.johnmoorman.com');
  });

  it('uses :8787 on HTTP pages for LAN/local development', () => {
    setLocation('http://192.168.0.29:3000/rooms/abc');
    expect(gameApiBaseUrl()).toBe('http://192.168.0.29:8787');
  });
});

describe('gameWsBaseUrl', () => {
  it('returns NEXT_PUBLIC_GAME_WS_URL verbatim when set', () => {
    vi.stubEnv('NEXT_PUBLIC_GAME_WS_URL', 'wss://ws.example.com');
    setLocation('http://localhost:3000');
    expect(gameWsBaseUrl()).toBe('wss://ws.example.com');
  });

  it('drops the port suffix on HTTPS pages (nginx fronts the WSS upgrade)', () => {
    setLocation('https://skipbo.johnmoorman.com/rooms/abc');
    expect(gameWsBaseUrl()).toBe('wss://skipbo.johnmoorman.com');
  });

  it('uses ws:// with :8787 on HTTP pages for LAN/local development', () => {
    setLocation('http://192.168.0.29:3000/rooms/abc');
    expect(gameWsBaseUrl()).toBe('ws://192.168.0.29:8787');
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `npm test -- src/lib/net/endpoints.test.ts`
Expected: 6 tests, with the two "drops the port suffix" tests FAILING (current impl appends `:8787`).

- [ ] **Step 3: Patch `src/lib/net/endpoints.ts` with the new implementation**

Replace the entire file contents with:

```ts
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
```

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `npm test -- src/lib/net/endpoints.test.ts`
Expected: 6 tests, all PASS.

- [ ] **Step 5: Run the full root suite to confirm no regressions**

Run: `npm test`
Expected: 148 tests pass (was 142 + the 6 new ones). No failures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/net/endpoints.ts src/lib/net/endpoints.test.ts
git commit -m "Drop the port suffix on HTTPS so nginx fronts the API and WS"
```

---

### Task 3: Create `deploy/nginx.conf`

**Files:**
- Create: `deploy/nginx.conf`

- [ ] **Step 1: Create the `deploy/` directory and write `nginx.conf`**

```nginx
# Production nginx config for skipbo.johnmoorman.com.
# Lives at /etc/nginx/conf.d/skipbo.conf on the host (copied by bootstrap.sh).

# Connection upgrade map — clean handling of WS + non-WS in one server block.
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

  # Everything else → HTTPS.
  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name skipbo.johnmoorman.com;

  ssl_certificate     /etc/letsencrypt/live/skipbo.johnmoorman.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/skipbo.johnmoorman.com/privkey.pem;

  # TLS — Mozilla Intermediate 2026.
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:DHE-RSA-CHACHA20-POLY1305;
  ssl_prefer_server_ciphers off;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_session_tickets off;

  # OCSP stapling.
  ssl_stapling on;
  ssl_stapling_verify on;

  # Security headers.
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  # WebSocket — regex wins over /rooms/ prefix; matches only /rooms/{id}/game.
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

  # SSE — disable buffering for streaming.
  location = /v1/lobby/stream {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }

  # REST.
  location /v1/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Next.js (catch-all).
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add deploy/nginx.conf
git commit -m "Add the production nginx config for skipbo.johnmoorman.com"
```

---

### Task 4: Create root `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Write `.dockerignore` at the repo root**

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

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "Add a root dockerignore so both image builds stay lean"
```

---

## Wave 1 gate

After all four agents report back:

```bash
npx tsc --noEmit          # only the pre-existing follow-up #13 error allowed
npm test                  # 148 tests pass
git log --oneline -5      # 4 new commits visible
```

Proceed to Wave 2 only if all gates green.

---

## Wave 2 — Dockerfile.web (single)

### Task 5: Create `Dockerfile.web`

**Depends on:** Task 1 (`output: 'standalone'` must be in `next.config.ts`).

**Files:**
- Create: `Dockerfile.web`

- [ ] **Step 1: Write `Dockerfile.web` at the repo root**

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
# Next 16 defaults to Turbopack. If issue #88844 manifests (missing
# serverExternalPackages in .next/standalone/node_modules), switch to:
#   RUN npm run build -- --webpack
RUN npm run build

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

- [ ] **Step 2: Build the image locally to verify it succeeds**

Run: `DOCKER_BUILDKIT=1 docker build -f Dockerfile.web -t skipbo-web:test .`
Expected: build completes, final image tagged. Watch for any "missing module" errors at runtime stage — those would indicate the #88844 Turbopack regression.

- [ ] **Step 3: Smoke-test the container starts and responds**

Run (separately):
```
docker run --rm -d -p 3000:3000 --name skipbo-web-smoke skipbo-web:test
```
Wait 5 seconds, then:
```
curl -sf http://localhost:3000/ -o /dev/null -w "%{http_code}\n"
```
Expected: `200`.

If it failed and the container logs show a missing module error like `Cannot find module '<package>'`, edit `Dockerfile.web` line 16 to `RUN npm run build -- --webpack` and rebuild.

- [ ] **Step 4: Tear down the smoke container**

Run: `docker rm -f skipbo-web-smoke`

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.web
git commit -m "Add the Next.js standalone Dockerfile fronting the web service"
```

---

## Wave 2 gate

```bash
docker images skipbo-web:test    # image exists
git log --oneline -1              # commit visible
```

Proceed to Wave 3.

---

## Wave 3 — docker-compose (single)

### Task 6: Create root `docker-compose.yml` and remove the server-only one

**Files:**
- Create: `docker-compose.yml`
- Delete: `server/docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml` at the repo root**

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

- [ ] **Step 2: Validate the compose file**

Run: `docker compose config`
Expected: prints the resolved config without errors.

- [ ] **Step 3: Delete the old server-only compose file**

Run: `git rm server/docker-compose.yml`
Expected: file removed and staged.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "Replace the server-only compose with a root web plus srv stack"
```

---

## Wave 3 gate

```bash
docker compose config > /dev/null && echo OK
ls server/docker-compose.yml 2>/dev/null && echo "ERROR: old file still present" || echo "OK"
git log --oneline -1
```

Proceed to Wave 4.

---

## Wave 4 — Deploy scripts (3 parallel)

These three tasks touch disjoint files. Dispatch all three simultaneously.

### Task 7: Create `deploy/bootstrap.sh`

**Files:**
- Create: `deploy/bootstrap.sh`

- [ ] **Step 1: Write `deploy/bootstrap.sh`**

```bash
#!/usr/bin/env bash
# One-time setup of a fresh Amazon Linux 2023 EC2 box for Skip-Bo.
# Run as root on the EC2 host:
#   scp deploy/bootstrap.sh skipbo:/tmp/
#   ssh skipbo "sudo bash /tmp/bootstrap.sh"
set -euo pipefail

DOMAIN=skipbo.johnmoorman.com
EMAIL=johnrmoorman@gmail.com
REPO=https://github.com/mojoro/skip-bo.git

# 1. System packages (all in AL2023 default repos).
dnf update -y
dnf install -y docker nginx certbot python3-certbot-nginx git

# 2. Docker Compose plugin (NOT in AL2023 default repo — manual install).
mkdir -p /usr/local/lib/docker/cli-plugins
curl -sL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 3. Enable Docker; add ec2-user to docker group so deploys don't need sudo.
systemctl enable --now docker
usermod -aG docker ec2-user

# 4. 1 GB swap file — defensive headroom for Docker build spikes on a 2 GB box.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 5. Clone the repo to /opt/skip-bo (FHS-standard for self-contained software).
if [ ! -d /opt/skip-bo ]; then
  git clone "$REPO" /opt/skip-bo
  chown -R ec2-user:ec2-user /opt/skip-bo
fi

# 6. Webroot dir for ACME challenges (used by both initial issue + renewals).
mkdir -p /var/www/letsencrypt

# 7. Temporary HTTP-only nginx config so certbot's webroot challenge can serve.
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
nginx -t
systemctl enable --now nginx

# 8. Initial TLS issuance via webroot (nginx serves the challenge file).
#    Renewals use the same method by default — no config drift, no downtime.
certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" \
  --email "$EMAIL" --agree-tos --non-interactive

# 9. Install the production nginx config (references certs from step 8,
#    preserves the ACME location for future renewals).
cp /opt/skip-bo/deploy/nginx.conf /etc/nginx/conf.d/skipbo.conf
nginx -t
systemctl reload nginx

# 10. Cert renewal hook → reload nginx after every successful renew.
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/bash
systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# 11. Verify the renewal timer (AL2023 ships it pre-enabled).
systemctl list-timers | grep -q certbot-renew && echo "✓ certbot-renew.timer active"

echo "✓ Bootstrap complete. Run deploy.sh from your laptop to bring up the app."
```

- [ ] **Step 2: Mark executable**

Run: `chmod +x deploy/bootstrap.sh`

- [ ] **Step 3: Lint with shellcheck if available**

Run: `which shellcheck && shellcheck deploy/bootstrap.sh || echo "shellcheck not installed; skipping"`
Expected: no warnings (or skip notice).

- [ ] **Step 4: Commit**

```bash
git add deploy/bootstrap.sh
git commit -m "Add the one-time bootstrap script for the AL2023 EC2 host"
```

---

### Task 8: Create `deploy/deploy.sh`

**Files:**
- Create: `deploy/deploy.sh`

- [ ] **Step 1: Write `deploy/deploy.sh`**

```bash
#!/usr/bin/env bash
# Repeatable deploy from laptop → EC2.
# Prereqs:
#   - bootstrap.sh has run on the host
#   - ~/.ssh/config has a `Host skipbo` entry pointing at the EC2 elastic IP
#     with the right key (User ec2-user, IdentityFile ~/.ssh/skipbo.pem)
#   - main is pushed to origin
set -euo pipefail

REMOTE=skipbo
REMOTE_DIR=/opt/skip-bo

echo "→ Syncing main on $REMOTE..."
ssh "$REMOTE" "cd $REMOTE_DIR && git fetch origin main && git reset --hard origin/main"

echo "→ Rebuilding + restarting containers..."
ssh "$REMOTE" "cd $REMOTE_DIR && docker compose up -d --build"

echo "→ Pruning dangling images..."
ssh "$REMOTE" "docker image prune -f"

echo "→ Waiting for containers to settle..."
sleep 5

echo "→ Health checks..."
ssh "$REMOTE" "curl -sf http://127.0.0.1:8787/v1/rooms > /dev/null && echo '  ✓ srv :8787 ok'"
ssh "$REMOTE" "curl -sf http://127.0.0.1:3000/ > /dev/null && echo '  ✓ web :3000 ok'"

echo "→ Live: https://skipbo.johnmoorman.com"
```

- [ ] **Step 2: Mark executable**

Run: `chmod +x deploy/deploy.sh`

- [ ] **Step 3: Lint with shellcheck if available**

Run: `which shellcheck && shellcheck deploy/deploy.sh || echo "shellcheck not installed; skipping"`
Expected: no warnings (or skip notice).

- [ ] **Step 4: Commit**

```bash
git add deploy/deploy.sh
git commit -m "Add the laptop-to-EC2 deploy script for repeat deploys"
```

---

### Task 9: Create `deploy/README.md` (operations runbook)

**Files:**
- Create: `deploy/README.md`

- [ ] **Step 1: Write `deploy/README.md`**

```markdown
# Skip-Bo deploy runbook

Operations for the single-box AWS deploy. See the full design at
`docs/superpowers/specs/2026-04-19-aws-deploy-design.md` and the conceptual
companion at `docs/learning/`.

## Prerequisites (one-time)

1. AWS account with the post-July-2025 free plan active.
2. EC2 instance `t4g.small` running Amazon Linux 2023 (ARM64) in `eu-central-1`.
3. Elastic IP attached to the instance.
4. DNS A record `skipbo.johnmoorman.com → <elastic IP>` at the registrar of `johnmoorman.com`.
5. SSH key registered with the instance.
6. Local `~/.ssh/config`:
   ```
   Host skipbo
     HostName <EC2 elastic IP>
     User ec2-user
     IdentityFile ~/.ssh/skipbo.pem
   ```

## First-time host setup

```bash
scp deploy/bootstrap.sh skipbo:/tmp/
ssh skipbo "sudo bash /tmp/bootstrap.sh"
```

The script installs Docker + Compose plugin + nginx + certbot + git, sets up a 1 GB swap file, clones the repo to `/opt/skip-bo`, issues the Let's Encrypt cert via the webroot method, and starts nginx with the production config. ~10 minutes total.

## Repeatable deploy

After pushing to `main`:

```bash
./deploy/deploy.sh
```

The script SSHes to the host, hard-resets `/opt/skip-bo` to `origin/main`, rebuilds the Docker images, restarts containers, prunes dangling images, and runs `curl` health checks against both services. ~2 minutes for incremental deploys (Docker layer cache); ~5 minutes for first deploy.

## Operations cheat sheet

| Need                              | Command                                                                     |
|-----------------------------------|------------------------------------------------------------------------------|
| Deploy latest main                | `./deploy/deploy.sh`                                                         |
| Tail server logs                  | `ssh skipbo "docker compose -f /opt/skip-bo/docker-compose.yml logs -f srv"` |
| Tail web logs                     | `ssh skipbo "docker compose -f /opt/skip-bo/docker-compose.yml logs -f web"` |
| Restart without rebuild           | `ssh skipbo "cd /opt/skip-bo && docker compose restart"`                     |
| Roll back to previous SHA         | `ssh skipbo "cd /opt/skip-bo && git reset --hard <sha> && docker compose up -d --build"` |
| Force cert renewal (test only)    | `ssh skipbo "sudo certbot renew --dry-run"`                                  |
| Inspect cert expiry               | `ssh skipbo "sudo certbot certificates"`                                     |
| Memory + CPU snapshot             | `ssh skipbo "docker stats --no-stream"` and `ssh skipbo "free -h"`           |
| Disk usage                        | `ssh skipbo "df -h /"`                                                       |

## Known characteristics

- **In-flight games drop on every deploy.** The server holds game state in memory; container restart is the same as a server crash from the player's POV. The existing `installShutdown` closes WS sockets cleanly with code 1001 ("going away") so clients see the disconnect promptly. Deploy during quiet times.
- **Cert renewals are zero-downtime.** certbot writes the ACME challenge file into `/var/www/letsencrypt`; nginx's port-80 server block serves it without restarting. After issuance, the deploy hook runs `systemctl reload nginx` (also zero-downtime).
- **Free plan window is 6 months from AWS account creation.** At month 5, decide: upgrade to paid (~$13/mo for the t4g.small on-demand in eu-central-1) or take the project down. The account auto-closes at the 6-month mark.

## When something is wrong

- `https://skipbo.johnmoorman.com` returns 502 → the containers are down. Check `docker compose ps` on the host. Restart with `docker compose up -d`.
- WebSocket fails to connect with no clear error → check nginx is forwarding the Upgrade headers. Run `ssh skipbo "sudo cat /etc/nginx/conf.d/skipbo.conf | grep -A5 'rooms.*game'"` and confirm the four `proxy_set_header` lines for WebSocket are present.
- Cert about to expire (banner in browser) → run `ssh skipbo "sudo certbot renew --force-renewal && sudo systemctl reload nginx"`.
- Disk full → `docker image prune -af` and `journalctl --vacuum-size=100M`.
```

- [ ] **Step 2: Commit**

```bash
git add deploy/README.md
git commit -m "Document the deploy operations runbook for future John"
```

---

## Wave 4 gate

```bash
ls -la deploy/                                  # all four files present, scripts executable
which shellcheck && shellcheck deploy/*.sh      # if available, no warnings
git log --oneline -3
```

Proceed to Wave 5.

---

## Wave 5 — Local verification (single)

### Task 10: Smoke-test the full Docker stack locally

**Goal:** confirm the compose stack builds and both services come up before John runs anything against AWS. This catches arch-independent issues (Dockerfile typos, env var names, port collisions) before they become production debugging.

**Files:** none modified; this is verification only.

- [ ] **Step 1: Build both images via compose**

Run: `docker compose build`
Expected: both `web` and `srv` build successfully. First build pulls `node:20-alpine`. ~3-5 minutes.

- [ ] **Step 2: Bring the stack up in detached mode**

Run: `docker compose up -d`
Expected: both services reach `Started`.

- [ ] **Step 3: Wait for services to settle**

Run: `sleep 5`

- [ ] **Step 4: Health-check both services**

Run: `curl -sf http://127.0.0.1:8787/v1/rooms -o /dev/null -w "%{http_code}\n"`
Expected: `200`

Run: `curl -sf http://127.0.0.1:3000/ -o /dev/null -w "%{http_code}\n"`
Expected: `200`

- [ ] **Step 5: Verify the WS handshake works (optional but recommended)**

Run: `curl -sI -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" "http://127.0.0.1:8787/rooms/test/game?sessionId=local-smoke" | head -3`
Expected: a `400` or `404` from the server (handshake validation rejects the made-up roomId), but importantly NOT a connection refused. This confirms the server is listening and the upgrade path is reachable.

- [ ] **Step 6: Tear down the stack**

Run: `docker compose down`
Expected: both containers stopped and removed.

- [ ] **Step 7: Report success to the orchestrator**

No commit — verification only. The orchestrator should confirm the stack works end-to-end before triggering the human gate.

---

## Wave 5 gate

The orchestrator should pause here and surface to John:

> Docker stack verified locally. All code/config tasks complete and committed (~9 commits across waves 1–4). The next step is human-only AWS work. Pushing main to GitHub now is recommended so the host can clone it during bootstrap.

Wait for John to confirm before proceeding to the human gate.

---

## HUMAN GATE — AWS provisioning + first deploy

These steps are not executable by an agent — they require John to interact with the AWS Console, his domain registrar, his SSH client, and his browser. Each step has a clear checkpoint so John can confirm progress.

The orchestrator should present these one at a time and wait for John's confirmation between each.

### H1: Create the AWS account

- [ ] Go to https://aws.amazon.com/free/ and click "Create a free account."
- [ ] Use `johnrmoorman@gmail.com` as the root user email.
- [ ] Provide a credit card (required even on the free plan; no charges within free-tier limits).
- [ ] Complete the SMS verification step.
- [ ] Choose the **Basic support plan** (free).
- [ ] Sign in to the AWS Console.
- [ ] Switch the region in the top-right corner to **Europe (Frankfurt) eu-central-1**.

**Confirmation:** "Account created and signed in to eu-central-1."

### H2: Set up billing alerts

- [ ] Go to **Billing and Cost Management** → **Budgets**.
- [ ] Create a monthly budget of **$5** with alert at 80%, email to `johnrmoorman@gmail.com`.
- [ ] Go to **Billing preferences** → enable **Receive Free Tier usage alerts**.

**Confirmation:** "Budget alarm + free-tier alerts configured."

### H3: Launch the EC2 instance

- [ ] Go to **EC2** → **Launch instance**.
- [ ] Name: `skipbo-prod`.
- [ ] AMI: **Amazon Linux 2023 (ARM64)** — pick the kernel-default.
- [ ] Instance type: **`t4g.small`**.
- [ ] Key pair: **Create new key pair** named `skipbo`. Type: ED25519. Format: `.pem` (or `.ppk` if on Windows). **Download the key file** — you can't retrieve it later.
- [ ] Network settings → Edit:
  - Auto-assign public IP: Enable
  - Create security group named `skipbo-sg` with these rules:
    - SSH (22) from `0.0.0.0/0`
    - HTTP (80) from `0.0.0.0/0`
    - HTTPS (443) from `0.0.0.0/0`
- [ ] Storage: 8 GB gp3 (default).
- [ ] Click **Launch instance**. Wait ~2 minutes for `Status check: 2/2 checks passed`.

**Confirmation:** "Instance running, status checks passed. The downloaded key file is at `<path>`."

### H4: Allocate + attach an Elastic IP

- [ ] **EC2** → **Elastic IPs** → **Allocate Elastic IP address** → click **Allocate**.
- [ ] Select the new IP → **Actions** → **Associate Elastic IP address** → pick the `skipbo-prod` instance → **Associate**.
- [ ] Note the public IPv4 address (e.g. `52.59.123.45`).

**Confirmation:** "Elastic IP `<ip>` allocated and attached."

### H5: DNS A record at your registrar

- [ ] Log in to the registrar that hosts `johnmoorman.com`.
- [ ] Add a new A record:
  - Name/Host: `skipbo`
  - Type: A
  - Value: `<elastic IP from H4>`
  - TTL: 300 (5 minutes)
- [ ] Save.
- [ ] Verify propagation:
  ```bash
  dig +short skipbo.johnmoorman.com
  ```
  Expected: `<elastic IP>`. If empty, wait 60 seconds and retry.

**Confirmation:** "DNS resolves `skipbo.johnmoorman.com` to the elastic IP."

### H6: Configure local SSH and run bootstrap

- [ ] Move the downloaded key into `~/.ssh/`:
  ```bash
  mv ~/Downloads/skipbo.pem ~/.ssh/skipbo.pem
  chmod 600 ~/.ssh/skipbo.pem
  ```
- [ ] Add to `~/.ssh/config`:
  ```
  Host skipbo
    HostName <elastic IP>
    User ec2-user
    IdentityFile ~/.ssh/skipbo.pem
    StrictHostKeyChecking accept-new
  ```
- [ ] Test the connection:
  ```bash
  ssh skipbo "uname -a"
  ```
  Expected: a Linux uname line ending in `aarch64 GNU/Linux`.
- [ ] Push current main to origin so the host can clone it:
  ```bash
  git push origin main
  ```
- [ ] Run bootstrap:
  ```bash
  scp deploy/bootstrap.sh skipbo:/tmp/
  ssh skipbo "sudo bash /tmp/bootstrap.sh"
  ```
  Expected end of output: `✓ Bootstrap complete. Run deploy.sh from your laptop to bring up the app.`

**Confirmation:** "Bootstrap complete. nginx running, cert issued, repo cloned."

### H7: First deploy + browser verification

- [ ] Run the deploy script:
  ```bash
  ./deploy/deploy.sh
  ```
  Expected end of output: `→ Live: https://skipbo.johnmoorman.com`
- [ ] Open `https://skipbo.johnmoorman.com` in a browser. Confirm:
  - [ ] No browser warnings; padlock icon shown.
  - [ ] Lobby loads (you may need to enter a display name on first visit).
  - [ ] "Create room" works → redirects to `/rooms/<id>` → pre-game room renders.
- [ ] Open the same URL in a second tab/private window. Confirm:
  - [ ] Two distinct sessionIds (one per tab/window).
  - [ ] Tab 2 sees Tab 1's room in the lobby.
  - [ ] Both join the same room, host starts the game, both see the Board.
- [ ] Run validation commands:
  ```bash
  curl -I https://skipbo.johnmoorman.com 2>&1 | grep -i "strict-transport-security\|x-frame-options\|x-content-type-options"
  ```
  Expected: all three headers present.
- [ ] Test cert renewal mechanism:
  ```bash
  ssh skipbo "sudo certbot renew --dry-run"
  ```
  Expected: ends with `Congratulations, all simulated renewals succeeded`.
- [ ] Optional: visit https://www.ssllabs.com/ssltest/analyze.html?d=skipbo.johnmoorman.com — should grade A or A+ within 5 minutes.

**Confirmation:** "Deploy live and end-to-end gameplay verified."

---

## Wave 6 — Update CLAUDE.md (single)

### Task 11: Reflect the shipped state in CLAUDE.md

**Trigger:** John has confirmed H7 passes. The site is live and end-to-end gameplay works.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read the current CLAUDE.md to find the "Where we left off" section**

Run: `grep -n "Where we left off" CLAUDE.md`

- [ ] **Step 2: Replace the "Where we left off" section to reflect Section 7 shipped**

The new content should:
- Note Section 7 (AWS deploy) as shipped, with the live URL.
- Update "Next up" to point at Section 5 (real AI bots) or whatever John decides is next.
- Reference the new spec, plan, and learning docs.
- Note the 6-month account-expiry calendar reminder.

Use the existing format as a template (look at the current Section 6 / 6.5 paragraph structure). Keep the follow-ups list intact, plus add new ones from the deploy work:

- New follow-up: close CLAUDE.md follow-up #15 (sessionId in WS URL) per spec's "first post-deploy task."
- New follow-up: wire GitHub Actions per spec's `Open follow-ups` §2.
- New follow-up: AWS account expires in 6 months from signup — calendar reminder set / decision required at month 5.

- [ ] **Step 3: Update the Status snapshot section if needed**

Add a "Networking — production deploy (done)" bullet pointing at the spec, plan, and live URL.

- [ ] **Step 4: Update "What's next" to drop §3 (AWS deploy) and reorder remaining items**

Section 5 (AI bots) becomes §1. UI polish stays as the lower-priority item.

- [ ] **Step 5: Run typecheck + tests as a sanity check (no code changed but worth the gate)**

Run: `npx tsc --noEmit`
Run: `npm test`
Expected: same baselines as before — typecheck shows only the pre-existing follow-up #13 error; tests pass.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "Refresh CLAUDE.md with the shipped section 7 deploy state"
```

- [ ] **Step 7: Push**

```bash
git push origin main
```

---

## Final summary

After all waves complete:
- ~12 commits on main, each atomic and named per the project's commit style.
- Live URL: `https://skipbo.johnmoorman.com`
- Spec: `docs/superpowers/specs/2026-04-19-aws-deploy-design.md`
- Plan: `docs/superpowers/plans/2026-04-19-aws-deploy.md`
- Learning docs: `docs/learning/01–06`
- AWS billing: $0 used, alerts active.

**First post-deploy follow-up** (per spec): close the sessionId-in-URL-query concern by moving sessionId to `Sec-WebSocket-Protocol` header. Schedule for the next session.
