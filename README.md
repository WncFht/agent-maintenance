# 通用 Agent 开发维护体系

从 DeepSeek Harness 提取并中文化的维护规则与工具，可按需采用到其他项目；来源、许可与取舍见[提取说明](来源与取舍.md)和 [LICENSE](LICENSE)。

## 三个技能入口

| 技能                                                                       | 用途                                   |
| -------------------------------------------------------------------------- | -------------------------------------- |
| [maintain-docs](.agents/skills/maintain-docs/SKILL.md)                     | 文档归位、事实核验、实现同步和迁移说明 |
| [maintain-prose](.agents/skills/maintain-prose/SKILL.md)                   | 文字与注释的完整语义、会话残留清理     |
| [maintain-decision-notes](.agents/skills/maintain-decision-notes/SKILL.md) | 决策记录、取代、合并和冻结历史         |

共享参考保留文档、文字与决策维护方法。[工具链指南](docs/toolchain.md)提供 format、lint、暂存门控、CI 和可选 MPE 的采用方法，替代独立 setup-toolchain skill。通用代码审阅和产品测试策略不在本包范围内。来源和许可见[来源与取舍](来源与取舍.md)。

`AGENTS.md` 与 `.agents/` 为规则事实源。docs、scripts、.github 与 Notes 的分层入口表达不同区域的职责；不预设产品源码或基准目录。采用时只选择目标项目存在的区域，并修复相对链接。

## 本地准备

需要 Python 3.10+、Node 22+ 和 Git。Python 直接依赖钉在 `requirements-dev.txt`，传递依赖与哈希归 `requirements-dev.lock`，npm 工具归 `package.json` 与锁文件。系统工具使用已有包管理器；本机有 Homebrew 时执行：

```sh
brew install autocorrect gitleaks taplo actionlint shfmt shellcheck zsh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements-dev.lock
npm ci
python scripts/setup.py
```

setup 只安装本仓 pre-commit/pre-push hooks 与被忽略的 `.claude/skills` 软链；已有自定义 hooksPath 或外来技能目录时拒绝覆盖。不会安装全局技能。后续终端先激活 `.venv`。

## 检查入口

```sh
python scripts/run_checks.py --config scripts/checks.json --mode docs
python scripts/run_checks.py --config scripts/checks.json --mode test
python scripts/run_checks.py --config scripts/checks.json --mode ci
```

docs 检查本地文件链接、技能结构、Notes 格式和归档历史；test 运行行为测试；ci 增加格式、lint、中文间距和 YAML 注释检查。直接运行历史检查默认以本地 HEAD 为基线；CI 从 PR base 或 push before 获取基线。详细执行关系见[维护流程](docs/pipeline.md)。

格式整理使用 `npm run format`、`ruff format .`、`taplo fmt` 与 `python scripts/check_spacing.py --fix`，最后一项只修 Markdown。检查覆盖代码注释和字符串，排除冻结历史与可选预览载荷。setup 安装两阶段入口，先直接格式化 index，再由 pre-commit 检查。契约检查使用 index 快照；部分暂存与冲突处理见[工具链指南](docs/toolchain.md)。

## 在其他项目采用

给 agent 的迁移 prompt（替换两个路径）：

```text
参考 <维护包路径>，把适用的 skills、共享参考、模板、Agent Notes 规则、分层 AGENTS.md、hooks 和 CI 配置到 <目标仓库路径>。先读目标现状，合并并复用已有工具链，不覆盖现有规则，不复制本包的过程记录。按目标目录、技能集合和真实检查命令适配，保留来源与许可，修复引用，验证正常与违规输入。仅配置必要 CI，不新增自动发布；完成后说明改动与未验证项。
```

先核对目标项目已有规则与工具链，按需复制三个技能及其引用的 references、templates 和 notes 规则；不能只复制单个 SKILL.md。保留许可和来源，按真实目录调整入口。

已有 hooks、CI、formatter 和调度器优先复用。`scripts/checks.json` 是本包的检查集合，迁移时逐项核对；`check_docs.py` 中的三技能集合是本仓约束，其他项目应明确自己的集合。产品测试、类型、真实构建与生成器检查需接入目标项目，不能用本包检查代替。

本仓提供检查工作流，不提供部署或发布流程；远端执行与 required checks 需在目标托管平台单独核验。
