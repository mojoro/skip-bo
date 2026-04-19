# Skip-Bo deploy learning docs

A companion to the Section 7 AWS deploy work. Each file explains one piece of the production stack in plain English: what it is, why it's there, how it fits into the system, and a short summary you can drop into an interview.

Read in order — each builds on the previous.

1. [AWS and EC2](01-aws-ec2.md) — what AWS is, what EC2 specifically is, regions, free tier, security groups
2. [Topology decisions](02-topology.md) — why everything-on-one-EC2 vs Vercel split, single-origin vs cross-origin, the trade-offs
3. [Docker](03-docker.md) — containers vs images, docker-compose, why it's the unit of deploy
4. [nginx as reverse proxy](04-nginx.md) — what a reverse proxy is, TLS termination, the WebSocket Upgrade dance
5. [TLS and Let's Encrypt](05-tls-letsencrypt.md) — how HTTPS actually works, ACME, certbot *(coming with Section 4 of the design)*
6. [Deploy workflow](06-deploy-workflow.md) — manual script, then CI/CD with GitHub Actions *(coming with Section 5 of the design)*

## How these relate to the spec

The spec at `docs/superpowers/specs/2026-04-19-aws-deploy-design.md` (forthcoming) is the **what**: the architecture decisions and the concrete config values.

These learning docs are the **why**: the conceptual background for each piece of the spec, written assuming you've never touched Docker or nginx in production before.
