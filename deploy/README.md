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
