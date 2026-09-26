#!/usr/bin/env bash
# Deploy ccferry-cloud + PWA dist to the cloud host over SSH (systemd culture).
# Usage: PHONE_TOKEN=.. TUNNEL_TOKEN=.. HOST=root@39.105.92.24 packages/cloud/scripts/deploy.sh
# Host prerequisites (once): nvm-managed node (pinned in the unit), pnpm + tsx via npm -g.
set -euo pipefail
: "${PHONE_TOKEN:?}" "${TUNNEL_TOKEN:?}" "${HOST:=root@39.105.92.24}"

pnpm --filter @ccferry/pwa build
pnpm --filter @ccferry/cloud exec tsc --noEmit

ssh "$HOST" "mkdir -p /opt/ccferry/cloud /opt/ccferry/protocol /opt/ccferry/pwa-dist"
scp -r packages/cloud/src "$HOST:/opt/ccferry/cloud/"
scp packages/cloud/package.json packages/cloud/tsconfig.json "$HOST:/opt/ccferry/cloud/"
scp packages/protocol/src "$HOST:/opt/ccferry/protocol/"
scp packages/protocol/package.json packages/protocol/tsconfig.json "$HOST:/opt/ccferry/protocol/"
scp pnpm-workspace.yaml pnpm-lock.yaml "$HOST:/opt/ccferry/"
scp -r packages/pwa/dist/* "$HOST:/opt/ccferry/pwa-dist/"
scp packages/cloud/deploy/ccferry-cloud.service "$HOST:/etc/systemd/system/"
# The server-side workspace covers cloud + protocol so the workspace:* link resolves.
ssh "$HOST" "printf 'packages:\n  - cloud\n  - protocol\n' > /opt/ccferry/pnpm-workspace.yaml"
ssh "$HOST" "export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && cd /opt/ccferry && pnpm install --prod --filter @ccferry/cloud --no-frozen-lockfile --registry=https://registry.npmmirror.com 2>&1 | tail -2"
ssh "$HOST" "sed -i \"s/__PHONE_TOKEN__/$PHONE_TOKEN/; s/__TUNNEL_TOKEN__/$TUNNEL_TOKEN/\" /etc/systemd/system/ccferry-cloud.service && chmod 600 /etc/systemd/system/ccferry-cloud.service && systemctl daemon-reload && systemctl enable --now ccferry-cloud && systemctl restart ccferry-cloud"
echo "deployed. journal: ssh $HOST journalctl -u ccferry-cloud -f"
