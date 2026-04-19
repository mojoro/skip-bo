# TLS and Let's Encrypt

## What TLS actually does

TLS (Transport Layer Security) is the encryption protocol that makes HTTPS, WSS, and most other "secure" network protocols what they are. It does three things at once:

1. **Encryption** — nobody on the network path between client and server can read the bytes.
2. **Integrity** — nobody can modify the bytes in flight without detection.
3. **Identity** — the client knows the server it's talking to is the real owner of the domain (not a man-in-the-middle).

The "S" in HTTPS is TLS. The "SS" in WSS is the same TLS. They're regular HTTP and WebSocket sitting inside a TLS-encrypted tunnel.

## How identity works (certificates)

When the browser connects to `https://skipbo.johnmoorman.com`, the server hands over a **certificate** — a signed document saying "the entity at this domain controls this public key." The browser verifies the signature against a list of trusted **Certificate Authorities** (CAs) it ships with.

Any CA in that trusted list can sign for any domain. Historically you bought certificates from commercial CAs (DigiCert, GoDaddy) for $50–$500/year. Let's Encrypt changed that — it's a free, automated CA run by the nonprofit Internet Security Research Group, trusted by every major browser since 2016.

## Why HTTPS matters here (mixed-content rule)

You could technically skip TLS for a hobby project, but the deploy doesn't work without it. The browser enforces a **mixed-content rule**: a page loaded over `https://` is **forbidden from opening a `ws://` connection**. It must be `wss://` (TLS-wrapped WebSocket).

Since modern browsers auto-redirect known popular domains to HTTPS and increasingly warn on plain HTTP, "no TLS" really means "the WebSocket layer breaks." TLS is mandatory for our deploy.

## ACME — the automation protocol

Let's Encrypt issues certificates via the **ACME** (Automatic Certificate Management Environment) protocol. ACME defines how a client (your machine) proves to the CA (Let's Encrypt) that it controls a domain, then receives a signed certificate.

The most common proof is the **HTTP-01 challenge**:

1. You ask Let's Encrypt for a cert for `skipbo.johnmoorman.com`.
2. Let's Encrypt replies with a random token.
3. You serve that token at `http://skipbo.johnmoorman.com/.well-known/acme-challenge/<token>`.
4. Let's Encrypt fetches the token from the URL. If it matches, you've proved control.
5. Let's Encrypt issues the cert.

Other challenges exist (DNS-01 for wildcard certs), but HTTP-01 is the simplest for a single subdomain.

## certbot — the ACME client

**certbot** is the canonical ACME client. It speaks the protocol, manages your private key, and tracks expiration.

Three usage modes for our setup:

### `--standalone`
certbot temporarily binds port 80 itself, completes the HTTP-01 challenge, then releases the port. Requires nginx to be stopped first. **What we use during bootstrap** (port 80 is free on a fresh box).

### `--nginx`
certbot detects your existing nginx config and modifies it to serve the challenge response, plus auto-rewrites the config to add the 443 server block and HTTP→HTTPS redirect. Convenient but mixes certbot-generated edits with your hand-written config. Harder to reason about long-term.

### `certonly --webroot`
certbot writes the challenge file into a directory served by your already-running nginx (`/var/www/html` or similar). Doesn't touch nginx config. Good for "I want full control of my nginx config."

We picked **`certonly --webroot`** for Skip-Bo's bootstrap. The flow:

1. Install nginx with a minimal HTTP-only config that serves `/.well-known/acme-challenge/` from `/var/www/letsencrypt`.
2. Run `certbot certonly --webroot -w /var/www/letsencrypt -d <domain>`. certbot writes the challenge file into the webroot; nginx serves it; Let's Encrypt fetches and validates.
3. Replace nginx config with the production version (which keeps the ACME location for future renewals).

Why not `--standalone`? It would have worked for the initial issue (port 80 is free on a fresh box), but every subsequent renewal needs port 80 free too — and by then nginx is holding it. Renewal would require stopping nginx for ~30 s. `--webroot` avoids that entirely: nginx keeps serving traffic while certbot drops a file into the webroot and Let's Encrypt reads it through nginx.

Why not `--nginx`? It auto-edits your nginx config, mixing certbot-managed edits with your hand-written ones. Harder to reason about long-term; harder to diff in git. Our hand-written config references the cert paths directly.

## Renewal lifecycle

Let's Encrypt certificates are valid for **90 days**. certbot is designed to renew at day 60 (30-day buffer).

Amazon Linux 2023 ships a pre-enabled systemd timer (`certbot-renew.timer`) that runs `certbot renew` twice daily. `certbot renew` checks each cert; if it's within 30 days of expiry, it renews. Otherwise it's a no-op.

After renewal, nginx must reload to pick up the new cert files. We hook this with:

```
/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh:
  #!/bin/bash
  systemctl reload nginx
```

Anything in `renewal-hooks/deploy/` runs after a successful renewal.

## Rate limits to be aware of

Let's Encrypt enforces rate limits to prevent abuse:
- **50 certificates per registered domain per week.** You'd have to be deliberately wasteful to hit this.
- **5 duplicate certificates per week** (same exact set of names). Easy to hit if you're debugging by re-issuing repeatedly. Use `--dry-run` while iterating.
- **5 failed validations per account per hostname per hour.** Prevents the "wrong DNS, retry every minute" pattern.

The fix when you're debugging: always test with `certbot certonly --dry-run ...` first. The dry-run path uses the staging environment which has no rate limits and produces cert files that browsers won't trust (so you know it's a test).

## What our config actually does for security

Beyond the cert itself, nginx's TLS config decides which ciphers to allow:

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers HIGH:!aNULL:!MD5;
ssl_prefer_server_ciphers on;
```

These rule out broken or deprecated protocols (SSLv3, TLS 1.0/1.1) and weak ciphers (MD5, anonymous Diffie-Hellman). certbot's `--nginx` plugin sets sane defaults; in our `--standalone` flow we set them ourselves in `nginx.conf`.

Optional but recommended security headers (we add these to the 443 block):

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

- **HSTS** tells the browser "always use HTTPS for this domain for the next year." Prevents downgrade attacks.
- **X-Content-Type-Options: nosniff** stops the browser from second-guessing MIME types (defense against MIME confusion attacks).
- **X-Frame-Options: DENY** prevents the page from being loaded in an iframe (defense against clickjacking).
- **Referrer-Policy** limits how much URL info leaks to other sites the user navigates to.

## Interview-ready summary

> TLS gives us encryption, integrity, and identity in one protocol. Let's Encrypt issues free certificates via the ACME protocol; our bootstrap uses certbot's `--standalone` mode to grab the cert before nginx starts, then a hand-written nginx config references the cert files directly. Renewals are automated by systemd's `certbot-renew.timer` (twice daily), and a deploy hook reloads nginx after each renewal. The 90-day cert lifetime is intentional — short lifetimes mean stolen keys can't be abused for long, and full automation means short lifetimes don't burden operators.
