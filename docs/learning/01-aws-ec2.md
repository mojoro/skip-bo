# AWS and EC2

## What AWS is

Amazon Web Services is a cloud provider — you pay them for computing resources on demand instead of buying physical servers. They have ~200 services, but for most apps you touch maybe 5 regularly.

For Skip-Bo we use exactly two:
- **EC2** — virtual machines (this doc)
- **Route 53** *(or your existing registrar)* — DNS, one A record

No databases, no S3, no Lambda. The whole game runs on one EC2 box.

## What EC2 specifically is

EC2 = Elastic Compute Cloud. It's "rent a Linux machine by the hour."

You pick:
- **Instance type** — CPU + RAM + disk size. We use `t4g.small`: 2 vCPU (Graviton ARM), 2 GB RAM.
- **OS image (AMI)** — Amazon Linux 2023, Ubuntu, etc. We use Amazon Linux 2023 (ARM64 variant).
- **Region** — geographic location of the data center. We use `eu-central-1` (Frankfurt).
- **Storage** — usually a `gp3` SSD volume. We use 8 GB.

**Why t4g.small specifically:** Graviton is AWS's in-house ARM chip, which is cheaper per-core than the Intel/AMD equivalents and is eligible for the post-July-2025 AWS free plan (more below). 2 GB of RAM means Next.js builds don't OOM the way they would on the 1 GB `t2.micro` — simplifies the deploy. ARM is transparent as long as your Docker images are multi-arch, which `node:20-alpine` is.

AWS spins it up in ~2 minutes. You SSH in. From that point it's a normal Linux server — install whatever you want, run any process, pay for the hours it's powered on.

## Why EC2 (vs Lambda, ECS, Lightsail)

There's a spectrum from "raw VM" to "fully managed":

| Service        | What it gives you                          | Trade-off                                  |
|----------------|--------------------------------------------|--------------------------------------------|
| **EC2**        | Raw VM, full control                       | You install everything yourself            |
| **Lightsail**  | EC2 with simpler UI + bundled networking   | Less flexibility, fixed instance sizes     |
| **ECS Fargate**| Run containers, AWS handles the host        | Per-second billing, no host access         |
| **Lambda**     | Run a function on demand                    | Can't hold a long-lived process (e.g. WS)  |
| **App Runner** | Push a container, AWS runs it               | Black box; no learning value               |

We picked EC2 because:
1. **Skip-Bo's server holds in-memory state and long-lived WebSocket connections** — Lambda can't do that.
2. **Learning** — the "build from scratch" goal means seeing the moving parts directly.
3. **Free plan** — `t4g.small` is free under the post-July-2025 AWS free plan (see below).

App Runner in particular is worth flagging: it doesn't support WebSockets at all *and* AWS announced it stops accepting new customers April 30, 2026. It's not a candidate.

## Regions and availability zones

A **region** is a physical area (essentially a city). Each region contains multiple **availability zones** (separate buildings with independent power and network).

- `us-east-1` (Virginia) is AWS's oldest, cheapest region with every service available first.
- `eu-central-1` (Frankfurt) gets you ~20 ms RTT from central Europe vs ~100 ms to Virginia.

For a single-box hobby app, region choice mostly affects your own latency and that of your users. We picked Frankfurt for that reason.

## Security groups (the AWS firewall)

A **security group** is a stateful firewall wrapped around an EC2 instance. You declare which inbound ports are open and from where.

For Skip-Bo:
- Port 22 (SSH): inbound from your IP only
- Port 80 (HTTP): inbound from anywhere — needed for Let's Encrypt's HTTP-01 challenge and for the redirect-to-HTTPS server block
- Port 443 (HTTPS/WSS): inbound from anywhere
- Ports 3000 + 8787: **never exposed** — only reachable on `127.0.0.1` inside the box

Security groups are the difference between "production-ready" and "anyone on the internet can hit my Node debug endpoints." Default-deny is the right posture.

## Elastic IP

By default an EC2 instance gets a random public IP that **changes every time you stop and start it**. That breaks DNS — your A record would point at the wrong place after every reboot.

An **Elastic IP** is a permanent IP you allocate to your account and attach to the instance. It survives stop/start. Free as long as it's attached to a running instance (AWS charges if you allocate one and don't use it, to discourage IP hoarding).

## AWS free plan (critical 2025 change)

AWS made a major change in July 2025 that every new account is subject to. It's important to understand because it affects *when* Skip-Bo stops being free.

**Legacy free tier (accounts opened before July 15, 2025):** 12 months of `t2.micro` at 750 hrs/month. Same terms for 12 months, then full on-demand pricing.

**New free plan (accounts opened July 15, 2025 onward — this is us):**
- **6 months** from signup, not 12.
- **$200 in credits** ($100 automatic + $100 earnable via onboarding tasks).
- Expanded eligible instance types: `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, `c7i-flex.large`, `m7i-flex.large`.
- The account **automatically closes** at the 6-month mark unless you upgrade to a paid plan. Resources are deleted after a 90-day grace period.

**Implication for Skip-Bo:** the deploy is free for six months. Around month 5 you have a decision: upgrade to paid ($13/mo for t4g.small on-demand in eu-central-1) or take the project down. Setting a calendar reminder during bootstrap is the difference between a planned migration and losing the project to auto-close.

## Interview-ready summary

> EC2 gives you a virtual Linux machine on demand. We picked it over Lambda because the WebSocket server holds long-lived connections and in-memory state, which serverless can't. The instance (`t4g.small`, 2 GB RAM, ARM Graviton) is wrapped in a security group acting as a stateful firewall; only ports 22, 80, and 443 are exposed publicly. The Node processes bind to localhost-only ports (3000, 8787) and nginx fronts them. We use an Elastic IP so the public address survives reboots, and run in eu-central-1 for European latency. The post-July-2025 AWS free plan covers 6 months of use — a calendar reminder at month 5 handles the transition to paid (~$13/mo) or shutdown.
