# ccferry

给电脑上的 Claude Code 做远程分身：出门在外时**监控进行中的开发会话、续聊、远程批权限、收完成推送**，并**管理个人知识库**（浏览/搜索/编辑/指挥 agent 整理）。

## 核心思路

Claude Code 的每个会话都是本地 JSONL 文件（`~/.claude/projects/<项目>/<session-id>.jsonl`），本地 TUI 只是视图之一。ccferry 给同一份会话数据长出第二个视图：

- **监控面（只读）**：watch 会话文件实时流出——本地正在跑的任务也能看，零干扰
- **操作面（读写）**：Agent SDK `resume` 空闲会话接完整历史；`canUseTool` 权限请求路由到远端批准
- **知识库（一期核心）**：vault 是其中一个「项目」，浏览/搜索/编辑直连文件系统；「agent 整理」= 对 vault 会话发指令

## 架构

```
手机/浏览器 ──HTTPS──▶ 云服务器（静态 PWA + 自研隧道协议服务端）
                          ⟵ WSS 单出站长连接（自研 6 帧协议）⟵
                    PC agent 客户端（Agent SDK + 会话 watcher + 知识库服务 + localhost API）
```

单包原则：PC 端一个进程，云端一个进程，全 TypeScript monorepo。

## 状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | PC 裸跑 daemon + localhost API | 计划就绪 → `docs/superpowers/plans/2026-09-26-m1-local-daemon.md` |
| M2 | PWA + 权限路由 + 知识库管理 | 待 M1 证据 |
| M3 | 私有隧道协议 + 云部署 | 待 M2 |
| M4 | 历史页 + 打磨 | 待 M3 |

- 设计 spec：`docs/superpowers/specs/2026-09-25-claude-code-remote.md`
- 证据日志：`docs/notes/m1-findings.md`
