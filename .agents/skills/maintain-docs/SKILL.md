---
name: maintain-docs
description: 编写、重组或审计 README、教程、参考文档与实验报告时使用；核对读者、事实归属、操作证据和生成来源。
---

# 维护文档

创建或迁移页面先按[文档布局与交付流程](../../references/document-lifecycle.md)定位现有拥有者；新运行、新 seed、新会话不单独生成长期文档。

先读目标路径的 AGENTS.md、当前页面、所属源码、测试及导航；不要把已有说明视为已验证。按[文档分工](../../references/documentation.md)确定读者、页面主要任务、位置与详细程度。包契约靠近包，跨模块学习和指南进入 docs，决策理由进入 notes。

写清读者起点、可观察结果、常见失败、恢复方法和下一层入口。先介绍可做什么、何时选择及成本，再解释实现；实现部分解释关系，不抄类型和目录全集。教程按前提推进，参考按查询组织；大量混合内容拆开。按实际任务选用[模块 README](../../templates/module-readme.md)、[教程](../../templates/tutorial.md)、[参考](../../templates/reference.md)或[事故报告](../../templates/postmortem.md)骨架，不为填模板编造内容。

按文中最终写法执行命令与配置。字段、默认值、失败和平台差异从当前实现、测试或运行结果核对；缺环境时明确未验证内容，不从记忆或邻包类推。先确认对象究竟是可安装应用、插件、库还是组合配置，再给对应操作。

来源先改，生成器和派生内容随后更新。移动时修复入链。对外不兼容变化按[升级指南](../../references/upgrade-guides.md)编写迁移路径。清理重复规则、手写清单、当前文档中的历史叙述和实施记录中的计划；不得为减少字数删除失败、限制、资源归属和必要例子。

研究项目按需读取[实验报告维护](../../references/experiment-reports.md)：一篇围绕一个问题，关键实验按背景、设置、结果三部分展开；支撑验证保留独立证据并回链，CPU/GPU 不决定主次。

交付前把当前接口、设计理由、研究结果和执行流水分配到各自位置；先迁入独有内容，再缩减旧处并修复导航和锚点。按[篇幅规则](../../references/document-budgets.md)处理硬超限与软提示，不做重复检测或按比例删字。

按 [maintain-prose](../maintain-prose/SKILL.md) 做句级审阅，再执行目标已有文档检查、示例验证和 diff 检查。需要长期理由时使用 [maintain-decision-notes](../maintain-decision-notes/SKILL.md)。报告实际范围、未核验断言和运行过的命令。
