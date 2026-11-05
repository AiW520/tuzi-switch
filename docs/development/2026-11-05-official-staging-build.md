# OFFICIAL-REL-02：正式源码异仓暂存构建

2026-11-05 用户选择“复用源码和页面，重新构建正式包”。正式 main 已为 6bc275a1aa2916b573f5450a694927af2ef7b7fc / v1.5.5，但正式 Actions 两次因计费锁定未分配 runner。本分支仅让 AiW520/tuzi-switch 提供构建计算，不修改两个仓库 main，不发布版本或网页，不读取或复制任何签名私钥。

## 固定身份与边界

- 每个 job 从 tuziapi/tuzi-switch 检出固定的上述 SHA，并核对 HEAD；构建脚本来自正式源码。
- 客户端原生、renderer、更新 endpoint 及公钥均为正式渠道；应用 identifier 和数据目录不变。
- 本分支只手动触发，权限 contents:read，无发布 job、无 secret 引用。
- `--unsigned` 只延后产物签名，不更改运行时验签要求、公钥或更新地址。
- 产物仍必须完成正式私钥签名及签名验证。缺少签名时仅上传 `official-unsigned-staging-v1.5.5`，不生成 latest.json，不作为完整公开交付。
- Manifest 的 repository/commit 是正式源码身份；builderRepository/builderCommit 和 run 记录实际构建执行来源，updaterSigned/publicationReady 明确为 false。所有新增字段均由四平台同一段代码写入。
- 复用原有前端、创作、原生、隔离配置和 MCP 回归；七个安装文件仍经来源、版本和 SHA256 校验。
- 该临时执行分支的 workflow 不能合入正式 main 取代签名发布流程；后续正式发布使用原流程或另行验证的离线签名产物。

## 初始验证

- actionlint 1.7.7：通过。
- git diff --check：通过。
- 远程原生构建、正式签名、下载页部署和用户实机验收尚未完成，分别记录实际结果。

## 构建门禁修复

首次 run 41983402901 的 1,861 项创作回归出现一项裁剪初始化时序失败。正式 PR #56 修正测试等待，22 项定向及 1,861 项全量通过；已合入正式 main 6bc275a1。本执行分支更新固定源码 SHA 后重跑，不跳过门禁，业务实现保持原样。
