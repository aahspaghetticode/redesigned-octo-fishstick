#!/usr/bin/env bash
# henws hub installer. Run as root on a Debian/Ubuntu server from the project
# directory:   sudo bash deploy/install.sh
# Optional:    DOMAIN=hub.example.com sudo -E bash deploy/install.sh
# Without DOMAIN it uses <ip-with-dashes>.sslip.io so Let's Encrypt can issue
# a real certificate. HTTPS is required: Scramjet runs in a service worker.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/henws-hub
ENV_FILE=/etc/henws-hub.env
SVC_USER=henws

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync debian-keyring debian-archive-keyring apt-transport-https

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if [ "$(node_major)" -lt 20 ] 2>/dev/null || ! command -v node >/dev/null; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Copying app to $APP"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP"
rsync -a --delete --exclude node_modules --exclude data/cache --exclude .git "$SRC/" "$APP/"
mkdir -p "$APP/data/cache"
cd "$APP"
npm ci --omit=dev --no-audit --no-fund
chown -R "$SVC_USER:$SVC_USER" "$APP"

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Writing $ENV_FILE"
  cat > "$ENV_FILE" <<CONF
# henws hub settings. After editing: systemctl restart henws-hub
PORT=8080
HOST=127.0.0.1
# Jellyfin server the Media tab connects to. "stub" = not configured yet.
# Example: JELLYFIN_URL=http://192.168.1.20:8096
JELLYFIN_URL=stub
# Classroom 6x site the catalog is scraped from (its sitemap).
CLASSROOM6X_URL=https://classroom6x.com/
CONF
fi

echo "==> Installing systemd service"
install -m 644 "$APP/deploy/henws-hub.service" /etc/systemd/system/henws-hub.service
systemctl daemon-reload
systemctl enable --now henws-hub
systemctl restart henws-hub

if [ -z "${DOMAIN:-}" ]; then
  IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "==> Configuring Caddy for https://$DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
}
CADDY
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp && ufw allow 443/tcp
fi

sleep 2
if curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then
  echo
  echo "henws hub is running:  https://$DOMAIN"
  echo "Settings:              $ENV_FILE  (then: systemctl restart henws-hub)"
  echo "Logs:                  journalctl -u henws-hub -f"
else
  echo "The service didn't answer. Check: journalctl -u henws-hub -n 50"
  exit 1
fi
