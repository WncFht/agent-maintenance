# 维护流程与验证边界

## 执行位置

| 位置                   | 检查                                             | 输入                                                |
| ---------------------- | ------------------------------------------------ | --------------------------------------------------- |
| pre-commit             | 格式、lint、secrets、链接、技能、Notes、归档保护 | formatter 操作暂存内容；契约检查使用完整 index 快照 |
| pre-push               | checks.json 的 ci 模式                           | 当前工作区与本地 HEAD 历史                          |
| GitHub checks          | Python 3.10/3.13、格式、文档、行为测试与 secrets | checkout 内容，历史来自事件 base/before             |
| GitHub archive-history | 目标分支版本的归档检查器                         | PR 内容与 PR base SHA                               |

本仓规模小，pre-push 运行完整维护检查。迁移到大项目时由实际变更选择局部证据，CI 保留完整验证。

setup 安装两阶段入口：先在 pre-commit 框架外直接执行 git-format-staged，再让框架保护未暂存差异并检查。格式化冲突报告 warning 并保留工作区原文；不得在框架隐藏改动期间改写 index。staged_checks 通过 checkout-index 导出隔离快照，对照 HEAD 验证归档；不修改工作区。接入和恢复见[工具链指南](toolchain.md)。

## 调度语义

命令为参数数组，不经 shell。needs 要求依赖成功；失败时后代 skipped，阻断项 skipped 仍使整组失败。allow_failure 保留失败状态，不能让后代把它当成功。mode 选择检查及依赖，不判断变更覆盖。

调度器限制同时运行的直接子进程数量和每项时间，保留耗时及输出尾部。没有 after、fail-fast、进程树监督或变更影响分析；后台进程由所属测试框架负责退出和清理。

## 文档检查

check_docs 用 Markdown 解析器读取内联、引用式链接和图片，检查本地目标存在且不越出仓库，遍历隐藏规则目录。跳过环境、依赖和冻结归档。它核对三个技能的 frontmatter 和界面元数据，同时检查 Markdown 标题锚点、显式 HTML id/name 以及 HTML 中的 href/src。本地目录片段解析 README；非 Markdown 产物片段、外部网站、示例行为与自然语言正确性不在范围内。

冻结历史退出格式化和文字检查。空 Notes 树允许作为新项目起点，但目录缺失会失败。

## 冻结保护

先审阅记录价值、移动差异与入链；notes_guard 的 --seal 只为新项追加哈希。常规检查核对当前正文与清单，可信历史检查对照基线记录。

PR 中，checks 使用事件 base；archive-history 另从目标分支读取 notes_guard 与 check_archive，再验证待审内容。修改 PR 内检查器不能解除这项正文保护。workflow 和 required checks 仍由托管平台权限控制，需在目标托管平台核验是否生效。

首次 push 的 before 全零时，以仓库根提交作为初始化基线并检查当前结构，不把零值传给 Git。PR 目标分支须已包含检查器；迁移到已有项目时先落地工具链基线，再使用冻结机制。

## 测试与维护

测试在隔离目录和 Git 仓库中构造违规输入，验证格式拒绝、归档改写、依赖失败、观察项、超时与环。新检查器应有违规返回非零的反例。规则来源与边界见[来源与取舍](../来源与取舍.md)。

## 篇幅与内容归属

同一 docs 检查读取 `scripts/doc-policy.json`，硬上限失败，软预算只提示；暂存检查读取 index 导出后的清单与正文。计数与边界见[篇幅规则](../.agents/references/document-budgets.md)。内容流转见[开发工作流](workflow.md)，不实现重复检测。

## 推送环境隔离

Git 的 pre-push 环境可能绑定调用仓库的 GIT_DIR、GIT_INDEX_FILE 等变量。受管推送入口在运行检查前移除 `git rev-parse --local-env-vars` 列出的绑定，使检查中的临时仓库独立解析自己的 Git 状态；失败仍阻断推送。pre-commit 保留调用者 index，因为它就是待验证的提交内容。安装更新后的入口需重新运行 setup。
