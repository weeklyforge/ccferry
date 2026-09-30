# Android 自动更新（GitHub Releases 分发）设计

- 日期：2026-09-30
- 状态：定稿，待 owner 评审
- 前序：M5 Flutter app 已交付并通过真机验收（2026-09-30）；APK 目前手动 scp 到云服务器 + adb 安装
- 本设计对话：2026-09-30 会话

## 1. 背景与目标

M5 发布链路全靠人肉：本机 `flutter build apk` → scp 分块上传到阿里云 → 手动 `adb install`。换一台手机、或不在电脑旁时无法拿到新版本。

目标：

1. 发版一条命令：构建 + 生成版本元数据 + 发布到 GitHub Releases
2. app 启动自动检查更新，发现新版弹窗提示，用户确认后 app 内下载并拉起系统安装器

**北极星验收 = 发一个新版本后，手机在不接电脑的情况下收到更新提示 → 确认下载 → 系统安装器完成升级，全程可用。**

## 2. 决策记录（含被否选项）

| 决策 | 选择 | 被否选项与原因 |
|---|---|---|
| 分发渠道 | **GitHub Releases**（owner 确认，接受国内直连风险） | 阿里云服务器 `/apk/`（国内更快，但 owner 要 git 托管）；双渠道镜像（两套发布逻辑，暂不需要） |
| 元数据获取 | **`releases/latest/download/` 固定别名**，零 API 调用 | GitHub API `releases/latest`（未认证 60 req/h 限流，还要解析 assets 列表）；提交 latest.json 到仓库分支（每个版本一个 commit，污染历史） |
| 版本比较 | **versionCode**（pubspec `+N`，整数单调递增） | versionName 字符串比较（semver 解析多余且易错） |
| 安装器集成 | **自写 MethodChannel ≈30 行 Kotlin** | 第三方插件 open_filex 等（功能就一个 Intent，不值得引依赖） |
| 仓库可见性 | **public**（`releases/latest/download/` 免 token 的前提） | private（下载需嵌 token 进 app，不可接受） |
| 签名 | **维持 debug 签名现状**，本设计不改 | 正式 keystore（换签名会导致已装机无法覆盖安装；单机打包现状下 debug key 稳定，记遗留项） |

## 3. 范围

### 本期

1. GitHub 仓库首建 + 全量 push（一次性动作，**执行前单独向 owner 确认**，push 前扫描历史无凭据类文件）
2. `apps/mobile/scripts/release.sh`：校验 → 构建 → 生成 latest.json → `gh release create` 上传
3. app 侧：启动静默检查 → 更新弹窗 → 下载（进度 + SHA256 校验）→ 拉起系统安装器

### 不做（本期不做，也不阻塞）

- 自动静默安装（必须用户确认）
- 增量/差分更新、强制更新
- iOS 侧（TestFlight 自带更新机制，等 Apple Developer 注册后另议）
- 更新检查设置开关（默认每次启动检查一次，频率可接受后再说）

## 4. 发布契约（GitHub Releases）

```
元数据:  https://github.com/fetaoily/ccferry/releases/latest/download/latest.json
安装包:  https://github.com/fetaoily/ccferry/releases/latest/download/ccferry.apk
历史版:  https://github.com/fetaoily/ccferry/releases/download/v<version>/ccferry.apk
```

- `releases/latest/download/<asset>` 是 GitHub 官方固定别名，永远重定向到最新 release 的同名资产（已核实 GitHub Docs "Linking to releases"）；历史版本各有 tag 固定链接，不会丢失
- 两个资产都是**手动上传的 release 资产**，无鉴权、无限流（不经过 api.github.com）

### latest.json schema

```json
{
  "version": "1.0.1",
  "versionCode": 2,
  "sha256": "<apk sha256, 64 hex lowercase>",
  "apk": "ccferry.apk",
  "notes": "- 修复xx\n- 新增yy"
}
```

- `versionCode` 是唯一比较依据；`version` 仅展示；`sha256` 下载后校验；`notes` 展示在更新弹窗
- app 对该文件**宽容解析**：缺字段 / 坏 JSON / 网络失败 = 视为"无更新"，静默跳过，绝不阻塞主流程

### release.sh 行为

```
apps/mobile/scripts/release.sh "<更新说明（一行或多行文本）>"
```

1. 从 `pubspec.yaml` 读 `version: X.Y.Z+N`
2. 拉远端 `latest.json`（存在时），校验 `N > 远端 versionCode`，否则报错退出（防忘 bump 版本号）
3. 校验 tag `vX.Y.Z` 不存在（`gh release view`），已存在则报错退出
4. `flutter build apk --release`
5. 计算 APK SHA256，生成 latest.json（notes 用脚本参数）
6. `gh release create vX.Y.Z --title "X.Y.Z" --notes "<说明>"` 并上传 `app-release.apk` + `latest.json`

- 鉴权全走已登录的 `gh` CLI，脚本内不出现任何 token
- 资产上传失败可直接重跑（`gh release delete` 后重来），脚本不做断点续传

## 5. 客户端设计（Flutter + Android）

### 文件与职责

| 文件 | 职责 |
|---|---|
| `lib/update/update_release.dart` | latest.json 模型 + 宽容解析（`UpdateRelease.tryParse`） |
| `lib/update/update_model.dart` | 状态机 ChangeNotifier：`idle → checking → available / upToDate / error(静默)`；`available` 后可 `download`（带 0~1 进度）→ `ready(path)` / `downloadFailed` |
| `lib/update/update_service.dart` | 组合：拉 latest.json（裸 `http.Client`，**不走 ApiClient**——更新链路在 github.com 上，与隧道无关、无鉴权）→ versionCode 比较 → 下载到缓存目录 → SHA256 校验（`crypto` 包） |
| `lib/update/update_installer.dart` | MethodChannel `ccferry/install`：`installApk(String path)` |
| `android/.../MainActivity.kt` | 注册 channel，构造安装 Intent |
| `apps/mobile/scripts/release.sh` | 发布脚本（§4） |

### 新增依赖

| 包 | 用途 |
|---|---|
| `package_info_plus` | 读本地 versionCode / version |
| `path_provider` | APK 下载缓存目录 |
| `crypto` | SHA256 校验（Dart 官方包） |

### 检查时机与 UI 流程

1. 会话总览首次装载后**静默检查一次**（fire-and-forget；任何失败静默，不打扰、不重试、无角标）
2. 远端 versionCode > 本地 → 弹 `AlertDialog`：`发现新版本 X.Y.Z（当前 A.B.C）` + notes（等宽小字）+【以后再说】【下载更新】
3. 确认后对话框转为进度态（`LinearProgressIndicator`，按 content-length 汇报 0~1）
4. 下载完成 → SHA256 校验：失败删文件、对话框报错、提供重试；成功 → 调 `installApk(path)` 拉起系统安装器
5. 【以后再说】关闭弹窗，本次启动内不再打扰

### Android 侧改动

- `AndroidManifest.xml`：加 `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>`；注册 `FileProvider`（`androidx.core.content.FileProvider`）
- 新增 `res/xml/file_paths.xml`：授权 app cache 目录（`cache-path`）
- MainActivity：未授权"安装未知应用"时（`canRequestPackageInstalls() == false`），发 `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` Intent 引导授权，用户返回后再装（Android 8+ 一次性授权，之后直接安装）
- 侧载场景无 Play 审核顾虑

## 6. 测试与验收

| 层 | 内容 |
|---|---|
| Dart 单测 | versionCode 比较（大于/等于/小于/远端缺失）；latest.json 宽容解析（合法/缺字段/坏 JSON）；UpdateModel 状态机（检查失败静默、下载进度回调、SHA256 失败路径、成功路径产出临时文件路径） |
| Widget 测试 | 有新版时弹窗出现；【以后再说】关闭且不再弹；【下载更新】触发下载状态 |
| 脚本 | 不做单测（bash）；本地验收：dry 路径（版本号未 bump 被拦、tag 已存在被拦）+ 真实发布一次 |
| 端到端 | 发 v1.0.1 测试版 → 手机断开电脑 → 弹窗 → 下载 → 安装器完成覆盖升级 → 打开 app 确认新版本号 |

## 7. 风险与遗留

| 项 | 处置 |
|---|---|
| 国内直连 github.com 下载慢/失败 | owner 已知情选择；若实测不可用，后续另立"阿里云镜像 fallback"设计（app 侧加备用源很小的改动） |
| debug 签名换机构即断 | 遗留：需要时建正式 keystore（密码只入 vault 账号管理/，keystore 文件不进 git），届时 app 需卸载重装一次 |
| 首次 push 公开源码 | push 前扫描历史确认无凭据/密钥文件（vault 凭据、token、FCM 密钥本就不入库，发布前复核一遍） |
| versionCode 忘 bump | 脚本第 2 步校验拦截 |
| GitHub release 资产不可变 | 发错版本需 `gh release delete` 重发；脚本不自动覆盖 |
