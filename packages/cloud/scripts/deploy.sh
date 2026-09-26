#!/usr/bin/env bash
# Deploy ccferry-cloud + PWA dist to the cloud host over SSH (systemd culture).
# Usage: PHONE_TOKEN=.. TUNNEL_TOKEN=.. HOST=root@39.105.92.24 packages/cloud/scripts/deploy.sh
# Host prerequisite (once): npm i -g tsx && mkdir -p /opt/ccferry
set -euo pipefail
: "${PHONE_TOKEN:?}" "${TUNNEL_TOKEN:?}" "${HOST:=root@39.105.92.24}"

pnpm --filter @ccferry/pwa build
pnpm --filter @ccferry/cloud exec tsc --noEmit

ssh "$HOST" "mkdir -p /opt/ccferry/cloud /opt/ccferry/pwa-dist"
scp -r packages/cloud/src "$HOST:/opt/ccferry/cloud/"
scp -r packages/cloud/package.json "$HOST:/opt/ccferry/cloud/"
scp -r packages/pwa/dist/* "$HOST:/opt/ccferry/pwa-dist/"
scp packages/cloud/deploy/ccferry-cloud.service "$HOST:/etc/systemd/system/"
ssh "$HOST" "sed -i \"s/__PHONE_TOKEN__/$PHONE_TOKEN/; s/__TUNNEL_TOKEN__/$TUNNEL_TOKEN/\" /etc/systemd/system/ccferry-cloud.service && chmod 600 /etc/systemd/system/ccferry-cloud.service && systemctl daemon-reload && systemctl enable --now ccferry-cloud && systemctl restart ccferry-cloud"
echo "deployed. journal: ssh $HOST journalctl -u ccferry-cloud -f"
