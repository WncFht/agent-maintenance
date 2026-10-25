# Crossnote 从链接部署迁移到显式同步

## 变更

适用于变更前使用 `scripts/crossnote-links.sh` 或直接复制旧资源的项目。本包没有语义化发布版本，此指南对应当前未发布更新：运行文件由维护源构建，目标 `.crossnote` 使用带哈希清单的独立副本。源仓修改不再立即影响其他项目。

源修改入口移至 `assets/.crossnote/src/`。目标只部署运行资源与伪代码检查器，不再携带生成器；维护仓的 `build-parser.cjs` 兼容入口转交完整构建。旧的打包产物 CSS patch 工具退出使用。浏览器增强改由受信任的 `head.html` 加载 `preview.js`，要求 MPE 0.8.40／Crossnote 0.9.42 或兼容宿主；解析器不再插入 Markdown `@import`。正文样式与图表隔离，五类 Mermaid 默认跟随文档颜色；需要固定作者主题的图使用 `{.native}`。

## 迁移

1. 在维护仓安装依赖、构建并测试：

    ```sh
    npm ci
    npm run build:preview
    npm run test:preview
    ```

2. 检查目标部署：

    ```sh
    node assets/.crossnote/scripts/sync.cjs --target /absolute/project --check
    ```

    新项目、旧版本或尚未建立清单时会非零退出并列出差异。出现 `local changes` 时，先备份并审阅定制；保留定制可暂不迁移，采用新主题可将修改合入维护源并重建，再移走冲突副本。不要删除未审阅的定制来强行通过检查。

3. 执行同步并复查：

    ```sh
    node assets/.crossnote/scripts/sync.cjs --target /absolute/project
    node assets/.crossnote/scripts/sync.cjs --target /absolute/project --check
    ```

    已知旧版副本、标准占位文件、指向同一维护源的文件／目录链接可以迁移。受管文件变成独立副本，额外未知文件保留。指向其他来源的目录链接及整个 `.crossnote` 目录链接需先审阅并物化，不会自动接管。

4. 目标仓继续忽略 `.crossnote/`。将调用目标内 `build-parser.cjs` 的 hook 改为维护仓的构建检查或上述部署检查；`node .crossnote/scripts/check-pseudocode.cjs --staged` 保持可用。复制到项目的旧 shell 入口可更新为本仓新版本，`CROSSNOTE_SRC` 仍有效。

5. 检查全局 Crossnote 样式。默认只在项目层启用完整主题；若全局已有同一主题，先备份再按实际使用范围调整，防止双层样式叠加。同步工具不会修改全局配置，也不会替换其他 MPE 扩展文件。

6. 在 VS Code 用户设置启用 `markdown-preview-enhanced.enablePreviewScripts`，并信任工作区；工作区设置该 application 选项无效。保持 `previewTheme: none.css` 和 `previewColorScheme: systemColorScheme`，重新打开预览，验证主题、原生配色退出、图表操作和打印。

普通同步错误会回滚并释放锁。强制终止或回滚失败时，保留报告的 `.crossnote-sync-*` 备份；确认无活动同步进程后移走 `.crossnote-sync.lock`，再执行检查／同步。不能把部分复制当作成功，也不能直接丢弃恢复材料。
