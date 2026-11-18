#!/usr/bin/env bash
# Builds Womginx into /opt/womginx and writes a private nginx config for it
# (127.0.0.1:$WOMGINX_PORT). Called by deploy/install.sh; safe to re-run.
set -euo pipefail
WG=/opt/womginx
PORT="${WOMGINX_PORT:-8090}"
WOMBAT_COMMIT=78813ad   # upstream pins this; newer wombat breaks websockets

if [ ! -d "$WG/.git" ]; then
  rm -rf "$WG"
  git clone --depth 1 https://github.com/binary-person/womginx "$WG"
fi

if [ ! -f "$WG/public/wombat/dist/wombat.js" ]; then
  echo "    building wombat (client rewriter)"
  rm -rf "$WG/public/wombat" /tmp/eclipse-wombat
  git clone https://github.com/webrecorder/wombat /tmp/eclipse-wombat
  ( cd /tmp/eclipse-wombat && git checkout -q "$WOMBAT_COMMIT" \
    && npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund \
    && npm run build-prod )
  mkdir -p "$WG/public/wombat"
  mv /tmp/eclipse-wombat/dist "$WG/public/wombat/dist"
  rm -rf /tmp/eclipse-wombat
fi

CONF="$WG/nginx.eclipse.conf"
cp "$WG/nginx.conf" "$CONF"
# Debian paths/users, private listener, no TLS (Caddy terminates it).
sed -i \
  -e 's/^user nginx nginx;/user www-data www-data;/' \
  -e 's|^pid /run/nginx.pid;|pid /run/eclipse-womginx.pid;|' \
  -e '\|include /etc/nginx/conf.d/\*;|d' \
  -e 's|/home/binary/womginx/public|/opt/womginx/public|g' \
  -e '/ssl_certificate/d' -e '/listen 443/d' \
  -e "s/listen 80;/listen 127.0.0.1:${PORT};/" \
  -e 's/server_name womginx.arph.org;/server_name _;/' \
  -e 's/binary_remote_addr/http_x_forwarded_for/g' \
  -e 's|^http {|http {\n    access_log off;\n    error_log /var/log/eclipse-womginx.log warn;|' \
  "$CONF"
# Don't forward reverse-proxy headers to destination sites.
sed -i "s/proxy_set_header Accept-Encoding/proxy_set_header x-forwarded-for '';\n            proxy_set_header x-forwarded-proto '';\n            proxy_set_header x-forwarded-host '';\n            proxy_set_header via '';\n            proxy_set_header Accept-Encoding/" "$CONF"
# Refuse destinations on loopback/private networks, on every /main/ route.
sed -i 's|^    map_hash_bucket_size 128;|    map_hash_bucket_size 128;\n    map $request_uri $eclipse_private_target {\n        default 0;\n        "~*^/main(/[^/_]+_)?/((https?\|wss?):)?/+(localhost\|127\\.\|10\\.\|0\\.\|169\\.254\\.\|192\\.168\\.\|100\\.(6[4-9]\|[7-9][0-9]\|1[01][0-9]\|12[0-7])\\.\|172\\.(1[6-9]\|2[0-9]\|3[01])\\.\|\\[)" 1;\n    }|' "$CONF"
sed -i 's|^        merge_slashes off;|        merge_slashes off;\n        if ($eclipse_private_target) { return 403; }|' "$CONF"

nginx -t -q -c "$CONF"
echo "    womginx config OK ($CONF, 127.0.0.1:${PORT})"
