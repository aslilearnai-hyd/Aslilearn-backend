#!/usr/bin/env bash
# Run on the droplet (after git pull) so content uploads can be written.
set -euo pipefail

APP_ROOT="${1:-/var/www/ASLI-STUD-BACK}"
CONTENT="$APP_ROOT/uploads/content"

mkdir -p "$CONTENT"
chmod -R 755 "$APP_ROOT/uploads"

echo "OK: $CONTENT ready. If PM2 runs as another user, run:"
echo "  sudo chown -R <pm2-user>:<pm2-user> $APP_ROOT/uploads"
