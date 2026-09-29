#!/bin/bash
# Runs on the server (sent by .github/workflows/deploy.yml through AWS SSM). Replaces the
# app with a fresh clone of the branch and (re)starts the Cogworks Frontier multiplayer
# server on port 80 as a systemd service. Hosted worlds live in /var/lib/cogworks and
# survive deploys.
set -euo pipefail
exec 2>&1
BRANCH="$1"
REPO="$2"
APP=/opt/tuff-game
DATA=/var/lib/cogworks
UNIT=tuff-game.service
export HOME=/root

# The server needs Node.js 18 or newer (no npm packages).
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if ! command -v node >/dev/null || [ "$(node_major)" -lt 18 ]; then
  echo "Installing Node.js"
  if command -v dnf >/dev/null; then dnf install -y nodejs
  elif command -v yum >/dev/null; then yum install -y nodejs
  else apt-get update -y && apt-get install -y nodejs; fi
fi
NODE=$(command -v node)
echo "node $($NODE -v) at $NODE"

rm -rf "$APP.new"
git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP.new"
(cd "$APP.new" && "$NODE" tools/build.mjs >/dev/null)
id tuff >/dev/null 2>&1 || useradd --system --no-create-home tuff
mkdir -p "$DATA"
chown -R tuff:tuff "$DATA"

# The running server saves every world when it stops.
systemctl stop "$UNIT" || true
rm -rf "$APP"
mv "$APP.new" "$APP"
chown -R tuff:tuff "$APP"
rm -rf "/etc/systemd/system/$UNIT.d"
cat > "/etc/systemd/system/$UNIT" <<EOF
[Unit]
Description=Cogworks Frontier multiplayer server
After=network-online.target
Wants=network-online.target

[Service]
User=tuff
WorkingDirectory=$APP
Environment=PORT=80 HOST=0.0.0.0 DATA_DIR=$DATA
ExecStart=$NODE $APP/server/server.js
Restart=always
RestartSec=2
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl reset-failed "$UNIT" || true
systemctl enable "$UNIT"
systemctl restart "$UNIT"
for i in $(seq 1 30); do curl -fsS -o /dev/null http://localhost/healthz && break; sleep 0.5; done
systemctl is-active "$UNIT"
echo "lobbies: $(curl -fsS http://localhost/api/lobbies)"
echo "serving on 80"
