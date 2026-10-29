# 维护文档入口

本包为目标项目提供文档归属、决策记录、实验报告和验证接入方法。先按任务选择入口，再读取所需的技能与参考；不要求一次加载全部规则。

| 需要完成的工作                   | 入口                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| 采用维护包、选择能力和运行检查   | [根 README](../README.md)                                   |
| 组织文档、从需求交付到当前说明   | [开发工作流](workflow.md)                                   |
| 接入 formatter、hooks、CI 和预览 | [工具链](toolchain.md)                                      |
| 使用主题、图表查看器和独立导出   | [Crossnote 资源说明](../assets/.crossnote/README.md)        |
| 验证预览资源、宿主与输入设备     | [Crossnote 验证](../assets/.crossnote/tests/README.md)      |
| 理解暂存快照、检查依赖与归档保护 | [检查流程](pipeline.md)                                     |
| 维护实验记录与证据               | [实验报告规则](../.agents/references/experiment-reports.md) |
| 查询篇幅和链接检查的保证         | [篇幅与检查边界](../.agents/references/document-budgets.md) |
| 核对规则与资源来源               | [来源与取舍](../来源与取舍.md)                              |

预览资源的链接式部署迁移见 [Crossnote 升级指南](upgrade-guide/unreleased/crossnote/guide.md)。

仓库中的参考文档描述当前行为，Agent Notes 保存长期取舍。工作区调研、实验原型、截图与逐轮验收记录在仓外整理，部署和检查不依赖这些材料。

已有模板引用的调整见[写作辅助迁移](upgrade-guide/unreleased/writing/guide.md)。
