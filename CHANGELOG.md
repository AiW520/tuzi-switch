# Changelog

All notable changes to this project will be documented in this file.

## [1.1.4] - 2025-xx-xx

### Bug Fixes

- Fixed API Key not being recognized for OpenCode provider
- Fixed Codex CLI 0.134.0+ compatibility issue (deprecated `profile = "xxx"` configuration)
- Fixed multi-provider configuration conflict in Codex module
- Fixed Codex provider switch and API Key display inconsistency (provider list vs card display)

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