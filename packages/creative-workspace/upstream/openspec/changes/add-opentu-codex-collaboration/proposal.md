# Change: OpenTU 与 Codex 双向创作协同

状态：2026-11-12 用户已选择 B，授权本地实施与验证。

## Why

当前 Codex 讨论接入禁用工具执行和 MCP，现有 Skill/MCP 管理未形成双向创作闭环。用户要求 OpenTU 使用 Codex Skill/MCP，外部 Codex 也可以使用 OpenTU Skill 并操作画布和媒体。

## What Changes

- 候选方案 B：扩展 App Server 会话、能力探测、工具事件及审批。
- 提供 OpenTU MCP 与共享业务操作层，复用画布和媒体任务队列。
- 增加 Skill 来源、依赖与兼容目录，保留完整包或提供 OpenTU 工作流包装。
- 增加任务身份、写入版本校验、操作去重与恢复行为。
- 先做双向创作；同一桌面聊天镜像和通用项目开发不列入首期。

## Impact

涉及原生 Codex 桥、宿主 bridge-types、讨论服务、Skill/MCP 管理、画布与任务队列。详细事实、方案比较、架构、边界与验收见仓库根目录 `docs/development/2026-11-12-opentu-codex-collaboration-proposal.md`。
