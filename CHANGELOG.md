# Changelog

All notable changes to this project will be documented in this file.

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
