#!/usr/bin/env bash
# Push this site to a Docker-capable server and (re)start it.
#   SERVER=root@1.2.3.4 REMOTE_DIR=/srv/goldenwok ./deploy.sh
set -euo pipefail

SERVER="${SERVER:?set SERVER=user@host}"
REMOTE_DIR="${REMOTE_DIR:?set REMOTE_DIR=/srv/<site>}"

echo "▸ syncing files to $SERVER:$REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude prisma/dev.db \
  ./ "$SERVER:$REMOTE_DIR/"

echo "▸ building & starting container"
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d --build"

echo "✓ deployed. First boot pushes the schema and seeds an empty database."
echo "  admin login: see .env / README (change the password right away)"
