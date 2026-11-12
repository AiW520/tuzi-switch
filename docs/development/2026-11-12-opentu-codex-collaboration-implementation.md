# OpenTU / Codex 双向创作协同：第一阶段实施

任务：UC-CODEX-COLLAB-01。用户已选择 [B 方案](2026-11-12-opentu-codex-collaboration-proposal.md)，优先工作流为“讨论创作 → Codex 使用 Skill/MCP → 操作 OpenTU 画布和媒体”。本地分支 `codex/opentu-codex-collaboration`，基线 `1258a1c54c35c26dcca6e79b3cee72599c47d8ae`。本轮不推送、发布或调用付费模型。

## 已实现的路径

- 讨论中开启画板协同，再连接本地 Codex，即可使用 App Server 执行工具；未开启协同的旧连接继续只生成讨论计划。
- 外部 Codex 使用讨论区显示的 stdio MCP 配置连接同一业务层。应用通过 Windows 本机命名管道（Unix 为 socket）传输，nonce 存在私有连接文件中。
- 支持读取画板、选区图片、讨论和 OpenTU 创作 Skill；查询媒体作业；确认后生成图片/视频/音频、调整几何位置、插入文本或本地图片、追加讨论结果。
- 生成复用既有任务队列和画布占位，不另建媒体执行器；返回真实任务 ID，不能把排队当成成功生成。
- Codex 工具事件和执行/文件/权限请求在讨论区呈现；不支持的交互请求明确拒绝。OAuth 登录仍在对应工具中完成。
- 每个讨论保存 Codex thread ID，后续恢复时只发送新请求；空闲执行器两分钟后释放。断开时撤销挂起操作和旧回调，并结束对应执行器；已经提交给外部服务的工作不因此保证取消。

## 接入与 Skill 边界

1. 打开目标画板及讨论，点击“启用当前画板协同”。内置讨论还需连接本地 Codex；外部 Codex 可直接使用下一步的 MCP 入口。
2. 在“连接外部 Codex”复制当前可执行文件对应的配置，加入 Codex MCP 设置并刷新连接。已有同名 `opentu` 配置应核对后合并，不能重复添加 TOML 表。OpenTU 必须运行且画板协同已开启；开发目录移动后需更新可执行文件路径。
3. 项目提供 `skills/opentu-collaboration/SKILL.md` 包装 Skill，可通过现有 Skill 管理流程导入，或将整个目录放入 Codex 支持的 Skill 目录。它引导客户端调用 MCP，不包含新的执行脚本。
4. 本地完整 Skill 由 Codex 原生发现和执行，沿用已有每应用同步和禁用设置，不把整个 SSOT 强制启用。OpenTU 文本创作 Skill 经 `skills_list/read` 暴露来源、原 ID 和内容指纹；其中引用的 scripts/assets 不会因读取正文而自动安装。
5. 能力枚举展示当前 CLI 返回的 Skill/MCP，不等同于 Codex 桌面宿主全部工具、插件和云连接器。不能执行的依赖需单独适配。

## 操作与恢复约束

- 一个应用实例同时授权一个画板/讨论。切换画板会阻止旧画板操作，需断开后重新连接；不会跟随导航静默扩大范围。
- 画布修改需要最新 revision，并在确认后再次校验；几何批量修改预先验证全部元素，作为一个撤销批次。
- 所有持久写操作使用 `operationId`。先保存意图，再执行；完成后重复请求返回原结果。KV 写入等待事务提交，协同记录使用 strict durability，并且读取失败不作为记录不存在处理。中断或结果落盘失败保持待核实，不自动重试。`operation_get` 和 `job_get` 用于恢复检查。
- 用户确认有时限；断开、到期或授权代次改变后不执行排队操作。媒体确认显示模型、数量、提示词及费用提示。
- `asset_import` 只接受讨论输出目录内的相对路径和受支持图片，校验规范路径、文件大小及图片可解码；不接受任意本地路径或 URL。
- `discussion_append` 仅保存结果，不重新发起推理，阻断互相转发形成循环。

## 验证记录

- `cargo check --lib -j 1` 与最终 `cargo check --bins -j 1`（debug 信息关闭）：通过。原有 unused/dead-code 警告仍在。
- 宿主 `tsc --noEmit`：通过。
- 创作服务定向回归：98 项通过（94 项初始回归、3 项 KV 事务回滚/提交/读取失败测试、1 项异步 Skill 来源与指纹测试），覆盖讨论、runtime、Codex 路由、操作去重、过期、跨画板、断开及重连后旧请求失效。
- 宿主原生通道单测：5 项通过，覆盖活动/审批事件不会提前完成文本响应等。
- 包装 Skill：`quick_validate.py` 通过。
- 本机 CLI 0.167.0 实际只读探测：initialize 成功；9 个模型、8 个 Skill（0 个解析错误）、2 个配置 MCP，状态枚举返回 2 个。未调用 `turn/start`。
- Windows `cargo test --lib creative_ -j 1 -- --test-threads=1`：25 项通过，包括真实命名管道往返、错误 nonce、不允许注入画板、挂起请求撤销，以及模拟 App Server 乱序事件、线程隔离、旧规划路由禁用工具和取消。
- 创作包 Vite production 构建：最终 CSS 修正后关闭 sourcemap/minify 的验证构建通过（2m27s）；默认压缩/sourcemap 构建未在本机通过，不据此认定发布构建通过。
- 补充创作源码类型检查发现并修复异步 Skill 元数据缺少 `await`，最终重跑时修改文件无类型诊断。该扩展检查仍有未修改文件中的上游类型错误（ArrayBufferLike/BlobPart、模型 benchmark atom、discussion-canvas 尺寸、fallback-executor 转换等），不记为全包类型通过。
- Ego 浏览器合成传输已通过 8 项：连接、能力列表、画板读取、确认后文字实际插入、重复请求不重复插入、旧 revision 拒绝、拒绝请求无副作用、Codex 普通文字回复。发现能力列表撑出讨论区域遮住确认按钮，已增加有界滚动，在浏览器注入同一 CSS 后确认按钮可点击。后续追加结果/断开 UI 检查因浏览器最小化暂停；这些业务路径已有单测覆盖。

内存处置：初始提交内存不足导致依赖安装、Rust Windows 依赖检查失败。按用户“你去清理吧”授权正常关闭微信开发者工具窗口，未强杀应用或修改页面文件设置，释放约 3 GB 提交内存。串行执行重检查；前端 sourcemap 打包在 1.5 GB Node 上限下失败，改用仅本次构建关闭 sourcemap/minify、3 GB 上限验证，不修改项目默认配置。

## 未完成的验收与后续阶段

- 真实 Codex 推理 → Skill/MCP → 付费媒体生成尚未验收；模拟和能力发现不能代替实际成功。
- 当前未覆盖 Windows 完整安装包中的双向实机流程，也未验证 macOS/Linux socket。
- MCP 一键注册、完整 Skill 依赖/版本兼容诊断、跨来源导入冲突界面属于 B 方案后续能力管理阶段；当前复用已有管理器，不新建双向自动文件同步。
- 未推送、未发布；旧安装包不会因为源码更新自动具备新功能。
