# Flutter 知识库查询（只读）设计

- 日期：2026-09-30
- 状态：设计已口头批准（2026-09-30 会话），spec 待 owner 评审
- 前序：M5 spec `2026-09-29-m5-flutter-app-design.md`（二批第一项「vault 管理 #7」）；M2 spec `2026-09-26-m2-lan-pwa-vault-design.md`（vault 服务与 PWA 实现）；总 spec `2026-09-25-claude-code-remote.md`
- 本设计对话：2026-09-30 会话

## 1. 背景与目标

M5 v1 刻意薄启动，vault 管理列为「二批，另立」。PWA 已有完整知识库页（M2），但 owner 日常入口已是 Flutter App——App 里没有任何知识库能力。

本期交付**只读查询**：目录树浏览 + 全文搜索 + 笔记阅读。

**北极星验收 = 手机 App 内三步直达任意笔记**：会话页点知识库图标 → 浏览/搜索定位 → 阅读 md 全文。

编辑/新建/agent 整理入口**不在本期**，接口与状态机不预设（后续叠加均为超集，不冲突）。

## 2. 决策记录（2026-09-30）

| # | 决策 | 依据 |
|---|---|---|
| D1 | 范围 = 只读查询（浏览/搜索/阅读） | 「查询」= 查；后端零改动；范围最小（AskUserQuestion 超时后按推荐项推进，owner「继续」确认） |
| D2 | 入口 = 会话页 AppBar 图标（`menu_book`，连接徽标与设置之间），非底部 Tab | 会话仍是主页（薄启动原则）；改动最小；不认可可改 Tab |
| D3 | 零后端改动，消费 M2 已有 `/api/vault/tree\|file\|search` | M5 原则：Flutter 只消费现有 API 面 |
| D4 | 树**每次进入 /vault 刷新** + 下拉刷新；App 启动不请求 | 查询新鲜度优先；loading 期间显示旧树不闪白 |
| D5 | 搜索防抖 300ms、空输入不发请求、**不定位行** | 与 PWA 行为对齐；行锚定留后续 |
| D6 | 目录在列表中前置（客户端排序；服务端为纯名称序） | 文件浏览 UX 常规；一行 comparator 的成本 |
| D7 | 笔记渲染复用 `MarkdownBody`（markdown_widget，HTML 转义） | 与助手气泡同渲染器，无新依赖 |

## 3. API 契约（M2 既有，已从源码核实）

| 端点 | 响应 | 错误 |
|---|---|---|
| `GET /api/vault/tree` | `{ root, tree: VaultNode[] }`（`root` 忽略） | 503 `vault_not_configured` |
| `GET /api/vault/file?path=<rel>` | `{ path, content }` | 400 `path_escape`/`path required`；404 |
| `GET /api/vault/search?q=<terms>` | `{ matches: VaultSearchMatch[] }` | 400 `q required`；503 |

wire 形状（`@ccferry/protocol`，`packages/client/src/vault/tree.ts` / `search.ts` 实测）：

```ts
VaultNode {
  name: string
  path: string        // vault 相对路径，'/' 分隔，永不含 '..'
  kind: 'file' | 'dir'
  sizeBytes?: number  // file only
  children?: VaultNode[]  // dir only——解析仍按可缺省处理
}
VaultSearchMatch { path: string; line: number; text: string }  // text 已截 200 字符
```

搜索语义（Dart 侧只透传 q，不解析语义）：多词条空格分隔、大小写不敏感、**笔记级 AND**（每词都须出现在该笔记中，结果行是含任一词的行）；仅 `.md`；上限 20 条/笔记、200 条全局。树忽略 `.git/.obsidian/node_modules/.trash`。

鉴权：REST 走 `Authorization: Bearer`（ApiClient 既有）；隧道同源，无额外配置。

**实现要点**：`path`/`q` 含中文与空格，必须经 `Uri` queryParameters 编码——现有 `ApiClient._uri(path)` 直拼字符串不够，需在 ApiClient 增加带 query 的 GET 入口（如 `getJsonQuery(path, query)`，`_uri(path).replace(queryParameters: query)`）。

## 4. 客户端设计

### 文件职责（4 新 + 2 改）

| 文件 | 职责 |
|---|---|
| `lib/vault/vault_types.dart`（新） | `VaultNode`/`VaultSearchMatch` fromJson（children/sizeBytes null 安全，kind 白名单外视为坏行丢弃） |
| `lib/vault/vault_model.dart`（新） | ChangeNotifier：树获取 + 搜索 + 读笔记，全部经注入的 ApiClient |
| `lib/pages/vault_page.dart`（新） | 浏览 + 搜索单页 |
| `lib/pages/note_page.dart`（新） | 笔记阅读页 |
| `lib/main.dart`（改） | VaultModel app-lifetime（`_ensureModels` 创建）；`/vault`、`/note` 路由 |
| `lib/pages/sessions_page.dart`（改） | AppBar 加知识库图标 → `pushNamed('/vault')` |

### VaultModel 状态机

```
phase: idle → loading → ready | notConfigured(503) | failed(网络/5xx/超时)
```

- `refresh()`：拉树；已 ready 时**不回 loading**（旧树原地刷新，列表不闪）
- `search(q)`：防抖 300ms；空 q 直接清结果不发请求；`searching` 标志驱动 UI；ApiError → 搜索态置 failed，旧结果保留
- `readNote(path)`：返回 content；ApiError 上抛，由页面态承接
- 不做树/笔记缓存层（进入即刷 + 笔记小，缓存是过度设计）

### VaultPage 交互

- AppBar：title 显示当前目录名（根 = 「知识库」），无动作按钮
- 内部路径栈 `List<String> _stack`（段列表）；下钻 push 段，AppBar back / 系统返回手势（PopScope）退一层，栈空才退出路由
- 列表包 `RefreshIndicator`（下拉 = `refresh()`，唯一手动刷新入口）
- 内部路径栈 `List<String> _stack`（段列表）；下钻 push 段，AppBar back / 系统返回手势（PopScope）退一层，栈空才退出路由
- 列表 = 当前层 children，客户端排序目录在前、其余按 name；`ListView.builder`（单层数百项不虚发）；行 = 图标 + name；外层 `RefreshIndicator` 下拉重拉
- 搜索框在列表上方；有查询结果时**替换**目录列表；结果行 = path（副标题）+ 匹配行 text；点击 → `/note`
- `notConfigured` → 全页空态「知识库未配置」（无重试，重试无意义）；`failed` → 错误态 + 重试按钮；404/400 类（理论上不应发生，路径来自树）→ SnackBar 不跳页

### NotePage

- 进入即 `readNote(path)`；loading 圈 → `MarkdownBody` 全文；失败 → 错误态 + 重试
- AppBar title = 笔记文件名；无编辑入口

### 路由与 provider（M5 已踩过的坑，直接按结论做）

`/vault`、`/note` 推在 root navigator 上，位于 `home:` 的 provider scope 之外——路由 builder 内 `MultiProvider` 以 `.value` 直供 `ApiClient` + `VaultModel`（同 `/settings` 与 UpdateDialog 的修法）。SessionsPage 的 harness 必须含一条 production-shape 测试（providers 置于 `home:` 内仍可达）钉住。

## 5. 风险台账

| 风险 | 处置 |
|---|---|
| Markdown 外链图片：渲染时手机直连图床（暴露 IP/UA） | 自用可接受；PWA 同等暴露。不动 markdown_widget 配置 |
| 超长笔记全文渲染卡顿（MarkdownBlock 无虚拟化） | 库内笔记多为小文件，接受；真卡再虚拟化 |
| 每次进入全树刷新的流量（317 文件 ≈ 数十 KB JSON） | 手机可接受；进入刷新换取新鲜度（D4） |
| 搜索结果点击不定位行 | 明确不做（D5），后续需要再加 |
| 服务端 503 语义被误判为网络错误 | 状态机单列 `notConfigured`，测死 |

## 6. 测试口径（TDD，flutter_test）

- **VaultModel**：树解析（null children / 坏 kind）、503 → notConfigured、ApiError → failed、防抖只发末次、空 q 不发请求、refresh 已 ready 不回 loading
- **VaultPage**：当前层渲染且目录前置、下钻/返回（PopScope 逐层）、搜索结果替换列表、未配置态、下拉刷新重拉
- **NotePage**：markdown 渲染、失败态重试
- **SessionsPage**：入口图标存在且点击 push `/vault`
- **路由 production-shape**：providers 置于 `home:` 内时 `/vault` 页仍能解析 VaultModel

## 相关

- M5 spec（二批清单）：`docs/superpowers/specs/2026-09-29-m5-flutter-app-design.md`
- M2 spec（vault 服务来源）：`docs/superpowers/specs/2026-09-26-m2-lan-pwa-vault-design.md`
- 证据：`docs/notes/m5-findings.md`（惯例延续）
