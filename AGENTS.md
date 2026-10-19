# AGENTS.md

本仓通过维护技能、开发工具链和可选预览资源改善 Agent 开发体验，以较低维护成本减少仓库中的冗余、失真和缺少验证的内容。说明当前用途与使用方法；来源归属和必要决策理由分别放在来源说明与 Notes，已完成的操作步骤不进入使用文档。

先读本仓架构、开发与测试入口，再修改对应区域。子目录指令只补充其作用范围；不复制父层规则。指令加载取决于工具，进入未加载的目录前显式读取其入口。

## 开发与验证

- 先确认任务是解释、审阅、诊断还是实施；按用户授权的范围工作。
- 每项抽象、配置、状态与兼容路径都应有当前需求或明确消费者。追踪动态配置、生成内容和仓外扩展后再判断可删。
- 行为变化与 README、接口注释、生成来源和当前决策记录在同一变更同步。来源先改，派生物重新生成。
- 验证真实外部结果，不以组件或 agent 的成功自述作证明。测试、类型检查与发布产物分别覆盖其实际路径。
- 根据改动运行相关检查，维护工具变更须有正常输入与违规反例；完整入口见 README。
- 写作遵循 [maintain-prose](.agents/skills/maintain-prose/SKILL.md)；长期决策遵循 [Agent Notes](.agents/notes/README.md)。局部机械修改不强制创建决策记录。
- 外部可见不兼容变更同步写[升级指南](.agents/references/upgrade-guides.md)。历史持久化数据和已发布格式遵守本仓兼容性约定。
- 失败后明确状态、清理和报告的责任；捕获异常不意味着已恢复。资源清理停止新工作，等待已有工作结束，再释放依赖。

## 入口

[文档](docs/AGENTS.md)、[脚本](scripts/AGENTS.md)、[CI](.github/AGENTS.md)、[维护方法](.agents/references/automation.md)。

本仓的使用与验证入口见 [README](README.md)，检查执行边界见[维护流程](docs/pipeline.md)，内容归属与交付见[开发工作流](docs/workflow.md)。向其他项目迁移时保留真实存在的目录入口，复用已有检查；本仓检查不代表目标产品已验证。

format、lint、hooks、CI 和可选 MPE 的接入从[工具链指南](docs/toolchain.md)进入。setup 安装两阶段 hook，暂存格式化在框架隐藏未暂存改动之前运行；不要用普通 pre-commit install 覆盖该入口。

`AGENTS.md` 与 `.agents/` 是入库事实源，`.claude/skills` 由 `python3 scripts/setup.py` 创建并忽略。日常检查使用 `python3 scripts/run_checks.py --config scripts/checks.json --mode ci`；提交前 hook 验证暂存快照，不把工作区未暂存内容当作提交证据。
