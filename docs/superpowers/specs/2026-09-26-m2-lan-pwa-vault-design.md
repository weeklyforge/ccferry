# ccferry M2 设计 Spec（局域网 PWA + 远程批权限 + 知识库管理）

> 定稿 2026-09-26，基于 M1 交付（main @ `915d8b8`）。总 spec：`2026-09-25-claude-code-remote.md`；M1 证据：`docs/notes/m1-findings.md`。与总 spec 冲突处以本文件为准，修订见文末「修订记录」。

## 背景与目标

**M2 验收**：手机 PWA 在局域网完成全流程——① 看会话总览/实时流；② 续聊空闲会话；③ 远程批准/拒绝工具权限（含 60s 超时即拒、无人值守白名单档）；④ 管理知识库（目录树/全文搜索/读/编辑/新建 + agent 整理入口 + vault 会话创建）。证据照 M1 惯例落 `docs/notes/m2-findings.md`。

推送（Web Push）不在 M2——M3 云端；JSONL 全文搜索（历史页）归 M4；M2 的「翻阅」= 会话流 `fromStart=true`。

## M2 拍板决策（2026-09-26 brainstorming 定稿）

| # | 决策 | 依据 |
|---|---|---|
| D1 | 认证 = 静态 token：`CCFERRY_TOKEN` env，PWA 首次输入存 localStorage | 同网段任意设备可触达，必须至少一道门；M3 换云端 JWT 不冲突 |
| D2 | vault 搜索 = **纯 JS 扫描**（修订总 spec 的 ripgrep 字面） | 实测 vault 317 md / 481KB，纯 JS 几十毫秒级；rg 路线有 AV 前科 + Bun 内嵌未验证，升级路径见「风险」 |
| D3 | PWA 栈 = Vite + Vue 3 + Vant 4 + vue-router + Pinia + vite-plugin-pwa | 移动优先，Vant 移动端组件成熟，中文生态好 |
| D4 | 无人值守白名单默认档 = 只读工具放行（`Read/Glob/Grep/LS/TodoWrite`） | 无副作用的读取类默认放行，写/执行/网络类一律等批准；白名单可配置 |
| D5 | 审批通道 = SSE 下行 + POST 决断 | 与 M1 SSE 基建同构；「PWA 在线」= 审批订阅数 ≥ 1；弃轮询（延迟）与 WS（功能过剩） |
| D6 | PWA = `packages/pwa` 第三个 workspace 包，daemon 静态托管其 `dist/` | 边界干净；「client 单进程单制品」拍板不破 |

## 架构总览

```
手机 PWA (Vant) ──LAN Wi-Fi──▶ daemon (Fastify, 0.0.0.0:8787, token)
                                ├─ 静态托管 packages/pwa/dist（app shell）
                                ├─ /api/projects /api/sessions        (M1, +5s TTL 缓存)
                                ├─ /api/sessions/:id/stream|messages  (M1)
                                ├─ /api/messages                      (新: 开新会话, vault 会话创建)
                                ├─ /api/approvals/stream|:id/decision (新: 审批路由)
                                └─ /api/vault/tree|file|search        (新: 知识库服务)
                                └─ ApprovalBroker ── canUseTool ── SdkDriver(query)
```

## 1. 协议扩展（`@ccferry/protocol`）

```ts
// ParsedLine 失败分支补原文透传（总 spec R1：解析失败降级为原始行）
export type ParsedLine =
  | { ok: true; line: number; json: Record<string, unknown> }
  | { ok: false; line: number; raw: string };

// DriverEvent 增加错误通道（M1 终审遗留：SSE 注释只覆盖传输层，语义层错误需正式事件）
export type DriverEvent =
  | { type: 'assistant'; text: string }
  | { type: 'system'; subtype: string }
  | { type: 'result'; subtype: string; text: string; sessionId: string }
  | { type: 'error'; message: string };

export interface ToolApprovalRequest {
  approvalId: string;
  sessionId: string | null;
  toolName: string;
  input: Record<string, unknown>;   // broker 广播前截断：单字符串值 1KB / 总量 16KB
  createdAtMs: number;
  timeoutMs: number;                // PWA 倒计时用
}
export type ApprovalDecision = 'allow' | 'deny';

export interface VaultNode {
  name: string;
  path: string;                     // vault 相对路径，'/' 分隔，永不含 '..'
  kind: 'file' | 'dir';
  sizeBytes?: number;               // file only
  children?: VaultNode[];           // dir only
}
export interface VaultSearchMatch {
  path: string;
  line: number;                     // 1-based
  text: string;                     // 匹配行原文，截 200 字符
}
```

裁定：`StreamMessage`（M1 定义未用）保留并标注 reserved；`streamSession` 行号维持流相对（M2 聊天气泡不显示行号，绝对行号等 M4 历史页有锚定需求再改）。

## 2. 审批路由（`src/approval/`）

**ApprovalBroker（内存态）**

- `pending: Map<approvalId, { request, resolve, timer }>`；daemon 重启丢 pending（进程亡则 SDK 查询亦亡，可接受，M2 不持久化）
- `requestApproval({ sessionId, toolName, input }): Promise<PermissionResult>`——生成 id、广播、起 `approvalTimeoutMs`（默认 60s）定时器，超时自动 **deny**（fail-closed）
- `subscribe/unsubscribe(writer)`——SSE 订阅注册表；**「PWA 在线」= 订阅数 ≥ 1**
- `decide(approvalId, decision)`——首个决断生效并取消定时器；未知 id → 404；已决断 → 409 `already_decided`
- **重连友好**：SSE 连接建立时先补发当前 pending 快照（手机锁屏/断线重连在窗口内不丢审批）；每 15s keepalive 注释保活

**SdkDriver 接入（替换 M1 denyAllTools）**

```
canUseTool(toolName, input):
  toolName ∈ whitelist → allow
  否则 → broker.requestApproval(...)
         allow     → { behavior: 'allow' }
         deny/超时  → { behavior: 'deny', message: 'denied remotely' | 'approval timeout' }
```

- 构造签名 `new SdkDriver(claudeDir, { broker, whitelist })`，`main.ts` 组装；`SessionDriver` 接口不动，API 层零改动
- vault 会话（agent 整理）走同一 `sendMessage` → 同一套审批，无新机制

**API**：`GET /api/approvals/stream`（SSE：快照 + 实时 + keepalive）；`GET /api/approvals`（JSON 列表，总览页徽标用）；`POST /api/approvals/:id/decision` body `{ decision }` → 200 / 404 / 409。

**测试钉**：broker 单测（超时拒/决断解除/订阅快照/二次 409）；路由 inject 测试；`evaluateToolPolicy(toolName, whitelist)` 纯函数测试。

## 3. vault 知识库服务（`src/vault/`）

**沙箱（spec 硬约束，所有文件操作唯一入口）**：`resolveInside(root, relPath): string | null`——拒绝 `..` 段、绝对路径、盘符；反斜杠归一 `/` 后判定；`path.relative` 复验不出根；null → 400 `path_escape`。

**目录树**：递归扫描，跳过 `.git` / `.obsidian` / `node_modules`；一次性全树。

**读写**：读 utf8 全文；改仅限已存在文件（404）；新建已存在则 409。**M2 不做改名/移动**（vault 规则要求全库更新 wikilink，交给 agent 整理或 M4）。版本链不自建（obsidian-git 每分钟自动提交兜底）；与 Obsidian 并发编辑 = 后写赢，接受。

**搜索（纯 JS，接口隔离）**：`SearchEngine` 接口 + `createJsSearchEngine()` 工厂（将来换 rg 改工厂一行）。大小写不敏感**字面子串**；限 `.md`；单文件 20 条 / 全局 200 条 / 行文本 200 字符。

**API**：

| 路由 | 行为 |
|---|---|
| `GET /api/vault/tree` | 全树 `VaultNode[]` |
| `GET /api/vault/file?path=` | `{ path, content }` / 400 越界 / 404 |
| `PUT /api/vault/file` | 编辑 `{ path, content }` / 404 不存在 |
| `POST /api/vault/file` | 新建 / 409 已存在 |
| `GET /api/vault/search?q=` | `{ matches: VaultSearchMatch[] }` |

vaultPath 未配置 → 全族 503 `vault_not_configured`（不硬编码机器特定路径进源码）。

**agent 整理 + vault 会话创建 = 零新机制**：新路由 `POST /api/messages` body `{ projectPath, text }`（`sessionId: null` 的 `SendMessageInput` 既有语义）；PWA「agent 指令入口」对 vaultPath 调它，会话照常进总览/实时流/审批路由。

**测试钉**：沙箱越界矩阵（`../`、`..\`、绝对路径、盘符）、忽略目录、搜索截断/上限、临时目录作 vault 根的全路由回环。

## 4. PWA（`packages/pwa`）

**组装**：开发期 Vite devServer `5173` 代理 `/api` → daemon；产物由 daemon `@fastify/static` 托管（`CCFERRY_PWA_DIR` 可覆盖，缺目录仅告警）。**token 传递**：fetch 走 `Authorization: Bearer`；`EventSource` 不支持自定义 header → SSE 用 `?token=` 查询参数（M2 LAN 可接受，M3 换正规认证）。

**页面（底部 Tabbar 3 项 + 1 push 详情页）**：

1. **总览**：项目分组 Collapse × 会话 Cell（firstUserText 摘要 + 相对时间 + 状态徽标：进行中/等你批准/空闲）；10s 轮询 + 下拉刷新；「新建 vault 会话」入口。状态判定 = 活动窗口 + `GET /api/approvals`。
2. **会话流（push）**：`fromStart=true` SSE → 聊天气泡（user/assistant 文本，tool_use 渲染工具卡片摘要）；底部续聊输入（POST messages，同一 SSE 响应消费）；**批准卡**：approvals SSE 按 sessionId 过滤 → ActionSheet 允许/拒绝 + 60s 倒计时环；EventSource 原生断线重连。
3. **知识库**：文件夹逐级下钻列表 + 防抖 300ms 搜索；笔记查看/纯文本 md 编辑（textarea + PUT）；新建；「agent 整理」指令入口 → `POST /api/messages { projectPath: vault }` → 跳转会话流页。
4. **设置**：token 输入/清除；daemon 地址（默认同源）；vault 配置状态只读展示。

**Service Worker** 只缓存 app shell 静态资源，**API 与 SSE 永不缓存**。UI 文案中文；代码注释英文。

**测试口径**：vitest + @vue/test-utils 钉纯逻辑（倒计时、防抖搜索、token fetch 包装、approvals store 状态机）；页面级局域网真机手动验收。

## 5. 配置与安全

**`~/.ccferry/config.json`**（启动读取，全部可缺省）：

```json
{
  "vaultPath": "D:/Development/MyWorkspace/github/fetaoily/my-obsidian-docs/my-obsidian-docs",
  "toolWhitelist": ["Read", "Glob", "Grep", "LS", "TodoWrite"],
  "approvalTimeoutMs": 60000
}
```

token 与端口不进 config：`CCFERRY_TOKEN` / `CCFERRY_PORT`（M1 既有）维持 env，新增 `CCFERRY_HOST`。

**分层安全模型**：

1. **无 token → 强制 localhost**（安全默认）：`CCFERRY_TOKEN` 未设时忽略 `CCFERRY_HOST`、只绑 `127.0.0.1`、Host 白名单维持 M1 环回档
2. **token 已设 → 允许 LAN**（`CCFERRY_HOST=0.0.0.0`），Host 校验放宽（rebinding 攻击者拿不到 token，双重校验无增益反伤手机直连 IP 场景）
3. `/api/*` 全部过 auth 中间件（Bearer 或 `?token=`）；PWA 静态壳不设防（数据全在 API 后面）
4. **不开 CORS**（同源托管 + Vite 代理同源）
5. vault 沙箱为 token 之外第二道门；红线（120s 活动窗口 + `force`）原样保留
6. 审批 fail-closed（超时即拒）；审批决断与 vault 写操作进 fastify logger 留痕

**性能**：`scanStore` 结果加 5s TTL 内存缓存（吃手机 10s 轮询抖动）；fs-watch 重构留 M3。

## 修订记录（对总 spec `2026-09-25`）

1. 知识库全文搜索底层：ripgrep → **纯 JS 扫描**（D2；依据：实测语料 317 md/481KB，rg 伴生/内嵌的 AV 与 Bun 风险不值当）
2. 历史「翻+搜」分期明确：翻 = M2 会话流 `fromStart`；搜（JSONL 全文）= M4
3. 「远程开新任务」中 vault 会话创建提前至 M2（`POST /api/messages`），与总 spec 09-26 升级一致

## 风险与待验证

- **Bun 单包（M3）**：偏好已记录 = 内嵌+运行时解压优先、伴生文件兜底；需 spike 实测（含 SDK 子进程）。M2 守纯 JS 依赖纪律，不引入二进制依赖
- **EventSource token 走 query 参数**：会进代理/服务器日志——M2 LAN 私网可接受，M3 云端换 header/WebSocket 认证
- **与 Obsidian 并发编辑后写赢**：obsidian-git 自动提交兜底，接受
- **TOCTOU 活动窗口**：M1 遗留已知项，M2 的 canUseTool 审批是操作面更强的闸，维持总 spec 判断
- **daemon 重启丢 pending 审批**：M2 接受，M3 隧道重连设计时一并考虑

## 相关

- 总 spec：`2026-09-25-claude-code-remote.md` · M1 计划：`docs/superpowers/plans/2026-09-26-m1-local-daemon.md` · M1 证据：`docs/notes/m1-findings.md`
- vault 任务页：`工作任务/待办/2026-09-25-ClaudeCode远程交互系统.md`（obsidian-git 自动留痕）
