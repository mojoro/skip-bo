# Deploy workflow

## Two scripts, one habit

Production deploys for Skip-Bo are two bash scripts:

- **`deploy/bootstrap.sh`** — runs *once*, on a fresh EC2 box, sets up everything (Docker, swap, certs, nginx config, repo clone).
- **`deploy/deploy.sh`** — runs *every deploy*, from your laptop, pushes the latest `main` to the box and rebuilds the containers.

Together with `git push` (to publish your changes) they form the entire deploy habit:

```
edit code → commit → git push origin main → ./deploy/deploy.sh
```

## Bootstrap: what it does and why

The bootstrap script's job is to take a vanilla Amazon Linux 2023 EC2 instance and turn it into a Skip-Bo host. It runs as root (via `sudo`).

The major steps and the reasoning:

**1. System packages.** `dnf install -y docker nginx certbot python3-certbot-nginx git`. These are all in the AL2023 default repos. The `docker` package gives you the Docker Engine, but **not** the modern `docker compose` plugin — that's installed separately in step 2.

**2. Docker Compose plugin.** AL2023 ships Docker but not the `compose` v2 plugin. We download the binary directly from GitHub releases into `/usr/local/lib/docker/cli-plugins/` where the Docker CLI looks for plugins. After this, `docker compose version` works.

**3. Add `ec2-user` to docker group.** Without this, every `docker compose` command needs `sudo`. With it, the deploy script runs as the regular SSH user.

**4. Swap file (1 GB, defensive).** On a t4g.small with 2 GB RAM, swap isn't strictly necessary — runtime sits comfortably around 600 MB — but the Next.js production build can peak at 1.5 GB of working memory. A 1 GB swap file on the gp3 root volume (no extra cost) absorbs those spikes instead of risking an OOM kill during a deploy. The `/etc/fstab` entry makes it survive reboots. If we'd picked the 1 GB t2.micro this step would be essential rather than defensive.

**5. Repo clone to `/opt/skip-bo`.** The host needs the source code (we build images on the host rather than pushing pre-built images from a registry). `/opt/` is the FHS-standard location for "self-contained third-party software." `chown ec2-user` so the deploy script (running as ec2-user) can update it.

**6. TLS cert via certbot --standalone.** nginx isn't running yet, so certbot can grab port 80 to do the HTTP-01 ACME challenge directly. The cert lands at `/etc/letsencrypt/live/skipbo.johnmoorman.com/{fullchain,privkey}.pem`. See `05-tls-letsencrypt.md` for the protocol details.

**7. Install production nginx config.** Our hand-written `deploy/nginx.conf` (in the repo) references the cert paths from step 6. We copy it into `/etc/nginx/conf.d/skipbo.conf` and remove the default config that ships with AL2023's nginx.

**8. Renewal hook.** When certbot auto-renews the cert (every ~60 days), nginx needs to reload to pick up the new cert files. A deploy hook script in `/etc/letsencrypt/renewal-hooks/deploy/` runs `systemctl reload nginx` after every successful renewal.

**9. Start nginx.** `systemctl enable --now nginx` starts it now and on every boot.

**10. Verify the systemd renewal timer is active.** AL2023 ships `certbot-renew.timer` enabled by default; we just verify.

## Deploy script: what it does and why

The deploy script runs from your laptop and is meant to be safe to invoke any number of times.

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
```

**`set -euo pipefail`** — the bash safety boilerplate. `-e` exits on any error, `-u` errors on undefined variables, `-o pipefail` makes piped commands fail if any stage fails.

**`git reset --hard origin/main`** instead of `git pull` — `pull` would try to merge if the host clone has any local commits or untracked changes. `reset --hard` makes the host exactly mirror remote main, no questions asked. Predictable.

**`docker compose up -d --build`** — `-d` detaches (script returns immediately), `--build` rebuilds images from the current source. Docker's layer caching makes incremental builds fast (only rebuilds layers whose inputs changed).

**`docker image prune -f`** — every rebuild leaves a previous image without a tag (a "dangling" image). They accumulate and fill the 8 GB disk. `-f` skips the confirmation prompt.

**`curl -sf` health checks** — `-s` silent, `-f` fails on HTTP error. They hit `127.0.0.1` to bypass nginx and verify the containers themselves are healthy. If either fails, `set -e` halts the script with a non-zero exit code.

## Why we don't use a container registry yet

A more "production-grade" pattern is:
1. Build images on a dev machine or in CI.
2. Push to a container registry (Docker Hub, GitHub Container Registry, AWS ECR).
3. Server pulls the pre-built image.

The advantages: faster server-side deploys, builds tested before deploy, no build dependencies on the production host.

We **don't** do this for v1 because:
- It adds a registry to manage (auth, tags, retention).
- The host has plenty of CPU and (with swap) enough RAM to build.
- The simpler workflow has fewer failure modes for a hobby app.

When we add GitHub Actions in v2, it makes sense to migrate to a registry — the GHA runner can't SSH into the host to build, so it has to push to *somewhere* the host can pull from.

## The GHA migration path (when we get to it)

The bash script above already separates "what runs on the host" from "what runs from the laptop." The host-side commands are essentially:

```bash
cd /opt/skip-bo
git fetch origin main && git reset --hard origin/main
docker compose up -d --build
docker image prune -f
```

A GitHub Actions workflow becomes ~30 lines: install an SSH agent, load a private key from GitHub Secrets, SSH to the host, run those four commands. No invention required.

## Operational things to know

**Where do logs live?**

Each container's stdout/stderr is captured by Docker. View them with:

```bash
ssh skipbo "docker compose -f /opt/skip-bo/docker-compose.yml logs -f srv"
ssh skipbo "docker compose -f /opt/skip-bo/docker-compose.yml logs -f web"
```

`-f` is "follow" — like `tail -f`. Useful for debugging a deploy that's misbehaving.

**How do I roll back?**

```bash
ssh skipbo "cd /opt/skip-bo && git reset --hard <previous-sha> && docker compose up -d --build"
```

The host has the full git history (via `git fetch`), so any past SHA is reachable.

**What about active games during a deploy?**

Skip-Bo holds game state in memory. Every container restart drops in-flight games. The server's existing `installShutdown` logic closes WebSocket connections cleanly with code 1001 ("going away"), so clients see the disconnect promptly rather than timing out. Document this as a known characteristic and deploy during quiet times.

**How do I see how much memory/CPU is being used?**

```bash
ssh skipbo "docker stats --no-stream"
ssh skipbo "free -h"
```

Useful for verifying the swap file isn't being thrashed, or that no container is leaking memory.

## Interview-ready summary

> Deploys are two bash scripts: a one-time `bootstrap.sh` that turns a fresh EC2 instance into a Skip-Bo host, and a repeatable `deploy.sh` that pushes new code from the laptop. The deploy script does `git reset --hard origin/main` (not pull, to keep the host exactly synced), `docker compose up --build` (uses Docker layer caching to speed up rebuilds), prunes dangling images to keep the disk clean, then curls localhost to verify both containers are healthy. The GitHub Actions migration later just wraps the same host-side commands in an SSH-agent workflow — no rewrite needed. Container logs go through Docker, rollbacks are `git reset --hard <sha>`, and active games drop on every restart (acceptable for a toy app).
