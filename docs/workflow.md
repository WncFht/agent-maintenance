# 开发中的文档交付

开发变更同时影响代码、当前说明和验证证据。维护包用已有三个技能处理这些内容；任务计划和执行进展不自动成为长期文档。目录与引用规则由[文档布局与交付流程](../.agents/references/document-lifecycle.md)维护，本页是接入入口。

## 接入已有项目

1. 读取现有 README、AGENTS、文档入口、源码与测试目录。找出已有的事实拥有者和检查命令。
2. 在项目 `docs/AGENTS.md` 明确当前参考、研究、实验、决策和工作记录的实际位置；保留合理的既有布局。
3. 用 `docs/README.md` 按读者问题导航，链接直接拥有者。复制选用的 skill 及其全部引用，修复相对路径。
4. 按需采用实验主报告与支撑模板。现有报告先整理一个连贯主题，保留独有内容和证据后再处理旧文。
5. 调整本项目 `scripts/doc-policy.json`，只为常驻入口设置硬预算。运行现有 docs 检查与相关测试，检查暂存快照确实执行同样的规则。

## 每次开发

明确需求与完成条件，定位受影响的代码和文档。需要保存长期理由时使用 [maintain-decision-notes](../.agents/skills/maintain-decision-notes/SKILL.md)；局部修改可直接实施。行为变化同步当前说明，实验结果按[研究规则](../.agents/references/experiment-reports.md)进入所属问题。

交付前使用 [maintain-docs](../.agents/skills/maintain-docs/SKILL.md)检查内容归属与引用，用 [maintain-prose](../.agents/skills/maintain-prose/SKILL.md)检查完整语义。未验收事项保留未完成状态；运行日志不替代当前说明，机器检查不替代语义与科学审查。

工具具体怎样执行、失败怎样传播，见[检查流程](pipeline.md)。本页不增加新的构建器、实验执行器或发布权限。
