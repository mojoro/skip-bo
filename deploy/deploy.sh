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
