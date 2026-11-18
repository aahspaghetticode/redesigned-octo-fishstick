#!/usr/bin/env bash
# Eclipse installer for Debian (12/13) and Ubuntu. Run as root from the
# project directory:   bash deploy/install.sh
#
# Options (environment variables):
#   DOMAIN=hub.example.com   public hostname (default: <ip-with-dashes>.sslip.io)
#   WOMGINX=0                skip the Womginx engine (needs nginx + a subdomain)
#   WOMGINX_DOMAIN=...       hostname for Womginx (default: wg.$DOMAIN)
#
# HTTPS is required: Scramjet and Ultraviolet run in a service worker.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP=/opt/eclipse
ENV_FILE=/etc/eclipse.env
SVC_USER=eclipse
WOMGINX="${WOMGINX:-1}"

step() { printf '\n==> %s\n' "$*"; }
warn() { printf '    WARNING: %s\n' "$*" >&2; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
. /etc/os-release
echo "Installing Eclipse on $PRETTY_NAME"

step "Base packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync git debian-keyring debian-archive-keyring apt-transport-https

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if ! command -v node >/dev/null || [ "$(node_major)" -lt 20 ]; then
  step "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

if ! command -v caddy >/dev/null; then
  step "Caddy (HTTPS)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ---- move an earlier "henws hub" install out of the way ----
if [ -f /etc/systemd/system/henws-hub.service ]; then
  step "Removing the old henws-hub service"
  systemctl disable --now henws-hub || true
  rm -f /etc/systemd/system/henws-hub.service
  [ -f /etc/henws-hub.env ] && [ ! -f "$ENV_FILE" ] && cp /etc/henws-hub.env "$ENV_FILE"
  rm -rf /opt/henws-hub
  systemctl daemon-reload
fi

step "Copying Eclipse to $APP"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$APP"
rsync -a --delete --exclude node_modules --exclude data --exclude .git "$SRC/" "$APP/"
mkdir -p "$APP/data/cache"
[ -f "$SRC/data/c6x-extra.json" ] && cp "$SRC/data/c6x-extra.json" "$APP/data/"
cd "$APP"
npm ci --omit=dev --no-audit --no-fund
chown -R "$SVC_USER:$SVC_USER" "$APP"

# ---- hostnames ----
PUBLIC_IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
if [ -z "${DOMAIN:-}" ]; then DOMAIN="${PUBLIC_IP//./-}.sslip.io"; fi
WOMGINX_DOMAIN="${WOMGINX_DOMAIN:-wg.$DOMAIN}"

# ---- Womginx (optional engine on its own subdomain) ----
WOMGINX_URL=""
if [ "$WOMGINX" = "1" ]; then
  step "Womginx engine"
  resolved="$(getent ahostsv4 "$WOMGINX_DOMAIN" | awk 'NR==1{print $1}')"
  if [ "$resolved" != "$PUBLIC_IP" ]; then
    warn "$WOMGINX_DOMAIN resolves to '${resolved:-nothing}', not $PUBLIC_IP. Add a DNS A record for it, then re-run. Skipping Womginx."
  else
    if ! command -v nginx >/dev/null; then
      # Install nginx without starting it: Caddy owns ports 80/443.
      printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod +x /usr/sbin/policy-rc.d
      apt-get install -y nginx || true
      rm -f /usr/sbin/policy-rc.d
    fi
    systemctl disable --now nginx 2>/dev/null || true
    if bash "$APP/deploy/womginx/setup.sh"; then
      install -m 644 "$APP/deploy/womginx/eclipse-womginx.service" /etc/systemd/system/eclipse-womginx.service
      systemctl daemon-reload
      systemctl enable --now eclipse-womginx
      systemctl restart eclipse-womginx
      WOMGINX_URL="https://$WOMGINX_DOMAIN"
    else
      warn "Womginx setup failed (see output above). Eclipse will run without it."
    fi
  fi
fi

# ---- settings ----
step "Settings in $ENV_FILE"
touch "$ENV_FILE"
chmod 640 "$ENV_FILE"
chgrp "$SVC_USER" "$ENV_FILE"
ensure() { grep -q "^$1=" "$ENV_FILE" || printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; }
setkey() { if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; fi; }
grep -q "^# Eclipse settings" "$ENV_FILE" || sed -i '1i # Eclipse settings. After editing: systemctl restart eclipse' "$ENV_FILE"
ensure PORT 8080
ensure HOST 127.0.0.1
ensure JELLYFIN_URL stub
ensure CLASSROOM6X_URL https://classroom6x.com/
ensure SHELL_ENABLED true
ensure SHELL_USER root
setkey WOMGINX_URL "$WOMGINX_URL"

step "Eclipse service"
install -m 644 "$APP/deploy/eclipse.service" /etc/systemd/system/eclipse.service
systemctl daemon-reload
systemctl enable eclipse >/dev/null
systemctl restart eclipse

step "Caddy for https://$DOMAIN"
{
  printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:8080\n}\n' "$DOMAIN"
  if [ -n "$WOMGINX_URL" ]; then printf '\n%s {\n\treverse_proxy 127.0.0.1:8090\n}\n' "$WOMGINX_DOMAIN"; fi
} > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp && ufw allow 443/tcp
fi

# ---- shell prerequisites ----
if grep -q '^SHELL_ENABLED=true' "$ENV_FILE"; then
  shell_user="$(sed -n 's/^SHELL_USER=//p' "$ENV_FILE")"
  if command -v sshd >/dev/null; then
    eff="$(sshd -T -C user="${shell_user:-root}",host=localhost,addr=127.0.0.1 2>/dev/null || true)"
    if ! echo "$eff" | grep -qi '^passwordauthentication yes' && ! echo "$eff" | grep -qi '^kbdinteractiveauthentication yes'; then
      warn "sshd doesn't accept passwords from 127.0.0.1, so the web shell can't log in. See prompt.md, section 'Server shell'."
    fi
    if [ "${shell_user:-root}" = "root" ] && echo "$eff" | grep -qiE '^permitrootlogin (no|prohibit-password|without-password|forced-commands-only)'; then
      warn "sshd doesn't allow root password logins from 127.0.0.1, so the web shell can't log in as root. See prompt.md, section 'Server shell'."
    fi
  else
    warn "No sshd found. The web shell connects to 127.0.0.1:22; install openssh-server."
  fi
fi

sleep 3
if curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then
  echo
  echo "Eclipse is running:  https://$DOMAIN"
  echo "Engines:             $(curl -fsS http://127.0.0.1:8080/api/engines)"
  [ -n "$WOMGINX_URL" ] && echo "Womginx:             $WOMGINX_URL"
  echo "Settings:            $ENV_FILE  (then: systemctl restart eclipse)"
  echo "Logs:                journalctl -u eclipse -f"
else
  echo "Eclipse didn't answer on 127.0.0.1:8080. Check: journalctl -u eclipse -n 80"
  exit 1
fi
