# Codex 配置升级与 OpenCode API Key 识别修复文档

## 概述

本次修复包含两个独立但相关的问题：

1. **OpenCode API Key 识别问题**：用户填写 API Key 后系统无法识别，导致提示"API Key 未填写"
2. **Codex 配置升级问题**：Codex CLI 0.134.0+ 不再支持旧版 `profile = "xxx"` 配置格式

---

## 问题一：OpenCode API Key 识别问题

### 问题描述

#### 现象
- 用户在 OpenCode 应用中填写了 API Key
- 点击启用供应商时仍提示"API Key 未填写"
- 影响所有 OpenCode 类型的供应商（如 gaccode、opencode 等）

#### 影响范围
- OpenCode 类型的所有供应商
- 用户无法启用已配置的 OpenCode 供应商

### 问题根因

**代码分析**：

问题位于 `src/components/providers/ProviderList.tsx` 文件（第235-291行）的 `needsApiKey` 函数：

```typescript
// 原有逻辑：缺少对 opencode 的处理
const needsApiKey = useCallback((provider: Provider) => {
  if (provider.category === "official") return false;
  if (provider.meta?.providerType) return false;
  
  // 处理 claude, codex, gemini, openclaw, hermes
  // ... 但没有处理 opencode
  return false;
}, [appId, codexEnvKeys]);
```

**根本原因**：
- `needsApiKey` 函数只处理了 claude、codex、gemini、openclaw、hermes 五种应用类型
- 缺少对 `appId === "opencode"` 的处理分支
- OpenCode 的 API Key 存储在 `settingsConfig.options.apiKey` 字段下

### 修复方案

**修改文件**: `src/components/providers/ProviderList.tsx`（第294-303行）

```typescript
if (appId === "opencode") {
  return !(
    typeof (provider.settingsConfig as Record<string, unknown>)
      ?.options?.apiKey === "string" &&
    String(
      (provider.settingsConfig as Record<string, unknown>)?.options
        ?.apiKey ?? "",
    ).trim()
  );
}
```

**配套修改**: `src/utils/providerConfigUtils.ts`

三个工具函数都添加了对 opencode 的支持：
1. `getApiKeyFromConfig` - 读取 API Key
2. `hasApiKeyField` - 判断是否存在 API Key 字段
3. `setApiKeyInConfig` - 写入 API Key

---

## 问题二：Codex 配置升级问题

### 问题描述

#### 现象
- Codex CLI 升级到 0.134.0+ 后出现错误提示：
  ```
  无法解析功能覆盖优先级：不再支持旧版 `profile = "codex"` 配置；请改用 `--profile codex` 并配合 `codex.config.toml` 文件。
  ```
- 用户无法正常使用 Codex 应用

#### 影响范围
- 使用 Codex 0.134.0+ 的用户
- 包含旧版配置格式的供应商

### 问题根因

**代码分析**：

Codex CLI 0.134.0+ 引入了配置格式变更：
- **旧格式**：顶层 `profile = "xxx"` 字段
- **新格式**：使用 `model_provider = "xxx"` 字段，配合 `--profile` 命令行参数

原有代码缺少对旧版 `profile` 字段的清理逻辑。

### 修复方案

**前端修改**: `src/components/providers/forms/hooks/useCodexConfigState.ts`（第27-29行）

```typescript
// Remove top-level profile = "xxx" field (deprecated in Codex 0.134.0+)
let result = configStr.replace(/^\s*profile\s*=\s*"[^"]+"\s*$/gm, "");
```

**后端修改**: `src-tauri/src/codex_config.rs`（第332-336行）

```rust
// For new format (0.134.0+), remove top-level profile = "xxx" field
if new_format {
    lines.retain(|l| !l.trim().startsWith("profile = \""));
}
```

---

## 架构变更分析

### 变更类型

| 变更类型 | 描述 | 影响范围 |
|---------|------|---------|
| **Bug Fix** | OpenCode API Key 识别 | 前端组件、工具函数 |
| **Bug Fix** | Codex 配置格式迁移 | 前端配置状态管理、后端配置处理 |
| **兼容性** | 自动迁移旧版配置 | 所有用户配置 |

### 代码改动清单

#### 前端代码

| 文件路径 | 修改内容 | 行数 |
|---------|---------|------|
| `src/components/providers/ProviderList.tsx` | 添加 opencode API Key 检查逻辑 | 第294-303行 |
| `src/utils/providerConfigUtils.ts` | 添加 opencode 支持到三个工具函数 | 第177、202、241行 |
| `src/components/providers/forms/hooks/useCodexConfigState.ts` | 添加旧版 profile 字段清理 | 第27-29行 |

#### 后端代码

| 文件路径 | 修改内容 | 行数 |
|---------|---------|------|
| `src-tauri/src/codex_config.rs` | 添加 profile 字段清理逻辑 | 第332-336行 |

---

## 影响分析

### 正向影响

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| OpenCode 供应商启用 | ❌ 提示 API Key 未填写 | ✅ 正常识别 API Key |
| Codex 0.134.0+ 配置 | ❌ 报错"不再支持旧版配置" | ✅ 自动迁移配置格式 |
| 预设供应商 | ✅ 正常工作 | ✅ 保持不变 |
| 自定义供应商 | ✅ 正常工作 | ✅ 保持不变 |

### 向后兼容性

- ✅ **完全向后兼容**：原有配置和数据不受影响
- ✅ **自动迁移**：旧版配置会被自动转换为新格式
- ✅ **无破坏性变更**：不需要修改任何配置文件

### 潜在风险

| 风险项 | 风险等级 | 说明 |
|--------|----------|------|
| 配置迁移失败 | 低 | 迁移逻辑已覆盖主要场景 |
| API Key 丢失 | 低 | 读取和写入逻辑一致 |
| UI 行为变化 | 低 | OpenCode 供应商现在能正确启用 |

---

## 验证方法

### 测试步骤（OpenCode API Key）

1. **启动应用**：运行 `pnpm tauri dev`
2. **添加 OpenCode 供应商**：选择 OpenCode 类型（如 gaccode）
3. **填写 API Key**：在配置表单中输入 API Key
4. **尝试启用**：点击启用按钮应成功，不再提示"API Key 未填写"

### 测试步骤（Codex 配置升级）

1. **准备测试环境**：安装 Codex CLI 0.134.0+
2. **添加旧版配置**：手动创建包含 `profile = "codex"` 的配置
3. **导入配置**：通过应用导入或修改配置
4. **验证迁移**：配置应自动清理 `profile` 字段，使用新格式

### 预期结果

- OpenCode 供应商可以正常启用
- Codex 配置自动迁移到新格式
- 无错误提示

---

## 代码变更对比

### OpenCode API Key 修复

**修改前**：
```typescript
// needsApiKey 函数缺少 opencode 处理
return false;
```

**修改后**：
```typescript
if (appId === "opencode") {
  return !(
    typeof provider.settingsConfig?.options?.apiKey === "string" &&
    String(provider.settingsConfig?.options?.apiKey ?? "").trim()
  );
}
```

### Codex 配置迁移修复

**修改前**：
```typescript
// 直接使用原始配置字符串
let configStr = (config as any).config || "";
```

**修改后**：
```typescript
// 先清理旧版 profile 字段
let result = configStr.replace(/^\s*profile\s*=\s*"[^"]+"\s*$/gm, "");
```

---

## PR 描述模板

### 标题

fix: 修复 OpenCode API Key 识别和 Codex 配置升级问题

### 描述

**问题修复**：

1. **OpenCode API Key 识别问题**
   - 修复了 `needsApiKey` 函数缺少对 opencode 应用的处理
   - 更新了 `providerConfigUtils.ts` 中的三个工具函数以支持 opencode
   - 用户现在可以正常启用 OpenCode 类型的供应商

2. **Codex 配置升级问题**
   - 修复了 Codex CLI 0.134.0+ 不再支持旧版 `profile = "xxx"` 配置的问题
   - 添加了自动迁移逻辑，在配置读取和写入时自动清理旧版字段
   - 兼容新旧版本的 Codex CLI

**修改文件**：

- `src/components/providers/ProviderList.tsx` - 添加 opencode API Key 检查
- `src/utils/providerConfigUtils.ts` - 添加 opencode 支持
- `src/components/providers/forms/hooks/useCodexConfigState.ts` - 添加配置迁移逻辑
- `src-tauri/src/codex_config.rs` - 添加 profile 字段清理

**测试建议**：

1. 测试 OpenCode 供应商启用流程
2. 测试 Codex 配置导入和导出
3. 验证配置迁移的正确性

---

## 总结

### 修复效果

✅ **OpenCode API Key 问题**：已修复，用户可以正常启用供应商
✅ **Codex 配置升级问题**：已修复，自动迁移旧版配置
✅ **向后兼容性**：完全兼容现有配置和数据
✅ **无副作用**：不影响其他功能

### 经验教训

1. **全面性检查**：添加新应用类型时要确保所有相关代码路径都已更新
2. **版本兼容性**：第三方工具升级可能导致配置格式变更，需要及时适配
3. **防御性编程**：对未知配置格式应有合理的默认处理

---

**文档版本**: v1.0  
**创建日期**: 2026-05-31  
**修改文件**: 
- `src/components/providers/ProviderList.tsx`
- `src/utils/providerConfigUtils.ts`
- `src/components/providers/forms/hooks/useCodexConfigState.ts`
- `src-tauri/src/codex_config.rs`