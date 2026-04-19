# Topology decisions

## What "topology" means here

The set of machines in our deployment, the network paths between them, and the rules about which can talk to which.

For Skip-Bo we considered three:
1. **Everything on one EC2 box** *(chosen)*
2. **Vercel for frontend + EC2 for server**
3. **S3 + CloudFront for static frontend + EC2 for server**

This doc walks the reasoning so you can defend the choice in an interview.

## The same-origin policy and why it matters

Browsers enforce a security rule called the **same-origin policy**: JavaScript on `https://a.com` can't freely make requests to `https://b.com`. Without this, any malicious site could read data from your bank tab while you have it open elsewhere.

An **origin** is the tuple `(scheme, host, port)`:
- `https://skipbo.johnmoorman.com` and `https://api.skipbo.johnmoorman.com` are **different origins** (different host).
- `https://skipbo.johnmoorman.com/foo` and `https://skipbo.johnmoorman.com/bar/baz` are the **same origin** (paths don't matter).

When two origins need to talk, the server has to opt in via **CORS** (Cross-Origin Resource Sharing): it sends `Access-Control-Allow-Origin` headers naming the trusted origins.

WebSockets have a related concern: the server checks the `Origin` header at handshake time to prevent **Cross-Site WebSocket Hijacking** (a malicious page silently opening a WSS connection to your real backend using the user's cookies). Skip-Bo's server enforces this — see `server/src/index.ts:13`, the production check that refuses to start if `CORS_ORIGIN` is unset.

## Single-origin via path-based routing

We chose to put **everything on one EC2 box** with nginx routing by URL path:

```
skipbo.johnmoorman.com
├── /                      → Next.js (port 3000 internally)
├── /v1/*                  → REST server (port 8787 internally)
└── /rooms/*/game (WS)     → WebSocket server (port 8787 internally)
```

The browser only ever sees one origin: `skipbo.johnmoorman.com`. No CORS headers needed. Cookies (if we add auth later) work without `Domain=` gymnastics.

## Why we considered (and rejected) splitting

**Option B (Vercel + EC2)** would have been faster to ship — Vercel handles HTTPS + CDN + auto-deploy in minutes. But:
- Different origin → CORS required for every REST call and WebSocket handshake
- Two services to monitor, two bills (eventually)
- Less learning value for the AWS goal
- Future migration back to single-origin = more work than skipping the detour now

**Option C (S3 + CloudFront)** would be cheaper than EC2 hosting Next, but our app has dynamic routes (`/rooms/[roomId]`) that don't pre-render to static HTML cleanly. Would need refactoring to a SPA-shell pattern with client-side routing.

## DNS basics for this setup

We need exactly one DNS record:

```
skipbo.johnmoorman.com    A    <EC2 elastic IP>
```

**A records** map a name to an IPv4 address. The browser asks "where is `skipbo.johnmoorman.com`?", DNS replies with the IP, the browser opens TCP to that IP on port 443.

**CNAME records** would be used if we pointed at another DNS name (like `cname.vercel-dns.com`). Since we point at our own EC2 IP, A is the right tool.

We update the DNS at our domain registrar (wherever `johnmoorman.com` is registered). Propagation usually takes minutes once the TTL is honored.

## Cost shape

| Phase                 | Duration                          | Cost      | Notes                                                     |
|-----------------------|-----------------------------------|-----------|-----------------------------------------------------------|
| Free plan             | First 6 months from AWS signup    | $0        | Post-July-2025 free plan: $200 credits + t4g.small free   |
| Post-free             | Month 7 onward                    | ~$13/mo   | t4g.small on-demand in eu-central-1 + EBS + bandwidth     |

The account auto-closes at the end of the free plan unless upgraded to paid — critical decision point at month 5. See `01-aws-ec2.md` for the full details. Year-2 downgrade option if paid gets expensive: Lightsail at $3.50/mo with similar hardware.

## Interview-ready summary

> We deploy frontend and backend on one EC2 box behind nginx, which routes by URL path. This keeps everything on a single origin so CORS isn't needed, simplifies the security model, and reduces the number of moving parts. The alternative — Vercel for frontend + EC2 for server — would have shipped faster but introduces cross-origin requests, two separate deploys, and locks in the migration cost when consolidating later.
