#!/usr/bin/env bash
# Deploy ccferry-cloud + PWA dist to the cloud host over SSH (systemd culture).
# Usage: PHONE_TOKEN=.. TUNNEL_TOKEN=.. HOST=root@39.105.92.24 packages/cloud/scripts/deploy.sh
# Host prerequisites (once): nvm-managed node (pinned in the unit), pnpm + tsx via npm -g.
# VAPID keys for web push are generated on the host once (/root/.ccferry/vapid.json) and reused.
set -euo pipefail
: "${PHONE_TOKEN:?}" "${TUNNEL_TOKEN:?}" "${HOST:=root@39.105.92.24}"

pnpm --filter @ccferry/pwa build
pnpm --filter @ccferry/cloud exec tsc --noEmit

ssh "$HOST" "mkdir -p /opt/ccferry/cloud /opt/ccferry/protocol /opt/ccferry/pwa-dist"
scp -r packages/cloud/src "$HOST:/opt/ccferry/cloud/"
scp packages/cloud/package.json packages/cloud/tsconfig.json "$HOST:/opt/ccferry/cloud/"
scp -r packages/protocol/src "$HOST:/opt/ccferry/protocol/"
scp packages/protocol/package.json packages/protocol/tsconfig.json "$HOST:/opt/ccferry/protocol/"
scp pnpm-workspace.yaml pnpm-lock.yaml "$HOST:/opt/ccferry/"
scp -r packages/pwa/dist/* "$HOST:/opt/ccferry/pwa-dist/"
scp packages/cloud/deploy/ccferry-cloud.service "$HOST:/etc/systemd/system/"
# The server-side workspace covers cloud + protocol so the workspace:* link resolves.
ssh "$HOST" "printf 'packages:\n  - cloud\n  - protocol\n' > /opt/ccferry/pnpm-workspace.yaml"
# pipefail must be set REMOTELY: the remote pipeline's status is tail's, so
# without it a failed install sails into sed+restart with a broken deploy.
ssh "$HOST" "set -o pipefail; export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && cd /opt/ccferry && pnpm install --prod --filter @ccferry/cloud --no-frozen-lockfile --config.minimumReleaseAge=0 --registry=https://registry.npmmirror.com 2>&1 | tail -2"
ssh "$HOST" "mkdir -p /root/.ccferry /var/lib/ccferry && if [ ! -s /root/.ccferry/vapid.json ]; then export NVM_DIR=\$HOME/.nvm && . \$NVM_DIR/nvm.sh && node -e \"const wp=require('/opt/ccferry/node_modules/web-push');process.stdout.write(JSON.stringify(wp.generateVAPIDKeys()))\" > /root/.ccferry/vapid.json; fi"
VAPID_PUBLIC=$(ssh "$HOST" "grep -oP '\"publicKey\":\\s*\"\\K[^\"]+' /root/.ccferry/vapid.json")
VAPID_PRIVATE=$(ssh "$HOST" "grep -oP '\"privateKey\":\\s*\"\\K[^\"]+' /root/.ccferry/vapid.json")
ssh "$HOST" "sed -i \"s/__PHONE_TOKEN__/$PHONE_TOKEN/; s/__TUNNEL_TOKEN__/$TUNNEL_TOKEN/; s/__VAPID_PUBLIC__/$VAPID_PUBLIC/; s/__VAPID_PRIVATE__/$VAPID_PRIVATE/\" /etc/systemd/system/ccferry-cloud.service && chmod 600 /etc/systemd/system/ccferry-cloud.service && systemctl daemon-reload && systemctl enable --now ccferry-cloud && systemctl restart ccferry-cloud"
echo "deployed. journal: ssh $HOST journalctl -u ccferry-cloud -f"
