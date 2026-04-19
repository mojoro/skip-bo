# Docker

## The problem Docker solves

"Works on my machine" — code runs locally but breaks on the server because of a different Node version, missing system library, slightly different OS, leftover environment variable. Every team loses days to this.

Docker fixes this by packaging your app **plus the OS it runs on** into a portable artifact. The artifact is identical bit-for-bit on your laptop, in CI, and in production.

## Three concepts: Dockerfile, image, container

- **Dockerfile** — a recipe. Plain text, declarative. "Start from Node 20 Alpine, copy in package.json, run npm install, copy in source, run build, expose port 8787."
- **Image** — the result of running the recipe. A read-only snapshot of a filesystem plus metadata about how to run it. Like a class.
- **Container** — a running instance of an image. Like an object instantiated from a class.

You build the image once (`docker build`), optionally push it to a registry, then run any number of containers from it (`docker run`).

## How layers and caching work

Each line in a Dockerfile produces a **layer** — a diff on top of the previous filesystem state. Docker caches every layer; if a line's input hasn't changed, Docker reuses the cached layer instead of re-running it.

This is why you see Dockerfiles structured like:

```dockerfile
COPY package.json package-lock.json ./
RUN npm ci                    # cached if package.json unchanged
COPY . .                       # rebuilt every code change
RUN npm run build
```

If you copied source first then ran `npm ci`, every code change would re-install all dependencies. The order matters for build speed.

## Multi-stage builds

The image you build with (Node, TypeScript compiler, dev dependencies, bundler) is much bigger than the image you actually need to run (just compiled JS + Node runtime). Multi-stage builds let you split:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
```

The final image only ships `dist/` plus Node, not the build tools. Skip-Bo's `server/Dockerfile` follows this pattern — final image is ~120 MB instead of ~600 MB.

## Why we use Docker for Skip-Bo

1. **Reproducibility** — the same image runs on the EC2 box that ran on your laptop. No "but it worked locally."
2. **Deploy = pull + restart** — instead of rsync-ing source and hoping the server has the right Node version, you push an image (or build one in place) and restart the container. Atomic.
3. **Isolation** — the server runs in its own filesystem and process namespace. It can't accidentally touch host files or interfere with nginx.
4. **Multiple processes side-by-side** — we run two containers on the EC2 box (Next.js + Node WebSocket server). Without Docker, you'd be juggling pm2 ecosystems and version conflicts.

## docker-compose

A single Docker container is "run one process." Real apps have multiple processes — a web server, a database, a job queue. **docker-compose** is a YAML file that declares them all and runs them as a unit.

For Skip-Bo (sketch):

```yaml
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    network_mode: host           # talk to nginx via 127.0.0.1:3000
    restart: unless-stopped
  srv:
    build:
      context: .
      dockerfile: server/Dockerfile
    environment:
      CORS_ORIGIN: https://skipbo.johnmoorman.com
    network_mode: host           # talk to nginx via 127.0.0.1:8787
    restart: unless-stopped
```

`docker compose up -d --build` builds both, starts both, runs them in the background. `--build` rebuilds images first; `pull` would download from a registry instead.

`restart: unless-stopped` means Docker auto-restarts a crashed container. Combined with `pm2-runtime` inside the server image (which restarts the Node process if *it* crashes), we get two layers of supervision.

## Why `network_mode: host` for us

Default Docker networking puts each container on its own virtual network and exposes ports through a NAT-like proxy. For two containers on a single box that talk to nginx on the host, that proxying is overhead with no benefit. `network_mode: host` lets the container bind directly to the host's network interfaces — `127.0.0.1:3000` from nginx's perspective lands directly inside the container.

This also keeps the security model crisp: the listening sockets are bound to `127.0.0.1` so they're only reachable from inside the EC2 instance. The security group blocks them from the public internet anyway, but defense in depth is cheap.

## Memory budget on t4g.small (2 GB RAM)

With both containers + nginx + the OS running on a single 2 GB box:

| Component                  | Approx resident memory |
|----------------------------|------------------------|
| OS + sshd + cron           | ~200 MB                |
| Docker daemon              | ~80 MB                 |
| nginx                      | ~20 MB                 |
| `web` container (Next.js)  | ~150 MB at idle        |
| `srv` container (Node WS)  | ~150 MB at idle        |
| **Total runtime**          | **~600 MB / 2048 MB**  |

Plenty of headroom for player connections. We also add a 1 GB swap file during bootstrap as defensive margin for Docker build spikes (a fresh image rebuild can briefly hit 1.5 GB of working memory).

## Interview-ready summary

> Docker lets us package the server with its OS so it runs identically anywhere. Skip-Bo uses two containers managed by docker-compose: a Next.js frontend and a Node WebSocket server. Multi-stage Dockerfiles strip build dependencies out of the runtime image, getting it down to ~120 MB. Containers use `network_mode: host` to talk to nginx on the EC2 instance via localhost without the overhead of Docker's bridge network. Restart policies plus pm2 inside the container give us two layers of process supervision. Runtime memory fits comfortably inside t4g.small's 2 GB with ~1.4 GB of headroom.
