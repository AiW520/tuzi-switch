# Codex 0.134.0+ 升级及缺失环境变量问题的经验总结

## 1. 问题背景

在新版的 Codex (>= 0.134.0) 及 OpenCode 环境下，原本在旧版配置（`config.toml`）中顶层指定的 `profile = "xxx"` 字段已被废弃，并且不能再出现。如果在配置文件中出现了废弃的 `profile` 字段，会导致 Codex 无法解析功能覆盖优先级，并抛出类似如下的错误：

```text
failed to resolve feature override precedence: legacy `profile = "codex"` config is no longer supported; use `--profile codex` with `codex.config.toml` instead
```

同时，针对一些依赖于 `config.toml` 中的 `experimental_bearer_token` 字段存储的 API Key（特别是非官方或自定义路由的供应商），如果我们在自动修改或生成 `config.toml` 期间（例如在切换或保存供应商配置时），未将原有的 `experimental_bearer_token` 字段提取并在新生成的配置文本中正确还原，会导致 Codex 在运行时因为缺少此 Token 报出类似如下错误：

```text
Missing environment variable: ``
```
另外，如果生成的 TOML 配置中给 `env_key` 设置了空字符串 `""`，Codex 同样会去寻找名为 `""` 的环境变量而导致抛出此错误。

## 2. 根本原因

1. **版本检测的不可靠性与向下兼容的问题**：旧代码试图通过探测 `codex --version` 来决定是否输出包含 `profile = "xxx"` 格式的配置。然而，在只有 `opencode` 没有 `codex`，或者系统上存在较旧的 Codex 实例时，版本检测会 fallback 到旧版本逻辑，强制输出包含 `profile` 的文件格式，导致新版本的执行工具（如 OpenCode CLI）直接崩溃。
2. **`env_key` 字段容错性差**：在组装 TOML 配置时，若用户的环境中没有填写 `env_key` 而是直接保存了，代码组装了 `env_key = ""` 的字符串注入 TOML。Codex 引擎解析到此配置时，会尝试寻找名为 `""` 的环境变量，从而引发 "Missing environment variable: ``" 错误。
3. **切换/保存时丢失 Token 配置**：第三方的 Provider 往往在 TOML 文件中写入 `experimental_bearer_token` 来保存 API Key，以防止覆盖掉 `auth.json` 中用户的原生 OpenAI 登录态。但是在执行 `switch_codex_profile` 逻辑（仅对配置做局部替换并生成最终配置内容）时，新的配置块会完全覆盖或丢失之前 `config.toml` 里面独立设定的 `experimental_bearer_token` 字段，使得在切换/更新后，引擎在读取配置时丢失了 Token 鉴权信息。

## 3. 修复方案

针对以上问题，采取了以下几个关键步骤进行修复，确保对齐最新的 `cc-switch` 逻辑：

### 3.1 强制停用旧版 `profile` 字段
废弃不准确的版本探测逻辑，强制所有环境都使用新版本格式（即不包含顶层 `profile = "xxx"`）。

*修改代码* (`src-tauri/src/codex_config.rs`):
```rust
pub fn is_new_profile_format() -> bool {
    true // Always use new format, fix issue: legacy `profile = "codex"` config is no longer supported
}
```

### 3.2 避免写入空的 `env_key`
在 `save_route_to_config` 方法中，当检测到传入的 `env_key` 为空字符串时，不主动写入 `env_key = ""` 配置，从而避免 Codex 引擎将其误识别为要求一个名字为空的环境变量。

*修改代码* (`src-tauri/src/codex_config.rs`):
```rust
let mut provider_section = format!(
    "[model_providers.{route_id}]\nname = \"{route_id}\"\nbase_url = \"{base_url}\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n"
);
if !env_key.trim().is_empty() {
    provider_section.push_str(&format!("env_key = \"{env_key}\"\n"));
}
```

### 3.3 在配置更新/切换时保留 `experimental_bearer_token`
当保存或切换线路时，将原有的 `config_str` 里的 `experimental_bearer_token` 主动提取出来，并在生成了新的最终配置 (`final_config`) 之后，将其还原回去。

*修改代码* (`src-tauri/src/services/provider/live.rs`):
```rust
let mut final_config =
    switch_codex_profile(&config_with_route, &route_id, Some(&model), Some(&effort))?;

// Restore experimental_bearer_token if it exists in the provider's config
if let Some(token) = crate::codex_config::extract_codex_experimental_bearer_token(config_str) {
    if let Ok(updated) = crate::codex_config::set_codex_experimental_bearer_token(&final_config, &token) {
        final_config = updated;
    }
}
```
*同步暴露辅助方法* (`src-tauri/src/codex_config.rs`): 将原本私有的 `fn set_codex_experimental_bearer_token` 提升为 `pub fn` 以供跨模块调用。

## 4. 总结与反思

- **配置工具的更新策略**：当依赖外部 CLI 工具（如 Codex、OpenCode 等）时，其配置规范若发生不向后兼容的更新，应尽快对配置生成逻辑进行对齐，而不是采用容错率低的版本检测回退策略，以避免部分用户因环境差异受阻。
- **环境隔离和状态持久化**：针对需要“部分替换”配置的操作，需十分小心不要将配置文件中不在当前管理视野内但极其关键的鉴权字段（如 `experimental_bearer_token`）无意抹除。
- **参考上游（如 cc-switch）**：类似的功能由于在多仓库中存在，若在某一仓库（如 `tuzi-switch`）复现了 BUG，首选动作应是去上游基准库（如 `cc-switch`）中查看最新代码解决该问题的成熟做法并借鉴同步。