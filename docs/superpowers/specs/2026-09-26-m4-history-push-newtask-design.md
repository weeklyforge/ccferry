# M4 设计：历史页 + Web Push + 远程开新任务 + 打磨

日期：2026-09-26 · 状态：待 owner 确认 · 前序：M3 已合并（main `19587f9`）

## 目标

补齐需求地图最后三项并全绿：#5 完成/阻塞/出错推送（D2' 自 M3 后置至此）、#6 历史管理（厚：翻+搜）、#8 远程开新任务（非 vault 部分）；同时完成一期 UI 打磨与 M3 终审缓办 Minor 的快赢清理。

验收基线：**需求地图 1~8 全绿**（vault 任务页同步更新）。

## 决策记录

| # | 决策 | 理由 | 若错的代价 |
|---|---|---|---|
| D1 | 远程开新任务的项目路径**仅限已知项目**（scanner 集合内），daemon 侧校验，越界 403 | 手机键盘敲 Windows 绝对路径易错且低频；不新增任意路径暴露面 | 需要在新目录开任务时仍要回 PC；可后补白名单 |
| D2 | 推送触发三态：**等批准 + 完成 + 出错**；PWA 前台可见（SSE 活跃）时免打扰 | 批准等待是核心场景（⭐）；前台免打扰防重复打扰 | 推送过多扰民或漏报；均可后续调 |
| D3 | 完成/出错事件源 = **watcher 层解析 JSONL result 行**（非 daemon 驱动回调） | 对 TUI 与 daemon 驱动的会话一视同仁；单一事实源，天然不双发 | 若解析层误判需修 parse 容错 |
| D4 | 历史搜索 = 元数据过滤（项目/时间）收窄集合 → 内容**从新到旧扫描、字节封顶 20MB 即停**、返回 `truncated` 标记；标题匹配走已有 `firstUserText` 索引（全量零成本） | 会话文件总量数百 MB，无界扫描卡死；ripgrep 增加部署依赖，一期不引入 | 极旧的会话内容可能漏命中——UI 明示"结果可能不全" |
| D5 | 推送订阅存储 = 云侧 **JSON 文件落盘**（`/var/lib/ccferry/push-subscriptions.json`）；VAPID 密钥 = 一次生成、systemd env 注入 | 云重启订阅不丢；无数据库依赖 | 文件损坏需删档重订阅（可接受） |
| D6 | 前台免打扰机制 = PWA localStorage 生成 `clientId`，同时携带于推送订阅与 SSE 连接；**云侧**发现该 clientId 的 SSE 活跃则跳过推送 | 云天然知道自己 SSE 客户端状态，PC 不知道；单用户无需复杂多端逻辑 | 多设备同用时会误判前台——单用户前提成立 |
| D7 | 推送投递失败：**410 Gone 自动移除订阅**；其余失败记日志不重试 | 410 是端点永久失效的标准信号 | 订阅僵尸积累——410 清理已覆盖主路径 |
| D8 | Tabbar 扩为 5 个：会话 · 历史 · 新任务 · 知识库 · 设置 | Vant 移动端 5 Tab 标准布局 | 无 |
| D9 | M3 缓办 Minor **拿走快赢五个**（转发剥离 `?token=`、`/api` 前缀精确匹配、`void Buffer` 清除、ping 定时器 peer 别名、requestBuffers raw-close 泄漏），**缓三个重的**（1MB bodyLimit、多值 header、OPEN 帧编码器导出），**维持一项现状**（daemon stop 信号处理器——Windows 孤儿进程 workaround 已文档化） | 快赢低风险高价值；重的各需设计取舍，留后续 | 无 |
| D10 | new-session 边界校验**恒允许 vault 根**（daemon 配置路径，与已知集合同信任级） | 新机器从未跑过 vault 会话时 vault 根不在 scanner 集合内，M2 的 agent 整理入口会被 403 误伤 | 无 |

## 架构与数据流

```
PC daemon                              云                                PWA
─────────                              ─────────                         ─────────
watcher: result 行 → result 事件 ─┐
broker: 批准事件（已有）──────────┤→ 隧道 event 流 → EventBuffer ─→ push sender ─→ web-push → 手机通知
                                  │        │            │          （SSE 活跃的 clientId 跳过；410 清订阅）
                                  │        │            └─ /api/events/stream（已有，SSE 带 clientId）
                                  └─ /api/history/search（新增：过滤+封顶扫描）
                                         ↑ /api/push/subscribe|unsubscribe|key（新增）
                                         ↑ /api/messages（projectPath ∈ 已知集合校验）
PWA：历史 Tab（搜索+筛选+分页+跳转）· 新任务 Tab（项目下拉+首条指令）· 设置页推送开关 · 全局样式整理
```

既有复用：事件流管道（M3 全套）、`POST /api/messages` 开会话（M2 vault 入口）、`firstUserText` 索引（scanner）、vite-plugin-pwa 的 service worker 底座。

## 组件规格

### PC daemon

1. **push-source（watcher 桥）**：parse 层已产出的 `result` 类型行 → 桥为事件 `{kind:'result', sessionId, ok, excerpt, at}` 注入现有事件流（`eventSend`）。`ok = subtype==='success'`；`excerpt` 取 result 文本或会话 `firstUserText` 截断 ~80 字。去重保证：同一会话单次完成只产一条（JSONL 单条 result 行）。
2. **`GET /api/history/search?q=&project=&days=&limit=`**：先按 projectPath/时间元数据过滤会话集合 → 标题匹配（`firstUserText`，全量）+ 内容匹配（从新到旧逐文件扫，累计字节封顶 20MB 即停，`truncated:true`）→ `{matches:[{sessionId, projectPath, firstUserText, line, text, lastModifiedMs}], truncated}`，matches 上限 100。
3. **new-session 边界**：`POST /api/messages` 的 `projectPath` 必须 ∈ scanner 已知项目集合 **或等于配置的 vault 根**（D10），否则 403 `{error:'unknown_project'}`。

### 云

4. **`cloud/push/store.ts`**：订阅 CRUD + 原子落盘（tmp+rename）；条目 `{clientId, endpoint, keys, createdAt}`。
5. **`cloud/push/sender.ts`**：订阅 EventBuffer → 判定（approval / result 三态）→ 对每个订阅：SSE 活跃（同 clientId 在线）跳过；`web-push` 投递；410 删订阅。VAPID 未配置 → 全链路静默关闭并日志一行。
6. **`cloud/api/push-routes.ts`**：`GET /api/push/key`（VAPID 公钥；未配置 503）、`POST /api/push/subscribe`、`POST /api/push/unsubscribe`（均走手机 token 门）。
7. **事件流 SSE 带 `clientId` 查询参数**（可选字段，向后兼容）。

### PWA

8. **History.vue**：搜索框（防抖）+ 项目筛选（下拉）+ 时间范围（7/30/全部）+ 结果列表（摘要+命中行+相对时间）+ 跳转会话视图；`truncated` 显示提示条。
9. **NewTask.vue**：项目下拉（`/api/projects`，含搜索）+ 指令 textarea + 提交（复用 `POST /api/messages`）→ 成功提示并跳总览。
10. **设置页推送开关**：读公钥 → `Notification.requestPermission()` → `pushManager.subscribe(userVisibleOnly:true)` → POST 订阅；测试推送按钮；状态展示（未授权/已订阅/云端未配置）。
11. **Service worker**：`injectManifest` 自定义 `sw.ts`——保留 workbox 预缓存 + `push` 事件处理器（`showNotification`）+ `notificationclick`（聚焦或打开 PWA）。
12. **样式整理**：Vant 主题 CSS 变量（主色/圆角/间距 token）统一三页观感；不改布局结构。

## 错误处理

- 历史搜索超界/封顶 → `truncated:true`，UI 提示"仅扫描了最近部分会话"。
- VAPID 未配置 → `/api/push/*` 503，设置页显示"云端未配置推送"。
- projectPath 越界 → 403 明确文案。
- 推送订阅 payload 过期/非法 → subscribe 时校验 endpoint 为 https，keys 结构完整。
- Android 国内 FCM 不可达 → 一期面向 iOS PWA（owner 设备），spec 如实记录，不做适配。

## 测试策略

- push-source：fixture JSONL（含 result success / 非成功 / 无 result）→ 事件产出断言；daemon 驱动完成不双发（watcher 单源验证）。
- history-search：tmp 多会话文件 → 封顶截断 `truncated`、元数据过滤、标题+内容命中、limit。
- new-session 边界：已知项目过、未知项目 403。
- push store：CRUD + 落盘回读 + 原子写。
- push sender：假 web-push spy → 三态投递、SSE 活跃抑制、410 清订阅、VAPID 缺失静默。
- PWA：`highlightSegments` 同级的纯函数单测照旧；组件不加测试（沿用 M2 约定）。

## 里程碑内验收

1. 手机历史页：关键词命中跨会话内容并可跳转；项目/时间筛选生效；封顶提示可见。
2. 新任务页：下拉选项目 + 指令 → 新会话出现在总览、可续聊；curl 直发未知 projectPath 得 403。
3. 推送：4G 待机，TUI 里 agent 完成 → 手机收到通知；批准请求到达 → 收到通知；PWA 前台时不重复收；会话出错 → 收到通知。
4. 云服务重启后订阅仍在；测试推送按钮可达。
5. 样式统一过一遍（owner 主观过目）；快赢五个 Minor 各带测试合入。
6. vault 任务页 M4 标完成，需求地图 1~8 全绿。

## 风险

- iOS PWA 推送需加主屏 + iOS 16.4+（R3 已接受；owner 已加主屏）。
- 字节封顶搜索漏旧命中（D4 缓解：truncated 明示）。
- `web-push` npm 包在云端的可用性（纯 JS，npmmirror 可装，风险低）。
- service worker 自定义化（injectManifest）与 vite-plugin-pwa 版本兼容——spike 半日先行。
