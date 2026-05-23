# Bug 修复总结

## 修复清单

### 1. 供应商充值/查询链接显示问题

**问题描述**：
- 系统中原有的预设供应商（如"兔子线路"、"codex订阅"、"gaccode"）显示正常，包含完整的"充值"和"查询"功能链接
- 用户通过系统功能添加新的供应商后，新供应商条目缺少"充值"和"查询"功能链接

**问题根因**：
`ProviderCard.tsx` 中使用硬编码的供应商ID列表来决定是否显示充值/查询链接。新添加的供应商ID不在预设列表中，导致不显示链接。

**修复方案**：
- 添加默认链接配置（兔子线路的充值和查询链接）
- 修改链接匹配逻辑，当供应商不在预设列表时使用默认链接
- 修改渲染逻辑，所有供应商都显示充值和查询链接

**影响范围**：
- ✅ 新添加供应商：现在会正确显示"充值"和"查询"链接
- ✅ 原有预设供应商：保持原有行为不变
- ✅ 完全向后兼容，无破坏性变更

---

### 2. GitHub Actions 构建认证问题

**问题描述**：
GitHub Actions 构建失败，错误信息：
```
could not read Username for 'https://github.com': terminal prompts disabled
```

**问题根因**：
默认的 `GITHUB_TOKEN` 权限不足，无法完成创建 release 的操作。需要使用带有 `repo` 权限的 Personal Access Token (PAT)。

**修复方案**：
- 将 workflow 文件中的 `GITHUB_TOKEN` 替换为自定义的 `TUZI_SWITCH_TOKEN`
- 需要仓库维护者在仓库 Secrets 中配置 `TUZI_SWITCH_TOKEN`

**影响范围**：
- ✅ 需要维护者配置 PAT token 才能触发完整的 release 构建
- ✅ 配置后，所有构建将正常进行

---

## 代码变更总结

### 修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/components/providers/ProviderCard.tsx` | 添加默认链接配置，修复供应商充值/查询链接显示问题 |
| `.github/workflows/build.yml` | 使用自定义 PAT token 解决认证问题 |

### 技术细节

#### ProviderCard.tsx 修改

**修改前**：
```typescript
const links = linkMap[appId]?.[provider.id];
if (links) {
  // 只对预设供应商显示充值/查询链接
}
// 自定义供应商不显示链接
```

**修改后**：
```typescript
const defaultLinks = {
  recharge: "https://api.tu-zi.com/console/topup",
  query: "https://check.sydney-ai.com/",
};
const links = linkMap[appId]?.[provider.id] || defaultLinks;
// 所有供应商都显示充值/查询链接
```

#### build.yml 修改

**修改前**：
```yaml
GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**修改后**：
```yaml
GITHUB_TOKEN: ${{ secrets.TUZI_SWITCH_TOKEN }}
```

---

## PR 信息

### 提交标题
```
fix: 修复新添加供应商缺少充值/查询链接 + 修复 GitHub Actions 构建认证问题
```

### 提交描述

```markdown
## 修复内容

1. **供应商充值/查询链接显示问题**
   - 修复新添加供应商缺少"充值"和"查询"功能链接的问题
   - 所有供应商现在都会显示充值和查询链接
   - 完全向后兼容，不影响原有预设供应商

2. **GitHub Actions 构建认证问题**
   - 解决默认 GITHUB_TOKEN 权限不足导致的构建失败
   - 使用自定义 TUZI_SWITCH_TOKEN 进行认证

## 问题根因

### 问题一：供应商链接显示
ProviderCard.tsx 中使用硬编码的供应商ID列表决定是否显示充值/查询链接，新供应商ID不在列表中导致不显示链接。

### 问题二：构建认证
默认 GITHUB_TOKEN 没有足够的权限创建 release，需要使用带有 repo 权限的 PAT。

## 修改内容

### 1. src/components/providers/ProviderCard.tsx
- 添加默认链接配置（兔子线路链接）
- 修改链接匹配逻辑，支持所有供应商显示充值/查询链接
- 修改渲染逻辑，根据条件显示 API Key 掩码或地址

### 2. .github/workflows/build.yml
- 将 GITHUB_TOKEN 替换为 TUZI_SWITCH_TOKEN
- 需要仓库维护者配置 PAT token

## 影响范围

- ✅ 新添加供应商：现在会正确显示"充值"和"查询"链接
- ✅ 原有预设供应商：保持原有行为不变
- ✅ 完全向后兼容，无破坏性变更
- ⚠️ 需要维护者在仓库 Secrets 中配置 TUZI_SWITCH_TOKEN

## 测试验证

- ✅ 本地构建成功（Windows）
- ✅ 前端代码无错误
- ✅ Rust 编译成功
- ⏳ GitHub Actions 自动构建（需配置 PAT token）
```

---

## 配置说明（维护者需要执行）

### 添加 TUZI_SWITCH_TOKEN Secret

1. 登录 GitHub → 进入仓库 → **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**
3. **Name**: `TUZI_SWITCH_TOKEN`
4. **Value**: 粘贴带有 `repo` 和 `workflow` 权限的 Personal Access Token
5. 点击 **Add secret**

### 创建 PAT Token 步骤

1. GitHub → 右上角头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. 点击 **Generate new token**
3. 设置：
   - **Note**: `TUZI_SWITCH_TOKEN`
   - **Expiration**: 选择合适有效期
   - **Scopes**: 勾选 `repo` 和 `workflow`
4. 点击 **Generate token**
5. 复制 token 并添加到仓库 Secrets

---

**文档版本**: v2.0
**创建日期**: 2026-05-23
**修改日期**: 2026-05-23
**修改文件**:
- `src/components/providers/ProviderCard.tsx`
- `.github/workflows/build.yml`
- `docs/bugfix-provider-recharge-links.md`