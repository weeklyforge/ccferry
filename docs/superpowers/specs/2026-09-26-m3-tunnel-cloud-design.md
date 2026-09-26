# ccferry M3 设计 Spec（私有隧道协议 + 云部署）

> 定稿 2026-09-26，基于 M2 交付（main @ `96707f5`，含 minor 积压清零）。前序：总 spec `2026-09-25-claude-code-remote.md` · M2 spec `2026-09-26-m2-lan-pwa-vault-design.md` · 证据 `docs/notes/m1-findings.md` `docs/notes/m2-findings.md`。与总 spec 冲突处以本文件为准，修订见文末。

## 背景与目标

**M3 验收**：手机在公网（4G/5G，离开家庭 Wi-Fi）通过云服务器访问 `https://39.105.92.24.nip.io(:8443)/`，走自研隧道完成 M2 全流程——总览/实时流/续聊/批准卡/知识库；断线指数退避自动恢复；两层 token 独立把门；Caddy 证书自动签续。证据落 `docs/notes/m3-findings.md`。

**推送后置**（D2'）：Web Push（手机后台通知）移至 M3.5/M4 初补；隧道事件流（推送的数据源）本期建成。

## M3 拍板决策（2026-09-26 brainstorming 定稿）

| # | 决策 | 依据 |
|---|---|---|
| D1' | 域名/证书 = **nip.io 零成本路线**：`39.105.92.24.nip.io` + Let's Encrypt（Caddy 自动签续）；备案拦截实测不通则改监听 8443 | 裸 IP 无域名无证书； nip.io 免注册零成本；风险（国内解析/LE 限签/备案拦截）由 Spike S1 实测定夺 |
| D2' | **Web Push 后置**（M3.5/M4 初补） | PWA 前台 SSE 已实时；iOS 加主屏 + VAPID 是独立一块坑；事件流管道先建 |
| D3' | 云端 TLS 入口 = **Caddy sidecar**（443/8443 反代 127.0.0.1:8788，两 systemd unit） | 证书零代码自动续期；"单包"指 ccferry 自身制品（Bun 单 exe）不破，Caddy 属通用基础设施 |
| D4' | 隧道协议 v0 = 六帧二进制长度前缀（AUTH/AUTH_OK/OPEN/DATA/CLOSE/PING/PONG），帧编解码放 `@ccferry/protocol` 共享 | spec 原案；抄 FRP 的多路复用/流路由，不抄其配置系统等 |
| D5' | **Bun 单包 spike 为 M3 首批 task**（内嵌+运行时解压优先、伴生文件兜底，含 SDK 子进程实测） | owner 2026-09-26 拍板；失败兜底 = 服务器 node+tsx 部署态 |

云机事实（已核知识库）：39.105.92.24（智控-轻量2）SSH root 免密就绪；已占端口仅 18080/18082（dragguard 两 systemd 服务）；**80/443 空闲**；部署文化 = systemd + `/opt`。

## 架构总览

```
手机 PWA(4G) ──HTTPS──▶ Caddy :443/8443 (nip.io + LE)
                          │ reverse_proxy
                          ▼
                    ccferry-cloud (127.0.0.1:8788, 单进程)
                    ├─ 静态直出 packages/pwa/dist
                    ├─ /api/* ──隧道流映射──▶ WSS ──────────▶ PC daemon 内 TunnelClient
                    ├─ /api/events/stream (云本地 SSE, ring buffer)      │ http-bridge → 127.0.0.1:8787
                    └─ /tunnel (WSS 服务端, AUTH 验隧道 token)           │ event-bridge → broker 订阅
                                                                      ▼
                                                              PC daemon (M2 全功能不变)
```

## 1. 隧道协议 v0

**帧格式**：`[type:1B][streamId:4B][length:2B][payload:length]`，payload ≤64KB 超限发送方分片。

| type | 帧 | 方向 | 语义 |
|---|---|---|---|
| 0x01 | AUTH | PC→云 | 首帧（streamId=0），payload=隧道 token（UTF-8） |
| 0x02 | AUTH_OK | 云→PC | 验证通过；失败即断连（无重试面） |
| 0x03 | OPEN | 双向 | `kind:1B`（0=http,1=event）+ meta JSON；http meta=`{method,path,headers}` |
| 0x04 | DATA | 双向 | http 流：**首帧 JSON `{status,headers}`，后续 body 二进制**；event 流：JSON 事件 |
| 0x05 | CLOSE | 双向 | payload=2B 错误码；流终结（0=正常） |
| 0x06/07 | PING/PONG | 连接级 | 30s 间隔，60s 无 PONG 判死 |

- streamId：云分配 http 流（1 递增）；PC 主动 event 流用 `0x80000000+` 区间。
- **HTTP 映射**：云收手机 `/api/*` → 分配 id → OPEN（body ≤64KB 随后一帧 DATA，大 body 分片）→ PC fetch localhost → DATA(头)+DATA(body 分帧)→CLOSE；云重组回手机。
- **SSE 透传**：响应头 `content-type: text/event-stream` → 云不缓冲逐帧 flush；PC 侧 body 逐读逐帧不聚合。
- **背压 v0**：无 WINDOW 帧协议；PC 侧 ws `bufferedAmount` >16MB 暂停读上游、回落续读（TCP 反压传导）。意图等同 FRP 每流窗口，机制从简。
- **Event 流**：AUTH 后 PC `OPEN{event}` 常驻；桥接 broker 事件（approval request/settled）与隧道 connected/disconnected。云入 64 条 ring buffer，经云本地 `GET /api/events/stream`（SSE）分发——**手机订阅不走隧道**。result 类事件（完成/阻塞/出错）随推送后置（D2'）。
- **断线**：PC 指数退避重连（1s·2ⁿ 封顶 60s，±20% 抖动）；重连重做 AUTH + 重建 event 流 + **补发当前 pending 快照**（与 M2 重连语义对齐）；云侧在途 http 流即时 502。

## 2. 云端进程与部署（`packages/cloud`，第 4 个 workspace 包）

```
packages/cloud/src/
  main.ts                    组装：env config + fastify + 隧道 + 静态托管
  tunnel/server.ts           WSS 服务端：AUTH 常量时间校验、帧循环、PING/PONG、同 token 踢旧连
  tunnel/stream-router.ts    streamId ↔ 挂起请求/响应重写、SSE 透传、502 兜底
  events/buffer.ts           ring buffer(64) + SSE 分发
packages/protocol/src/frame.ts  帧编解码纯函数（云/PC 共享 wire 契约）
```

- 栈：Fastify + `@fastify/websocket`；`/tunnel` 承载 WSS，同端口 8788 **仅监听 127.0.0.1**；公网只暴露 Caddy。
- PWA 复用同一 `dist/`：在家直连 PC LAN IP、出门走云域名，PWA 设置页改 `daemonBase` 切换，前端零改动。
- Caddyfile：`39.105.92.24.nip.io { reverse_proxy 127.0.0.1:8788 }`；拦截则 `https://:8443`。
- systemd：`ccferry-cloud.service`（`MemoryMax=512M`、`Restart=always`、env 注入双 token）；Caddy 单独 unit；部署物 `/opt/ccferry/ccferry-cloud`（Bun 单 exe 或 node 源码态）+ `/opt/ccferry/pwa-dist/`。
- `packages/cloud/scripts/deploy.sh`：PC 一键 scp + ssh systemctl restart；Bun spike 成败两态兼容。

## 3. PC 端隧道客户端（`packages/client/src/tunnel/`，进程内模块）

```
client.ts        WSS → AUTH → AUTH_OK → OPEN(event) → 服务循环；PING 30s/60s 判死
backoff.ts       nextDelayMs(attempt) = min(1000·2ⁿ, 60s) ±20%（纯函数）
http-bridge.ts   OPEN(http) → fetch 127.0.0.1:8787 → DATA/CLOSE 回灌
event-bridge.ts  broker.subscribe → event 流 DATA
```

- 拉起条件：`CCFERRY_TUNNEL_URL` + `CCFERRY_TUNNEL_TOKEN` 同时设置；未设 = 纯 LAN 模式零开销。ws 库 = `ws`。
- http-bridge：剥 hop-by-hop 头；PC 开 `CCFERRY_TOKEN` 时补 Bearer（家用/出门同进程共存）；隧道断 → AbortController 取消在途 fetch；上游错误 CLOSE(1) 云转 502。
- 测试钉：backoff 边界、frame codec round-trip（protocol 侧）、http-bridge mock-fetch 帧序列（含 SSE case）、event-bridge fake-broker、TunnelClient 进程内真 ws 集成回环。

## 4. 认证与安全

| 层 | 凭据 | 验证点 | 机制 |
|---|---|---|---|
| 隧道 | `CCFERRY_TUNNEL_TOKEN` | WSS AUTH 首帧 | 常量时间比较；失败即断；每 IP 5 次/分钟封 10 分钟（内存） |
| 手机 | `CLOUD_TOKEN_PHONE` | 云端 `/api/*` | Bearer/`?token=`——复用 M2 PWA 机制，前端零改动 |
| PC daemon | `CCFERRY_TOKEN`（可选） | 本地 | 不变（环回免验 / LAN 模式） |

- 云→PC 转发**剥手机 token**；token 生成 `openssl rand -hex 32`，轮换 = 改 env 重启。
- **M2 遗留硬化并入**：vault `resolveInside` 加 `fs.realpath` 复核（防符号链接逃逸）；云 pino `redact: ['req.url','req.headers.authorization']`。
- 同 token 二连 → 踢旧连；云审计日志（脱敏）记录隧道连断/AUTH 失败/手机请求。
- 已知接受（R4 原样）：隧道非 E2E，云端可见会话内容；个人单用户威胁模型接受，二期可选应用层 E2E。

## 5. Spike 清单与验收

| Spike | 内容 | 兜底 |
|---|---|---|
| S1 nip.io+LE+备案 | 国内解析（4G+家宽）、Caddy 443 签发/限签、80/443 拦截实测、8443 备选 | sslip.io → 回退讨论 |
| S2 Bun 单包 | compile 打 client/cloud；**单 exe 下 SDK spawn CLI 实测**；ws/fastify 兼容 | node+tsx 部署态 |
| S3 WSS 保活 | NAT/安全组掐空闲连接时长 → PING 间隔校准 | 并入部署验证 |

**验收**：① 4G 出门全流程（M2 六项走隧道）②断线退避恢复 + pending 补发 ③在途请求 502 不悬挂 ④错隧道 token 连不上/错手机 token 401 ⑤证书自动签续 ⑥事件流管道建成、通知段未交付（D2' 声明）⑦findings 落档 + vault 任务页 M3 标完成。

## 修订记录（对总 spec）

1. **Web Push 自 M3 移至 M3.5/M4 初**（D2'）——事件流数据源照建。
2. 域名/证书细化为 nip.io 零成本路线（D1'），"共口共证书"具体化为 Caddy sidecar（D3'）。
3. "每流窗口"细化为 bufferedAmount 背压机制（v0 从简，无 WINDOW 帧）。

## 风险与待验证

- nip.io 三重风险（解析/限签/拦截）未实测——S1 是云端一切的前置。
- Bun 单 exe 下 SDK 子进程行为未知——S2 失败则部署态退化，不影响代码形态。
- 阿里云轻量服务器带宽（一般 3~5Mbps 峰值）对 SSE 流式会话的吞吐上限——验收时实测滚动体验。
- result 类事件后置意味着"任务完成提醒"暂缺——PWA 前台可见，后台盲期由 D2' 接受。

## 相关

- 总 spec：`2026-09-25-claude-code-remote.md` · M1/M2 spec 与 plans 同目录 · vault 任务页（obsidian-git 留痕）
