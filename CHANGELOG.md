# Changelog

All notable changes to this project will be documented in this file.

## [1.1.26] - 2026-06-10

### Improvements

- 为 Codex 订阅供应商新增 `https://coding.opentu.ai` 和 `https://coding.sydney-ai.com` 两个 API 请求地址候选，并复用同组充值与查询入口。

### Documentation

- 更新 Codex 供应商端点管理经验文档，补充新增候选端点的验证要点。

## [1.1.25] - 2026-06-09

### Fixes

- 修复 Codex 供应商卡片已显示 API Key，但进入编辑页后 API Key 输入框为空的问题。

### Documentation

- 补充 Codex env-first 凭据来源与编辑表单初始化的复盘经验。

## [1.1.16] - 2026-06-08

### Fixes

- 发布验证版本，用于确认 GitHub release fallback 更新检测链路可发现后续新版本。

## [1.1.15] - 2026-06-08

### Fixes

- 在 Tauri updater 清单缺失时降级读取 GitHub latest release，避免启动和手动检查完全发现不了新版本。
- 对无签名清单场景使用手动下载更新流程，避免误触发不可用的自动安装重启。

## [1.1.14] - 2026-06-07

### Fixes

- 修复发布流程在缺少可选签名密钥时阻断安装包构建的问题。
- 修复 Windows 打包时中文产品名可能导致安装器构建失败的问题。
- 将 Release 创建延后到安装包构建完成后，避免前置 Release 状态异常阻断多平台构建。

## [1.1.13] - 2026-06-07

### Fixes

- 修复原生更新清单不可用时会阻断界面热更新检查的问题。
- 强化发布流程校验，避免缺少签名密钥或 updater 签名产物时发布无法自动更新的版本。

### Improvements

- 将用户可见应用名称更新为「兔子switch」，覆盖安装包名称、窗口标题、关于页、提示文案与发布说明。

## [1.1.11] - 2026-06-07

### Features

- Integrated Codex endpoint management and speed testing directly into the provider add/edit form.
- Added dual URL candidates for the Codex subscription provider and automatic fastest endpoint selection.
- Displayed the active API URL on provider cards with a compact key and API badge layout.

### Fixes

- Preserved Codex subscription endpoint candidates when editing existing providers.
- Removed duplicate API URL inputs and redundant inline endpoint save action.
- Removed Codex `env_key` when writing experimental bearer token config to avoid missing environment variable crashes.

### Documentation

- Documented Codex endpoint management UI design lessons and verification points.

## [1.1.10] - 2026-06-07

### Fixes

- Replaced the GitHub Release publish API call with `gh release edit --latest`.

## [1.1.9] - 2026-06-07

### Fixes

- Allowed GitHub Releases to publish installer assets even when updater signing secrets are not configured.
- Skipped updater manifest generation when signed updater artifacts are unavailable.

## [1.1.8] - 2026-06-07

### Fixes

- Treated the Tauri signing key password as optional in release secret validation.

## [1.1.7] - 2026-06-07

### Fixes

- Fixed GitHub Actions workflow validation by avoiding job-level `secrets` expressions.
- Kept Web hot update publishing optional without blocking the native release workflow.

## [1.1.6] - 2026-06-07

### Fixes

- Fixed release workflow signing environment variables for Tauri updater artifacts.
- Added early release secret validation so failed releases report missing signing secrets clearly.
- Made frontend hot update publishing optional when the minisign private key is not configured.

## [1.1.5] - 2026-06-07

### Features

- Added Tauri official updater release flow with signed updater artifacts.
- Added signed frontend hot update flow for Vite/React assets.
- Added Capability Facade v1 for stable native capability discovery and invocation.

### Security

- Removed App-side remote install script execution from the automatic update path.
- Added sha256 and minisign verification before enabling frontend hot update assets.
- Restricted hot-updated frontend terminal command capability to declared safe commands.

### Documentation

- Documented the automatic update, frontend hot update, and capability-layer design.
- Updated README installation and update mechanism notes.

## [1.1.4] - 2025-xx-xx

### Bug Fixes

- Fixed API Key not being recognized for OpenCode provider
- Fixed Codex CLI 0.134.0+ compatibility issue (deprecated `profile = "xxx"` configuration)
- Fixed multi-provider configuration conflict in Codex module
- Fixed Codex provider switch and API Key display inconsistency (provider list vs card display)
- Fixed legacy Codex provider API Key detection (support old config formats with env_key at top-level or in profiles section)

### Improvements

- Updated Codex configuration handling to support new `model_provider` format
- Added automatic migration for legacy Codex profile configuration
- Improved API Key detection logic for OpenCode applications

### Technical Changes

- Updated React Query usage in ProviderList component
- Fixed TypeScript type errors in provider configuration utilities
- Removed unused imports and dead code

## [1.1.3] - 2025-xx-xx

### Bug Fixes

- Various minor bug fixes and improvements

## [1.1.2] - 2025-xx-xx

### Features

- Initial public release
- Support for Claude Code, Codex, and Gemini CLI
- Multi-provider management
- API Key configuration
- Code editor integration
