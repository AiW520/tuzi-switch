# Codex 供应商 API Key 串号问题复盘

## 问题现象

编辑某一个 Codex 官方供应商的 API Key 后，多个供应商卡片展示出的 API Key 变成同一个值。

这个问题属于高风险凭据串号：用户以为只改了一个供应商，实际多个供应商可能读到了同一个运行态 Key。

## 根因

Codex 供应商采用 env-first 凭据模型：

- `settingsConfig.config` 保存 Codex TOML。
- TOML 的 active `model_provider` 段保存 `env_key`。
- `settingsConfig.env.envKey` 保存同一个环境变量名，作为兼容与回显来源。
- 真实 API Key 保存在受管理的环境变量块中。

本次问题来自官方供应商种子配置改动：Codex 官方预设移除了独立 `env_key`，导致多个官方供应商退化到共享 `OPENAI_API_KEY` / legacy auth 路径。编辑任意一个供应商时，保存逻辑写入同一个凭据位置；卡片展示又从同一个位置读回，于是出现“全部变成同一个 Key”。

## 修复原则

Codex 官方供应商必须保持“一张供应商卡片一个独立 envKey”的不变量：

- 兔子线路：`TUZI_CODEX_API_KEY`
- codex 订阅：`CODING_CODEX_API_KEY`
- gaccode：`GAC_CODEX_API_KEY`

种子刷新时可以迁移旧字段里的 Key，但目标结构仍必须恢复独立 envKey，不能把多个供应商合并到 `OPENAI_API_KEY`。

## 本次修复

- 恢复 Codex 官方供应商 TOML 中的 `env_key`。
- 恢复 `settingsConfig.env.envKey`，保证卡片展示、编辑页初始化、保存逻辑使用同一个凭据索引。
- 保留 `env.CODEX_API_KEY` 作为旧数据迁移来源，但只迁移到当前供应商自己的配置中。
- 扩展回归测试，覆盖三个 Codex 官方供应商分别保存不同 Key 后重新 seed 仍互不串号。
- 修复 Codex backfill 时丢失 `[profiles.*]` 的问题，避免供应商切换后 profile override 无法恢复到原 provider id。

## 多 Key 边界

当前设计支持的是“多个供应商卡片，每张卡片一个 API Key”。如果同一个上游供应商需要多个 Key，应创建多个 provider，例如 `tuzi-key-1`、`tuzi-key-2`，让每张卡片拥有独立 envKey。

“一个供应商卡片内部配置多个 Key 池、轮询、熔断”不是本次 bugfix 范围。它需要单独设计数据结构、脱敏展示、失败隔离、并发安全和代理层调度策略，不能混入凭据串号事故修复。

## 经验

1. 凭据字段不能只看“能跑”，必须明确每个 provider 的隔离边界。
2. seed 更新不是纯展示数据刷新，可能覆盖用户配置；所有 seed 迁移都要写回不变量测试。
3. env-first 模型里，`auth.OPENAI_API_KEY` 只能作为兼容来源，不能重新变成多个 provider 的共享目标。
4. live config 是运行态输出，不等同于 provider 的编辑态 SSOT。
5. 修复凭据问题时要优先写多供应商差异化测试，而不是只测单个供应商不丢 Key。

## 验证点

- 三个 Codex 官方供应商分别保存不同 API Key 后，重启或重新 seed 不会串号。
- 缺失 `env_key` 的旧配置会恢复到供应商专属 envKey。
- Codex 切换供应商后，live config 使用正确 token。
- Codex backfill 后，provider 自己的 `model_provider` 和 `[profiles.*]` override 仍可恢复。
