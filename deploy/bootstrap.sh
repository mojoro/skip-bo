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
#    Plain `certbot` (no python3-certbot-nginx) — we use the webroot method
#    in step 8 and never invoke the nginx plugin.
dnf update -y
dnf install -y docker nginx certbot git

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
