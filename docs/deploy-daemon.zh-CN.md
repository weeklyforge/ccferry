# ccferry daemon 与云端部署指南

[English](deploy-daemon.md) | [中文](deploy-daemon.zh-CN.md)

单包形态（spec D5' 拍板：一进程、一制品、一条命令）部署与各操作系统自启配置。

> 各平台成品安装包发布在 [GitHub Releases](https://github.com/weeklyforge/ccferry/releases)：`v<x.y.z>-pc.N` tag = deb / rpm / pacman / mac pkg / windows setup.exe / zip 全矩阵；纯 `v<x.y.z>` tag = Android 通道（APK + 自更新元数据，持有 `latest` 别名）。

- 生产形态 = `dist-single/` 目录：`ccferry-client(.exe)`（Bun 编译，全部 JS 内嵌）+ 伴生 `claude(.exe)`（agent SDK 原生 CLI，~245MB，`bun --compile` 无法内嵌，驱动会在运行时于自身 exe 旁寻找并显式传给 SDK）
- dev 形态（`pnpm --filter @ccferry/client start`，node+tsx）仅用于开发调试，本文不覆盖
- 实测标注：**PC daemon（Windows）= 2026-09-30 实测通过；云端（Linux x64）= 2026-09-30 实测通过**；Linux / macOS 的**客户端**自启配置**未实测**，首次使用请验证并回填本文

## 1. 前置依赖

| 工具 | 用途 |
|---|---|
| node ≥ 22 | 构建期解析平台伴生二进制；运行期不需要 |
| pnpm | workspace 安装 |
| bun ≥ 1.4 | `bun build --compile` |

```bash
git clone <repo> && cd ccferry
pnpm install
```

## 2. 构建单包

```bash
bash scripts/build-single.sh client
# 产出：
#   dist-single/ccferry-client.exe   (~91MB)
#   dist-single/claude.exe           (~245MB，从 SDK 平台包复制)
# Linux/macOS 下为 ccferry-client / claude（无 .exe 后缀）
```

脚本自动探测宿主平台；可选第二参数交叉编译，如 `bash scripts/build-single.sh cloud bun-linux-x64` 在 Windows 上产出 Linux 云端二进制（见 §6）。

## 3. 配置

### 3.1 `~/.ccferry/config.json`（业务配置，可缺省）

```json
{
  "vaultPath": "D:/Development/.../my-obsidian-docs",
  "toolWhitelist": ["Read", "Glob", "Grep", "LS", "TodoWrite"],
  "approvalTimeoutMs": 60000
}
```

字段语义见 `README.zh-CN.md`。未配 `vaultPath` 时 `/api/vault/*` 返回 503。

### 3.2 `~/.ccferry/daemon.env`（凭据，必须收紧权限）

```ini
CCFERRY_TOKEN=<API token，手机/PWA 登录用>
CCFERRY_TUNNEL_URL=wss://<云端域名>/tunnel
CCFERRY_TUNNEL_TOKEN=<隧道 token，与云端 systemd unit 注入值一致>
```

- 不设隧道两项 = 纯本地模式（无 token 时强制只绑 127.0.0.1，安全默认）
- 可选：`CCFERRY_PORT`（默认 8787）、`CCFERRY_HOST`（配 token 后设 `0.0.0.0` 开 LAN）
- **权限**：Linux/macOS `chmod 600 ~/.ccferry/daemon.env`；Windows 见 §5.1 icacls

## 4. 手动运行验证

```bash
cd dist-single && ./ccferry-client(.exe)
# 另一终端：
curl -s http://127.0.0.1:8787/api/projects -H "Authorization: Bearer <token>" | head -c 200
# 出现真实项目列表即正常；带隧道 env 启动时日志应出现 "ccferry-tunnel: tunnel authenticated"
```

## 5. 自启配置（PC daemon）

### 5.1 Windows —— 计划任务（2026-09-30 实测）

三个文件 + 一条注册命令：

**`%USERPROFILE%\.ccferry\start-daemon.cmd`**（读 env → 起 exe → 追加日志）：

```bat
@echo off
for /f "usebackq tokens=1,* delims==" %%A in ("%USERPROFILE%\.ccferry\daemon.env") do set "%%A=%%B"
if not exist "%USERPROFILE%\.ccferry\logs" mkdir "%USERPROFILE%\.ccferry\logs"
cd /d "<repo>\dist-single"
ccferry-client.exe >> "%USERPROFILE%\.ccferry\logs\daemon.log" 2>&1
```

**`%USERPROFILE%\.ccferry\start-daemon-hidden.vbs`**（隐藏控制台；登录任务是 Interactive 模式，不藏会有窗口）。第三参数 `True`（等待模式）是关键：wscript 陪着 daemon 存活，daemon 非零退出 → 任务判失败 → RestartOnFailure 生效；写成 `False` 的话 wscript 秒退、任务早"成功"，daemon 死了没人重启（2026-09-30 实测踩坑）：

```vbs
CreateObject("WScript.Shell").Run """" & CreateObject("Scripting.FileSystemObject").BuildPath(CreateObject("WScript.Shell").ExpandEnvironmentStrings("%USERPROFILE%"), ".ccferry\start-daemon.cmd") & """", 0, True
```

**收紧 env 权限 + 注册 + 补丁**（默认 72h 执行时限会杀长驻进程，必须改 PT0S）：

```powershell
icacls "$env:USERPROFILE\.ccferry\daemon.env" /inheritance:r /grant:r "$env:USERNAME`:RW"

schtasks /create /f /tn "ccferry-daemon" `
  /tr 'wscript.exe "C:\Users\<user>\.ccferry\start-daemon-hidden.vbs"' /sc onlogon

# 关键补丁：无时限 + 崩溃自动重启（1 分钟间隔 × 3 次）
$svc = New-Object -ComObject Schedule.Service; $svc.Connect()
$folder = $svc.GetFolder('\')
$def = $folder.GetTask('ccferry-daemon').Definition
$def.Actions.Item(1).Path = 'wscript.exe'
$def.Actions.Item(1).Arguments = '"C:\Users\<user>\.ccferry\start-daemon-hidden.vbs"'
$def.Settings.ExecutionTimeLimit = 'PT0S'
$def.Settings.RestartInterval = 'PT1M'; $def.Settings.RestartCount = 3
$folder.RegisterTaskDefinition('ccferry-daemon', $def, 6, $null, $null, $null)
```

> 注：本机实测 `Register-ScheduledTask`（CIM 层）报 "Unspecified error / RPC failed"，`schtasks` + COM 补丁路径可用；若你的机器 CIM 正常，`Register-ScheduledTask -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1))` 一步到位。

管理：`schtasks /run|/end|/query /tn ccferry-daemon`。

### 5.2 Linux —— systemd 用户服务（未实测）

`~/.config/systemd/user/ccferry.service`：

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
loginctl enable-linger $USER   # 不登录也常驻（需管理员或 polkit 授权）
```

优点：stdout 进 journal（`journalctl --user -u ccferry -f`），日志轮转免费。

### 5.3 macOS —— launchd（未实测）

`~/Library/LaunchAgents/com.ccferry.daemon.plist`（launchd 不支持 EnvironmentFile，用包装脚本 source）：

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

`~/.ccferry/start-daemon.sh`：`set -a; . "$HOME/.ccferry/daemon.env"; set +a; cd "<repo>/dist-single" && exec ./ccferry-client`（`chmod +x`）。加载：`launchctl load ~/Library/LaunchAgents/com.ccferry.daemon.plist`。

## 6. 云端服务器部署（deb 路径 2026-10-01 实测）

首选：release 里的 deb（任意 `v<x.y.z>-pc.N` 版本都有）。包含 `/usr/bin/ccferry-cloud` 与读 `/etc/ccferry/cloud.env` 的 systemd unit；postinst 绝不覆盖已有的 env 文件，然后 daemon-reload + enable + 重启服务：

```bash
# 开发机：从 release 下载并上传
curl -fL -o ccferry-cloud_<ver>_amd64.deb \
  https://github.com/weeklyforge/ccferry/releases/download/v<ver>-pc.N/ccferry-cloud_<ver>_amd64.deb
scp ccferry-cloud_<ver>_amd64.deb root@<server>:/tmp/

# 服务器
dpkg -i /tmp/ccferry-cloud_<ver>_amd64.deb
```

首次部署（参考服务器已完成）：准备 `/etc/ccferry/cloud.env`，含 `CLOUD_TOKEN_PHONE`、`CCFERRY_TUNNEL_TOKEN`，可选 `CLOUD_PORT`、`CLOUD_PWA_DIR`、`VAPID_*`、`CCFERRY_PUSH_SUBS`——见包内 `cloud.env.template`。

- **验证**：`systemctl is-active ccferry-cloud`（FragmentPath 应为 `/usr/lib/systemd/system/ccferry-cloud.service`、状态 `enabled`）；过 Caddy —— PWA 壳 `200`、无 token `/api` `401`、带 token `200`；SSE 流最初几帧带 `{"kind":"tunnel","state":...}`（当前状态 + 实时事件）；PC daemon 日志出现新的 `tunnel authenticated`（重启会切断隧道，daemon 自动重连）
- **回滚**：`dpkg -i ccferry-cloud_<旧版>_amd64.deb`（或保留下方 deb 之前的手工布局）
- 服务器要求实测：Linux x86_64、glibc 2.39 可用；Caddy 反代 127.0.0.1:8788

### 手工回退路径（deb 之前的布局，2026-09-30 实测）

云端二进制无伴生文件（纯 fastify/websocket/static）。开发机交叉编译，替换 systemd unit：

```bash
# 开发机（如 Windows → Linux x64 服务器）
bash scripts/build-single.sh cloud bun-linux-x64   # → dist-single/ccferry-cloud（ELF）
scp dist-single/ccferry-cloud root@<server>:/opt/ccferry-cloud/ccferry-cloud

# 服务器
ssh root@<server>
chmod +x /opt/ccferry-cloud/ccferry-cloud
cp /etc/systemd/system/ccferry-cloud.service /etc/systemd/system/ccferry-cloud.service.bak-node
sed -i 's|^ExecStart=.*|ExecStart=/opt/ccferry-cloud/ccferry-cloud|; s|^WorkingDirectory=.*|WorkingDirectory=/opt/ccferry-cloud|' \
  /etc/systemd/system/ccferry-cloud.service
systemctl daemon-reload && systemctl restart ccferry-cloud
```

- unit 内联的 Environment（token、`CLOUD_PWA_DIR`、VAPID 密钥、订阅文件路径——均为绝对路径）原样保留，PWA dist 与推送订阅文件不动，只换运行时
- **回滚**：`cp .../ccferry-cloud.service.bak-node .../ccferry-cloud.service && systemctl daemon-reload && systemctl restart ccferry-cloud`

## 7. 运维备忘

- **重建**：exe 运行中文件被锁——先停（Windows `schtasks /end`，Linux `systemctl --user stop`，macOS `launchctl unload`；云端 scp 后 `systemctl restart`）→ `build-single.sh` → 再启
- **日志**：Windows 手动路径下 `daemon.log` 只追加不轮转，定期检查大小；Linux systemd 走 journal 自动轮转
- **换 token**：改 `daemon.env` + 手机 app 设置页同步更新，重启 daemon 生效
- **云端历史**：`docs/notes/m3-findings.md`（node 形态原始部署）与 2026-09-30 单包切换记录
