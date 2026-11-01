# DL-FORK-01 测试库下载页构建

2026-11-01 用户确认当前橙白下载页设计，并授权推送 AiW520/tuzi-switch 测试库构建；本轮不推送 tuziapi/tuzi-api、上游客户端或部署正式网站。

## 实现

- 从已验收客户端 `533bc6e134cfcc07a7de68cc1c03ce559feeb16f` 建立独立 `codex/test-download-site` 分支；不覆盖原 gaizhao 工作区已有未提交修改。
- `download-site/` 保存确认后的独立 HTML 和脚本，保留原页面归属及许可；应用主代码、版本、账户契约均不变。
- `scripts/build-download-site.cjs` 从指定的同一 Actions run 获取四个平台 ZIP 的 artifact ID；必须匹配仓库、源码 SHA、平台名称、有效状态，不混用其他提交，不在缺失时静默回到正式包。
- 页面支持 Apple Silicon / Intel Mac、Windows、Linux 四组 ZIP，覆盖原有七个实际安装文件。Windows ZIP 含 exe/msi，Linux ZIP 含 AppImage/deb/rpm；下载需要 GitHub 登录，30 天有效。测试版本、源码、构建入口及签名状态明确显示。
- 统计站点 `853b4529-0976-4f8a-b00b-6e716f9a2f20`，`switch_download_click` 仅包含 platform/version；支持中键，统计失败不阻止下载。`version` 带 test 和短 SHA，区分正式发行。
- Acceptance installers 流水线在四个平台安装包成功上传后，构建并上传独立的 `tuzi-assistant-download-page-<SHA>`，其中 index.html 可解压直接打开，另含 build.json 和 SHA256SUMS.txt。无需生产 API、用户凭证或网站后端。

## 验证

- Node 内置回归 5 项：同一构建正确映射、失败/进行中/源码不匹配拒绝、当前流水线显式允许进行中、缺失/过期/重复/跨源码产物拒绝、正式仓库和非法版本拒绝。
- 使用上一轮已成功的真实测试构建 `41271700895` 和 SHA `533bc6e1` 本地生成；浏览器验证 file:// 直接打开、四个精确下载地址、320/390/768/1440 宽度无溢出、五次左键/中键事件、安装说明展开和坏元数据移除链接。无 pageerror，测试统计请求全部拦截，不写生产埋点。
- 本轮客户端代码未变，本地不重复桌面全量构建；推送后的既有流水线会重新完成前端、原生回归及四平台打包，再生成同 SHA 下载页。远程构建结果以 Actions 为准。

## 边界

本轮只交付测试仓库 Actions 产物，不新建正式 Release、不配置自动更新、不修改正式网站或 Pages。下载页源代码和 CI 改动可以单独 revert；旧测试产物保留到原过期时间。此前 API 整包图片请求磁盘预算基线失败不属于此独立静态页面构建，未通过复制整个 API 仓库绕过该问题。
