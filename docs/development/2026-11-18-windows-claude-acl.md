# WIN-CLAUDE-ACL-1118：Windows 准备环境权限失败

用户报告 Windows 11 / `OpenTu-Preview-1.6.3-beta.3-windows-x64.exe` 在 Claude Desktop 第二步“准备环境”出现 `Cannot secure private directory permissions`，并要求在当前 Mac 开发环境修复。按既有测试仓库验证授权，在独立分支 `codex/windows-claude-acl-1118` 修复和运行 Windows 合成测试；不发布正式版本。

## 范围与来源

- 发布包来源：`be5bd7bb2f61cdc289504837bbacc181a24b3d3a`。工作区从交付记录 `c62445db` 建立，未包含用户已取消的 WorkBuddy／兔子订阅／新工具集成任务。
- 影响范围：嵌入 `claude-local` 的 Windows 私有目录设置、错误诊断和对应专项回归。不读取用户 Key，不修改真实配置、系统证书或全局权限策略。
- Mac 负责源码修改及 Unix 回归；测试库 Windows x64 与 Windows 11 ARM runner 负责实际 ACL 验证。Windows 11 ARM 上的结果不冒充用户 Windows 11 x64 安装包整体验收。

## 复现与原因

云端 `44250713075` 使用发布版本原始脚本，在两个系统分别建立临时普通用户与管理员上下文。普通用户首次创建目录成功，但对同一目录再次执行时 `Set-Acl` 返回：

> The process does not possess the 'SeSecurityPrivilege' privilege which is required for this operation.

管理员上下文通过。这解释了只运行管理员构建／脚本测试为什么未覆盖问题。`install_assets` 本身会先准备根目录，再为各资源准备父目录；即使用户只点击一次，也会重复调用私有目录函数。原实现将 stderr 丢弃，界面只能显示统一报错。

这是对发布源码的真实 Windows 复现；用户机器的底层日志尚未采集，不声称已经远程读取其机器或排除了全部环境问题。

## 修复

1. 使用 .NET `Directory.SetAccessControl` 只持久化修改过的 DACL／必要的所有者字段，不触及审计 SACL，避免不必要的 `SeSecurityPrivilege`。
2. 已有所有者就是当前用户时，不重复写入所有者。这使只有继承 Modify 权限的新目录也能由所有者通过隐式 WRITE_DAC 完成保护，不额外索取 WRITE_OWNER。
3. 保持当前用户与 SYSTEM 的完整访问、禁止权限继承；检查两个必要主体、具体权限及对子项的继承标志。符号链接／reparse point 继续拒绝。
4. 失败保留固定阶段、HRESULT 与异常类型；Rust 仅接受白名单格式和有界输出，不反射目录路径、账户名或配置内容。子进程继续使用 15 秒超时，失败不降级开放权限。
5. Windows 测试直接运行生产脚本及调用实际 Rust `private_dir` 的探针，不用模拟 ACL 替代系统调用。

没有采用“默认管理员运行”或关闭权限保护：前者掩盖普通用户缺陷，后者使私有数据目录失去原有保护；本次保持原功能范围与权限要求。

## 验证状态

- Mac 核心 63 项测试通过，包括新增重复准备／文件保留、拒绝符号链接和错误脱敏测试。使用发布 Cargo.lock 的依赖版本，未修改依赖。
- 初轮测试工具未可靠获取普通用户进程退出码，已修复并重新执行，不将其记为产品复现结果。
- `44250713075`：发布原脚本真实复现普通用户重复调用失败。
- `44251405340`：第一版修复 x64 通过，Windows 11 ARM 暴露重复写所有者的问题；已补充“所有者正确则不写入”。
- `44251600752`：Rust 原生探针构建与执行；错误测试被 PowerShell 的额外包装文本干扰，已改为直接采集子进程原始输出。
- 最终 `44251974977` / `5a314033dc7ecf207eb3e08ddd5ddfb598a8f123`：Windows x64 与 Windows 11 ARM 两个任务均成功。两个平台均编译实际核心、运行两项 Rust 定向测试、构建并执行原生探针。
- 合计 30 个修复后场景通过（两个系统各普通用户 8 项、管理员 7 项）：新目录、中文／特殊字符目录、连续三次同目录准备、子文件私有权限继承、Rust 原生重复调用、拒绝 junction 并保持目标 ACL，以及普通用户无权修改目录时明确拒绝并返回不含路径的 HRESULT 诊断。
- 证据：[原脚本复现](attachments/windows-claude-acl-1118/baseline.json)、[最终 Windows 结果](attachments/windows-claude-acl-1118/final.json)。第一版失败与测试工具失败保留在云端历史，不计入通过项。
- 当前通过的是核心权限回归，不是安装包整体验收；没有执行系统证书授权、Claude 启动或真实模型调用。

## 交付边界

修复只进入测试库专用分支，不修改主分支、现有下载页或 beta.3 已发布附件。尚未构建或发布包含修复的新安装包，未在用户 Windows 机器安装验证；现有 beta.3 不会因分支修复自动改变。
