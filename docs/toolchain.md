# 工具链采用与维护

本指南面向已有 Git 仓库的维护者。agent-maintenance 提供检查实现、配置模板与采用方法，把重复的格式和静态检查交给工具，减少 Agent 与维护者逐项核对的成本。项目保留自己的 Make、构建工具、依赖管理和产品测试。

## 工具职责与扫描范围

| 内容              | 格式化                         | 检查                                 |
| ----------------- | ------------------------------ | ------------------------------------ |
| Markdown          | Prettier、AutoCorrect 正文整理 | Markdownlint、AutoCorrect、文档契约  |
| Python            | Ruff format                    | Ruff check、AutoCorrect 注释与字符串 |
| YAML、JSON、JSONC | Prettier                       | AutoCorrect、YAML 注释显示宽度       |
| TOML              | Taplo                          | Taplo check、AutoCorrect             |
| sh、bash          | shfmt                          | ShellCheck、AutoCorrect              |
| zsh               | 保留原文                       | zsh -n、AutoCorrect                  |
| GitHub Actions    | Prettier                       | actionlint                           |
| 凭据              | 无                             | gitleaks                             |

AutoCorrect 的语言解析器能选择注释和字符串，但不能判断节点标识、正则、协议或测试输入的语义。代码默认只检查；`python scripts/check_spacing.py --fix` 只修 Markdown，显式要求修代码会失败。审阅诊断后修正文案，对逐字保留的输入使用带理由的局部 disable/enable。Markdown 代码块保留原文。

扫描使用 Git 跟踪文件与未忽略新文件清单，包括隐藏、空格和中文路径，排除已删除文件、软链、冻结历史与第三方载荷。空扫描失败，显式缺失或不支持的输入失败。采用时核对 `python scripts/check_spacing.py --list`；无扩展名脚本按 shebang 识别，CLI 显式传入语法；编辑器在 .autocorrectrc 配置文件名关联。

AutoCorrect 2.16.3 的 JSON 输出有诊断时仍可能返回零，因此门控使用文本模式和 --strict。该版本可能将 YAML 中文流式列表的分隔逗号当成标点，优先改块列表并比较解析值。YAML 注释检查用语法扫描器排除多行标量，检查 80 显示列，断句位置仍由作者选择。

Ruff 规则按项目契约选择。本仓采用 ALL 与逐项豁免；目标可以从明确规则组开始。升级 ALL 须审阅新增规则，target-version 对齐最低 Python 版本；unsafe fixes 单独审阅。Prettier 等结构 formatter 不负责注释文字重排。

## 接入目标仓库

1. 读取目标 AGENTS、hooks、CI、依赖和生成来源。用 Git 清单普查文件类型、隐藏配置和 shebang，保护未提交工作。
2. 合并本仓根配置中的通用层：EditorConfig、Prettier、Markdownlint、AutoCorrect、忽略规则和 gitleaks 接入。保留目标已有缩进与依赖策略；本仓默认 4 空格，YAML/JSON 为 2 空格。
3. 按上表选择语言配置，参考本仓提交配置、fmt-markdown.sh、fmt-shell.sh 与检查脚本。复用目标的 Make 或构建入口；需要时才采用 scripts/checks.json，避免第二个调度器。
4. 先修存量违规，再启用门控。复制脚本时同步依赖、许可和来源提交；允许移入目标自己的包和 CLI，不建立全局 skill 运行时依赖。
5. 安装两阶段 hook，验证正常输入、违规输入和真实提交；配置解析与业务回归由目标项目执行。

本包已接线和测试的配方为上表所列类型。Go、Rust、JVM、PHP、Dart、C/C++ 和 PowerShell 暂无验收配方，须采用官方工具并补反例后再声明支持。

npm 工具使用精确版本与 package-lock，安装用 npm ci；Python 使用目标的锁文件，本仓直接依赖归 requirements-dev.txt，跨平台哈希锁归 requirements-dev.lock，安装使用 pip --require-hashes。系统工具由包管理器安装，安装后打印版本；同一安装来源不保证相同版本。已验证基线为 AutoCorrect 2.16.3、Ruff 0.17.0、Prettier 3.9.6、git-format-staged 4.0.2、Taplo 0.10.0、actionlint 1.7.12、shfmt 3.14.1、ShellCheck 0.11.0、gitleaks 8.30.1。

升级先修改依赖声明，用 `uv pip compile requirements-dev.txt --universal --python-version 3.10 --generate-hashes --output-file requirements-dev.lock` 更新 Python 锁，npm 更新后保留 package-lock；审阅规则变化，再重跑全部行为测试、两次格式化幂等和目标业务回归。系统工具升级同样复验并更新上述基线。

## 暂存格式化与恢复

`python scripts/setup.py` 安装两阶段 hook。第一阶段直接运行配置中 manual 阶段的本地 git-format-staged 条目，格式化 index 并尝试合并工作区；第二阶段执行 pre-commit 检查。manual 阶段专用于这些 formatter，其他命令放检查阶段。entry 使用参数数组，formatter 内的 shell 管道由脚本启用 pipefail。

安装时使用已装齐锁定依赖的项目 Python，例如 `.venv/bin/python scripts/setup.py`。commit 和 push hook 将该 Python 所在目录放到 PATH 最前，使检查及其子进程复用项目依赖，之后无需激活虚拟环境。虚拟环境删除或移动后须重建依赖并重装 hook；hook 安装器更新后也须重装，避免继续执行旧入口。

pre-commit 隐藏未暂存差异，并按原 index 恢复补丁。在此期间改写 index 会破坏恢复条件，因此格式化必须在框架外先执行。不要用普通 pre-commit install 覆盖两阶段入口；已有 hooksPath 或外来 hook 时安装拒绝覆盖，维护者需把两阶段顺序接入原入口。

git-format-staged 合并冲突会报告 warning，保留工作区原文，index 可能已格式化；审阅 git diff 和 git diff --cached 后处理。Markdownlint 原地修复后可能要求重新暂存。新仓先执行完整检查、建立初始化提交，再安装依赖 HEAD 的 formatter。

验收覆盖隐藏配置、无扩展名脚本、空扫描、管道上游失败、早期文件/批次失败、真实部分暂存、未暂存修复掩盖 index 错误、格式化冲突保留用户内容、两次格式化幂等以及配置解析和产品回归。行为测试在 scripts/tests/test_toolchain.py；目标应保留相关反例。

## 编辑器与 CI

参考 .vscode/settings.json：AutoCorrect 开诊断、关闭保存时自动改代码；Python 使用 Ruff，Markdown/YAML 使用项目 Prettier。扩展内置版本可能不同，以 CLI 完整检查验收，扩展升级后复验相同反例。

CI 调用项目已有完整入口，与本地复用叶子检查。workflow 文件不证明远端 required checks 已启用；部署、发布和远端权限按目标授权单独处理。

## 可选 MPE 预览

资源维护、生成与图表行为归 [assets/.crossnote](../assets/.crossnote/README.md)。安装锁定依赖后，从维护仓执行：

```sh
npm run build:preview
node assets/.crossnote/scripts/build.cjs --check
node assets/.crossnote/scripts/sync.cjs --target /absolute/project
node assets/.crossnote/scripts/sync.cjs --target /absolute/project --check
```

目标项目忽略根 `.crossnote/`。同步复制运行资源和伪代码检查器，记录文件哈希；不使用源文件链接，也不自动修改全局样式。已知旧副本和指向维护源的链接可迁移，本地定制会阻止写入。旧的 `scripts/crossnote-links.sh` 仍接受 `CROSSNOTE_SRC` 并转交同步工具；常规更新使用上述入口。迁移、冲突及恢复步骤见[升级指南](upgrade-guide/unreleased/crossnote/guide.md)。

浏览器增强使用 MPE 0.8.40／Crossnote 0.9.42 的受信任本地 head 脚本入口；工作区设 `previewTheme: none.css`、`previewColorScheme: systemColorScheme`。启用外观按钮与图表操作时，信任工作区，并在 **VS Code 用户设置**中设 `markdown-preview-enhanced.enablePreviewScripts: true`；该项是 application 作用域，工作区设置无效。无需开启执行任意代码块的 `enableScriptExecution`。同步后重新打开预览，让宿主加载新配置和脚本。

开发依赖锁定了 LESS、CSS 选择器解析器、Playwright、QuickJS、Crossnote 及两套 Mermaid 测试版本；目标工作区不需要这些 npm 包。无本机浏览器时运行 `npx playwright install chromium`，Linux CI 使用 `--with-deps`。运行 `npm run test:preview` 验证生成物、解析器、主题、图表、导出和部署；未运行的编辑器／输出链路须单独说明，不能由邻近测试替代。
