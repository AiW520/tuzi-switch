# Codex 供应商端点管理 UI 经验

## 背景

Codex 订阅供应商存在多个可用 API URL，例如：

- `https://api.tu-zi.com/coding`
- `https://coding.tu-zi.com`
- `https://coding.opentu.ai`
- `https://coding.sydney-ai.com`

旧交互把 API 请求地址输入框、端点管理、测速放在不同层级里。用户在添加或编辑供应商时需要打开额外界面，测速后再回到表单确认，路径偏长，也容易让“当前选中的 URL”和“候选端点列表”看起来像两个独立配置。

## 调整原则

1. 当前 API URL 只保留一个真实来源

   Codex 表单里的 `codexBaseUrl` 仍是唯一数据源，但 UI 上不再额外显示一条独立输入框。用户通过端点列表选择当前 URL，选择动作直接回写 `config.toml` 的 `base_url`。

2. 管理和测速合并到表单内

   新增和编辑 Codex 供应商时，端点列表、自动选择、测速按钮直接显示在 `API 请求地址` 区块下方。这样测速不再打断添加流程，测速完成后可以立刻看到最快端点被选中。

3. 新增端点输入放在列表底部

   候选列表优先展示“当前可选项”，新增输入框放在末尾，符合“先看现有，再添加”的操作顺序，也减少顶部重复输入框造成的视觉噪音。

4. 编辑态避免额外保存按钮

   表单底部已有保存按钮负责供应商主体配置。端点管理区不再单独展示“保存”按钮；编辑态新增/删除自定义端点时即时同步，避免出现两个保存入口让用户误解。

5. 卡片展示关键信息但保持克制

   供应商卡片增加 `API` 标签展示当前 API URL，并将 API Key 掩码缩短为 3 个星号。Key 和 URL 统一使用轻量 pill 样式，既能快速扫描，也不抢占启用、编辑、测速等操作按钮的视觉权重。

## 实现经验

- 复用原有 `EndpointSpeedTest`，通过 `variant="inline"` 增加内嵌模式，避免另起一套测速逻辑。
- 端点候选来源需要覆盖新增和编辑两种情况：新增态按选中预设取 `endpointCandidates`；编辑态按当前 `base_url` 反查预设，补齐同组候选 URL。
- 组件同步端点列表时应保留用户自定义端点，但不能把上一个预设的候选 URL 带到下一个预设里。
- Tauri dev 调试时，如果系统里已运行正式版 App，dev 进程可能被同应用实例干扰。调试 UI 变化前先确认运行的是 `target/debug/tu-zi-switch`，不是 `/Applications/CC Switch For TuZi.app`。

## 验证要点

- 选择 `codex订阅` 后默认选中 `https://api.tu-zi.com/coding`。
- 端点列表同时展示 `https://api.tu-zi.com/coding`、`https://coding.tu-zi.com`、`https://coding.opentu.ai` 和 `https://coding.sydney-ai.com`。
- 点击测速后，在自动选择开启时选中延迟最低的 URL。
- 编辑已有 `codex订阅` 供应商时，也能显示同组候选 URL。
- 供应商卡片能展示 masked key 和当前 API URL。
