---
kind: upgrade-guide
description: 已采用维护包模板的项目需更新删除模板的引用，并同步 Notes 检查器。
---

# 写作辅助迁移

## 变更

本未发布变更删除 `.agents/templates/` 下的 `experiment-report.md`、`experiment-support.md`、`reference.md`、`proposed.md` 和 `implemented.md`。README、教程和事故辅助文件保留原路径，内容改为可选清单。Notes 不再强制正文标题和顺序，元数据与归档格式保持兼容。

## 迁移

同步选用的 skill 及其引用，将旧模板链接改到[实验记录规则](../../../../.agents/references/experiment-reports.md)、[决策记录规则](../../../../.agents/references/decision-notes.md)或[文档分工](../../../../.agents/references/documentation.md)。沿用已有文档内容，无需按新规则重排历史报告。

采用 Notes 检查的项目同步 `scripts/notes_guard.py` 及相关测试，运行目标项目的文档与 Notes 检查。旧正文结构仍可通过；冻结历史继续使用原哈希和可信基线，不能重新封存来改写历史。维护包已验证自由正文和原章节格式，目标项目的定制检查需自行核对。
