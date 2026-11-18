#!/usr/bin/env bash
# Run from your own computer to upload Eclipse to a Debian server and install it:
#   ./deploy/deploy.sh root@82.29.71.45
# ssh asks for the password (or uses your SSH key). Optional: DOMAIN=yourdomain.com.
set -euo pipefail
TARGET="${1:?usage: deploy/deploy.sh user@host}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Uploading Eclipse to $TARGET ..."
tar -C "$ROOT" --exclude=node_modules --exclude=data/cache --exclude=data/rammerhead-sessions --exclude=.git -czf - . |
  ssh -o StrictHostKeyChecking=accept-new "$TARGET" \
    "rm -rf /root/eclipse-src && mkdir -p /root/eclipse-src && tar -xzf - -C /root/eclipse-src && DOMAIN='${DOMAIN:-}' bash /root/eclipse-src/deploy/install.sh"
