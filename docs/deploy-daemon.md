# ccferry daemon & cloud deployment

[English](deploy-daemon.md) | [中文](deploy-daemon.zh-CN.md)

Single-package deployment (spec D5': one process, one artifact, one command) and per-OS autostart configuration.

- Production form = the `dist-single/` folder: `ccferry-client(.exe)` (Bun-compiled, all JS embedded) plus the sibling `claude(.exe)` (~245MB — the agent SDK's native CLI, which `bun --compile` cannot embed; the driver looks for it beside its own exe at runtime and passes it explicitly)
- Dev form (`pnpm --filter @ccferry/client start`, node+tsx) is for development only; not covered here
- Verification markers: **PC daemon on Windows — verified 2026-09-30; cloud on Linux x64 — verified 2026-09-30**; the Linux / macOS *client* autostart sections are **untested** — verify on first use and update this doc

## 1. Prerequisites

| Tool | Purpose |
|---|---|
| node ≥ 22 | build-time resolution of the platform sidecar; not needed at runtime |
| pnpm | workspace install |
| bun ≥ 1.4 | `bun build --compile` |

```bash
git clone <repo> && cd ccferry
pnpm install
```

## 2. Build the single package

```bash
bash scripts/build-single.sh client
# produces:
#   dist-single/ccferry-client.exe   (~91MB)
#   dist-single/claude.exe           (~245MB, copied from the SDK platform package)
# on Linux/macOS the names carry no .exe suffix
```

The script auto-detects the host platform. An optional second argument cross-compiles, e.g. `bash scripts/build-single.sh cloud bun-linux-x64` builds the Linux cloud binary on a Windows box (see §6).

## 3. Configuration

### 3.1 `~/.ccferry/config.json` (behavior config, all optional)

```json
{
  "vaultPath": "D:/Development/.../my-obsidian-docs",
  "toolWhitelist": ["Read", "Glob", "Grep", "LS", "TodoWrite"],
  "approvalTimeoutMs": 60000
}
```

Field semantics in `README.md`. Without `vaultPath`, `/api/vault/*` returns 503.

### 3.2 `~/.ccferry/daemon.env` (credentials — lock down permissions)

```ini
CCFERRY_TOKEN=<API token used by the phone/PWA>
CCFERRY_TUNNEL_URL=wss://<cloud-domain>/tunnel
CCFERRY_TUNNEL_TOKEN=<tunnel token, same value the cloud systemd unit carries>
```

- Omitting the two tunnel vars = pure local mode (without a token the daemon binds 127.0.0.1 only — safe default)
- Optional: `CCFERRY_PORT` (default 8787), `CCFERRY_HOST` (with a token, `0.0.0.0` opens LAN)
- **Permissions**: Linux/macOS `chmod 600 ~/.ccferry/daemon.env`; Windows via icacls — see §5.1

## 4. Manual verification

```bash
cd dist-single && ./ccferry-client(.exe)
# in another terminal:
curl -s http://127.0.0.1:8787/api/projects -H "Authorization: Bearer <token>" | head -c 200
# a real project listing means it works; with tunnel env set, the log must show
# "ccferry-tunnel: tunnel authenticated"
```

## 5. Autostart (PC daemon)

### 5.1 Windows — Task Scheduler (verified 2026-09-30)

Three files + one registration:

**`%USERPROFILE%\.ccferry\start-daemon.cmd`** (load env → run exe → append log):

```bat
@echo off
for /f "usebackq tokens=1,* delims==" %%A in ("%USERPROFILE%\.ccferry\daemon.env") do set "%%A=%%B"
if not exist "%USERPROFILE%\.ccferry\logs" mkdir "%USERPROFILE%\.ccferry\logs"
cd /d "<repo>\dist-single"
ccferry-client.exe >> "%USERPROFILE%\.ccferry\logs\daemon.log" 2>&1
```

**`%USERPROFILE%\.ccferry\start-daemon-hidden.vbs`** (hides the console; logon tasks run Interactive, without this a window stays open). The `True` wait argument is load-bearing: wscript stays alive with the daemon, so a non-zero daemon exit marks the task failed and RestartOnFailure fires. With `False`, wscript exits at once, the task reports success long before the daemon dies, and nothing restarts it (verified the hard way 2026-09-30):

```vbs
CreateObject("WScript.Shell").Run """" & CreateObject("Scripting.FileSystemObject").BuildPath(CreateObject("WScript.Shell").ExpandEnvironmentStrings("%USERPROFILE%"), ".ccferry\start-daemon.cmd") & """", 0, True
```

**Lock the env file, register, patch** (the default 72h execution time limit kills long-running daemons — PT0S is mandatory):

```powershell
icacls "$env:USERPROFILE\.ccferry\daemon.env" /inheritance:r /grant:r "$env:USERNAME`:RW"

schtasks /create /f /tn "ccferry-daemon" `
  /tr 'wscript.exe "C:\Users\<user>\.ccferry\start-daemon-hidden.vbs"' /sc onlogon

# critical patch: no time limit + restart on failure (1min interval x3)
$svc = New-Object -ComObject Schedule.Service; $svc.Connect()
$folder = $svc.GetFolder('\')
$def = $folder.GetTask('ccferry-daemon').Definition
$def.Actions.Item(1).Path = 'wscript.exe'
$def.Actions.Item(1).Arguments = '"C:\Users\<user>\.ccferry\start-daemon-hidden.vbs"'
$def.Settings.ExecutionTimeLimit = 'PT0S'
$def.Settings.RestartInterval = 'PT1M'; $def.Settings.RestartCount = 3
$folder.RegisterTaskDefinition('ccferry-daemon', $def, 6, $null, $null, $null)
```

> Note: on the reference machine `Register-ScheduledTask` (CIM) failed with "Unspecified error / RPC failed"; the `schtasks` + COM patch path works. If CIM works on yours, `Register-ScheduledTask -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1))` does it in one step.

Manage: `schtasks /run|/end|/query /tn ccferry-daemon`.

### 5.2 Linux — systemd user unit (untested)

`~/.config/systemd/user/ccferry.service`:

```ini
[Unit]
Description=ccferry PC daemon (single package)

[Service]
WorkingDirectory=%h/<repo>/dist-single
EnvironmentFile=%h/.ccferry/daemon.env
ExecStart=%h/<repo>/dist-single/ccferry-client
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
chmod 600 ~/.ccferry/daemon.env
systemctl --user daemon-reload && systemctl --user enable --now ccferry
loginctl enable-linger $USER   # survive non-logged-in periods (needs admin or polkit)
```

Bonus: stdout goes to the journal (`journalctl --user -u ccferry -f`), log rotation for free.

### 5.3 macOS — launchd (untested)

`~/Library/LaunchAgents/com.ccferry.daemon.plist` (launchd has no EnvironmentFile — wrap with a script that sources):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ccferry.daemon</string>
  <key>ProgramArguments</key><array>
    <string>/Users/<user>/.ccferry/start-daemon.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/<user>/.ccferry/logs/daemon.log</string>
  <key>StandardErrorPath</key><string>/Users/<user>/.ccferry/logs/daemon.log</string>
</dict></plist>
```

`~/.ccferry/start-daemon.sh`: `set -a; . "$HOME/.ccferry/daemon.env"; set +a; cd "<repo>/dist-single" && exec ./ccferry-client` (make executable). Load: `launchctl load ~/Library/LaunchAgents/com.ccferry.daemon.plist`.

## 6. Cloud server deployment (verified 2026-09-30)

The cloud binary needs no sidecar (fastify/websocket/static only). Cross-compile on the dev box and swap the systemd unit:

```bash
# dev box (e.g. Windows -> Linux x64 server)
bash scripts/build-single.sh cloud bun-linux-x64   # -> dist-single/ccferry-cloud (ELF)
scp dist-single/ccferry-cloud root@<server>:/opt/ccferry-cloud/ccferry-cloud

# server
ssh root@<server>
chmod +x /opt/ccferry-cloud/ccferry-cloud
cp /etc/systemd/system/ccferry-cloud.service /etc/systemd/system/ccferry-cloud.service.bak-node
sed -i 's|^ExecStart=.*|ExecStart=/opt/ccferry-cloud/ccferry-cloud|; s|^WorkingDirectory=.*|WorkingDirectory=/opt/ccferry-cloud|' \
  /etc/systemd/system/ccferry-cloud.service
systemctl daemon-reload && systemctl restart ccferry-cloud
```

- The unit keeps its inline Environment values (tokens, `CLOUD_PWA_DIR`, VAPID keys, subscription paths — all absolute), so the PWA dist and push-subscription files stay where they were; only the runtime swaps
- **Verify after the swap**: `systemctl is-active ccferry-cloud`; through Caddy — PWA shell `200`, `/api/...` without token `401`, with token `200`; the PC daemon log shows a fresh `tunnel authenticated` (the restart severs the tunnel; the daemon reconnects on its own)
- **Rollback**: `cp .../ccferry-cloud.service.bak-node .../ccferry-cloud.service && systemctl daemon-reload && systemctl restart ccferry-cloud`
- Server requirements observed: Linux x86_64, glibc ≥ 2.39 works; Caddy fronts 127.0.0.1:8788

## 7. Ops notes

- **Rebuild**: the exe is file-locked while running — stop first (Windows `schtasks /end`, Linux `systemctl --user stop`, macOS `launchctl unload`; cloud `systemctl restart` after scp), then `build-single.sh`, then start
- **Logs**: the Windows manual path appends to `daemon.log` with no rotation — check its size occasionally; Linux systemd goes through journald
- **Token rotation**: edit `daemon.env` (+ the phone app settings), restart the daemon
- **Cloud-side history**: `docs/notes/m3-findings.md` (original node deployment) and the 2026-09-30 update (single-package swap)
