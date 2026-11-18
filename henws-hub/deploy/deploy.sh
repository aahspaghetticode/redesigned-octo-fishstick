#!/usr/bin/env bash
# Run from your own computer to push henws hub to a server and install it:
#   ./deploy/deploy.sh root@82.29.71.45
# ssh will ask for the password (or use your SSH key). Pass DOMAIN=... to use
# your own domain instead of the free <ip>.sslip.io one.
set -euo pipefail
TARGET="${1:?usage: deploy/deploy.sh user@host}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Uploading to $TARGET ..."
tar -C "$ROOT" --exclude=node_modules --exclude=data/cache --exclude=.git -czf - . |
  ssh -o StrictHostKeyChecking=accept-new "$TARGET" \
    "rm -rf /root/henws-hub-src && mkdir -p /root/henws-hub-src && tar -xzf - -C /root/henws-hub-src && DOMAIN='${DOMAIN:-}' bash /root/henws-hub-src/deploy/install.sh"
