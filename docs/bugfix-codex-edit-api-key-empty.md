# Codex 编辑页 API Key 为空问题复盘

## 问题现象

Codex 供应商卡片上已经能展示脱敏后的 API Key，例如 `sk-xxxx***yyyy`，但点击编辑进入供应商表单后，API Key 输入框为空。

这个现象会误导用户以为 Key 没保存成功，也可能在保存时触发“非官方供应商请填写 API Key”的软校验。

## 根因

Codex 的新配置链路采用 env-first 方案：

- 供应商配置里的 `settingsConfig.config` 保存 TOML。
- TOML 的 active `model_provider` 段中保存 `env_key`。
- 真实 API Key 保存在受管理的 shell 环境变量块中，通过 `read_codex_env_key` 读取。

卡片展示 API Key 时使用的是数据库里的 provider 配置，能正确拿到 `env_key` 并读取真实 Key。

但编辑当前生效供应商时，`EditProviderDialog` 会优先读取 live 配置覆盖数据库配置。Codex 的 live 配置是运行态配置，不适合作为编辑表单的单一事实来源，可能不带原 provider 的 `env_key`，导致编辑表单无法回读托管环境变量里的 Key。

## 修复原则

Codex 编辑表单应和卡片保持同源：使用数据库 provider 的 `settingsConfig` 初始化，而不是使用 live 配置覆盖。

这次修复只调整初始化来源：

- Codex 编辑时跳过 live 配置读取。
- 保持 `auth: {}` + `env.envKey` + TOML `env_key` 的存储结构。
- 继续由 `useCodexConfigState` 通过 `read_codex_env_key` 读取真实 API Key。
- 保存时继续通过 `save_codex_route` 写入托管环境变量和 Codex route。

## 经验

1. 卡片展示、编辑表单、保存逻辑必须使用同一种凭据来源模型；否则容易出现“外面有、里面空”的状态漂移。
2. live 配置适合反映当前运行状态，不一定适合反向初始化编辑表单。
3. 对 env-first 这类间接凭据模型，修复时不要为了回显方便把 Key 写回旧字段，例如 `auth.OPENAI_API_KEY`，否则会破坏迁移后的数据结构。
4. 判断配置来源时优先问：哪个对象是用户可编辑配置的 SSOT。Codex provider 的 SSOT 是数据库配置，不是 live config。

## 验证点

- Codex 卡片显示脱敏 API Key 时，点击编辑后输入框应回显同一个真实 Key。
- 保存后 provider 配置仍保持 `auth: {}`，并保留 `env.envKey` 与 TOML `env_key`。
- `pnpm typecheck` 通过。
