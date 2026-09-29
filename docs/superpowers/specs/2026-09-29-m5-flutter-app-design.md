# M5 原生 App（Flutter）设计

- 日期：2026-09-29
- 状态：定稿，待 owner 评审
- 前序：总 spec `2026-09-25-claude-code-remote.md`（R3 二期根治路线）；M1~M4 已交付
- 本设计对话：2026-09-29 会话

## 1. 背景与目标

iOS PWA 有系统级硬伤（总 spec R3）：推送必须先"添加到主屏幕"，且待机场景丢推送。M4 验收唯一遗留项就是 4G 待机推送验证。

目标：用原生 App 把推送换成系统级通道，**北极星验收 = iPhone 4G 熄屏 → PC 端 TUI 完成/审批 → 通知到达 → 点击直达会话页**。

## 2. 决策记录（含被否选项）

| 决策 | 选择 | 被否选项与原因 |
|---|---|---|
| 总路线 | **B：原生重写**（owner 确认有意为之） | A Capacitor 壳（成本 1/10 但 WebView 怪问题类仍在）；C 继续 PWA 调优（iOS 限制调无可调） |
| 技术栈 | **Flutter**（渲染/手感最好） | uni-app（App 端 WebView 渲染，怪问题回来一半）；React Native（需学 React，protocol 复用优势不足以抵消） |
| v1 范围 | **薄启动**：会话+续聊+审批+推送 | 全功能平移（周期长，推送验收被拖后） |
| iOS 构建 | **GitHub Actions macOS runner → TestFlight**（无 Mac） | 云 Mac 租赁（杀鸡用牛刀）；本机构建（Windows 无 Xcode） |

成本接受度：客户端 8 项能力全部重做（v1 只做 5 项）；后端零改动是本设计的兜底——daemon、cloud、protocol、隧道 API 全复用，PWA 保留为网页版入口。

## 3. 范围

### v1（本期）

| # | 能力 | 对应总 spec 需求 |
|---|---|---|
| 1 | 登录（隧道 URL + token） | 基础 |
| 2 | 会话列表（跑/等你/完了 状态） | #1 |
| 3 | 会话流实时监控（tail 窗口 + 加载全部） | #2 |
| 4 | 远程续聊（含 409 红线 force 语义） | #3 |
| 5 | 审批卡片（推送 + 批准/拒绝） | #4 ⭐ |
| 6 | FCM 推送 + 点通知进会话页 | #5 ⭐ |

### 二批（本 spec 不设计，另立）

vault 管理（#7）、历史搜索（#6 厚）、远程开新任务（#8）、设置完善（推送测试按钮等）。

## 4. 架构

```
iPhone/安卓 [Flutter app]
   │  HTTPS + Bearer token          ←—— 服务器侧零破坏
   ▼
Caddy(39.105.92.24) → WSS 隧道 → PC daemon（零改动）
   ▲
FCM 推送 ←—— cloud 新增 native-sender（FCM HTTP v1）
```

原则：

- Flutter 是第三个客户端（TUI、PWA 之后），只消费现有 API 面
- PWA 不迁移不删除；两批能力补齐前它仍是全功能入口
- JSONL 解析容错沿用总 spec R1 原则：解析失败降级 raw 行透传

## 5. API 契约（v1 消费面，已从 PWA 代码核实）

| 端点 | 方法/形态 | 用途 |
|---|---|---|
| `/api/sessions` | GET | 会话列表 |
| `/api/approvals` | GET | 待审批列表 |
| `/api/sessions/:id/stream?fromStart=true&tailBytes=N` | SSE (GET) | 会话流（tail 窗口语义同 PWA 的 256KB） |
| `/api/sessions/:id/messages` | POST（SSE-over-POST 响应） | 续聊；`{text, force}`；409 `session_active` → force 确认 |
| `/api/approvals/stream` | SSE (GET) | 审批事件流（含 settled 帧） |
| `/api/approvals/:approvalId/decision` | POST | 批准/拒绝 |
| `/api/events/stream?clientId=` | SSE (GET) | 全局事件（列表页刷新信号） |
| `/api/push/native/subscribe` | POST（**新增**） | body `{platform, fcmToken}`，云端 upsert 订阅 |

鉴权语义（与 PWA 逐字节一致）：

- REST：`Authorization: Bearer <token>`
- SSE GET：`?token=<query>`——客户端镜像 PWA 行为（EventSource 历史语义），不自行改用 Bearer（服务端是否接受属计划期核实项，不作为依赖）
- SSE-over-POST：Bearer + JSON body，响应按 `\n\n` 分帧、`data: ` 前缀取载荷（参考 `packages/pwa/src/lib/api.ts` 的 `readSsePost`）

协议镜像：Dart 侧重声明 v1 用到的消息子集（`ParsedLine`、审批 request/settled 帧、messages 响应事件），不引入 TS 工具链。

## 6. 客户端设计（Flutter）

| 层 | 设计 | 移植来源 |
|---|---|---|
| 协议 | Dart 类型 + 容错解析（失败降级 raw） | `@ccferry/protocol` 子集 |
| 网络 | HTTPS 流式 SSE 消费 + 指数退避重连 | `sse-follow.ts` 语义 |
| 渲染 | bubbles：多 block → 多气泡；`tool_result` 按 `tool_use_id` 配对；未配对显示 ⏳ | `bubbles.ts`（含测试用例镜像） |
| 去重 | 重连重放按行身份跳过（uuid，缺失降级 hash） | `line-dedupe.ts` |
| markdown | 会话 assistant 气泡渲染；库选型计划期验证（见 R1） | `markdown.ts` 语义（sanitize 由 Dart 库保证，不注 HTML） |
| 状态 | 会话列表/详情/审批三个 Provider，不引重框架 | — |
| 存储 | 隧道 URL + token + FCM token → flutter_secure_storage | `stores/auth` |

红线继承：活会话并发写保护完全在 daemon 侧，客户端只透传 409 + force 确认对话框，无绕过路径。

## 7. 推送链路

**单通道**：`firebase_messaging`（FlutterFire），iOS 经 Firebase 代理到 APNs，安卓走 FCM——iOS 无需自对接 APNs HTTP/2。

- 注册：app 启动 → 请求通知权限 → `getToken` → `POST /api/push/native/subscribe`（upsert；token 轮换在下次启动自然纠正）
- 云端新增 `push/native-sender.ts`：`firebase-admin` SDK（官方维护）发 FCM HTTP v1；FCM 订阅独立存 `fcm-subscriptions.json`（同款原子写模式）——web 侧 store/文件/代码路径字节不动
- 判定/抑制复用现有 PushSource 规则（TUI 完成、审批请求；前台/已读不重复推）
- 通知载荷：`{sessionId, kind}` + 标题/正文；点击 → 冷/热启动两条路径都路由到 `/session/:id`
- 清理：FCM 返回 UNREGISTERED/INVALID → 删订阅（同 web-push 现有逻辑）
- 发送失败不碰隧道主链路（fire-and-forget + 日志）

密钥纪律（与 VAPID 同款）：service account JSON 上主机 `/root/.ccferry/`，systemd env 注入，永不 echo、永不入库；`GoogleService-Info.plist` / `google-services.json` 视为准敏感——不入库，本机手动放置 + CI 从 secrets 注入。

## 8. 构建与分发

| 平台 | 管线 | 节奏 |
|---|---|---|
| 安卓 | Windows 本机 `flutter build apk` → 直接安装 | 随时 |
| iOS | GitHub Actions（macos runner）：`flutter build ipa` → TestFlight；签名 = App Store Connect API key + 证书/描述文件，全部走 repo secrets | **TestFlight 构建 90 天过期** → 至少每 90 天一次；手动触发（见 R3 配额） |

私有仓 macOS 10x 倍率：2000 免费 Linux 分钟 ≈ 200 macOS 分钟，一次构建 15-25 分钟 → 每月约 8-13 次，够用；2025-12 起另有 $0.002/分钟平台费（可忽略）。

## 9. 风险与待验证

- **R1** `flutter_markdown` 官方已停止维护 → 计划期验证社区 fork（`markdown_widget` 等）；降级路径：富文本简化渲染
- **R2** iOS CI 签名三件套（API key/证书/描述文件）是经典坑 → 计划放 spike 任务：先打通"空 app 上 TestFlight"再接真功能
- **R3** Actions 配额耗尽 → 只在发版时手动触发 workflow
- **R4** JSONL 无正式契约（总 spec R1）→ Dart 解析层隔离 + 容错降级 raw，单测钉住

## 10. 测试与验收

- Flutter 单测：bubbles 解析/配对/去重/时间格式（镜像 `bubbles.test.ts`、`line-dedupe.test.ts` 用例）、协议容错、SSE 分帧解析
- cloud 单测：native/subscribe 路由鉴权与 upsert、native-sender（mock 传输）、订阅 store 类型分发
- 手机验收（owner）：
  - [ ] 北极星：iPhone 4G 熄屏 → 完成/审批通知到达 → 点击直达会话页
  - [ ] 安卓同等场景
  - [ ] 续聊、审批、流渲染与 PWA 行为一致（含 409 force 确认）
  - [ ] TestFlight 安装流程走通一次（含 90 天重建演练）

## 11. Owner 一次性前置行动

1. 注册 Apple Developer Program（$99/年）——iOS 构建与推送的硬前提
2. 建 Firebase 项目（免费）：添加 iOS/安卓应用、生成并上传 APNs .p8、下载三件配置（见 §7 密钥纪律）
3. GitHub 仓库启用 Actions + 配置 secrets（ACS API key、分发证书、描述文件、Firebase 配置）
4. Windows 本机安装 Flutter SDK（安卓构建用）
5. （服务器）service account JSON 放置 + systemd env 更新——随部署任务做

## 12. 约束（继承仓库硬规则）

- 生成代码与注释英文，UI 文案可中文
- 任何 token/密钥不入库；commit 遵循 conventional + 无序列表正文，无 Co-Authored-By；不经明确要求不 push
- 隧道协议 v0 不动；daemon 红线逻辑不动

## 相关

- 总 spec：`2026-09-25-claude-code-remote.md`；M4 findings（推送现状）：`docs/notes/m4-findings.md`
- PWA 参考实现：`packages/pwa/src/lib/{api,sse-follow,bubbles,line-dedupe,markdown}.ts`
