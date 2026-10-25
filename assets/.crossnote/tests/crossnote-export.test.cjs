"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const { Notebook } = require("crossnote");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");

test("Crossnote renders deployed hooks and preserves palette opt-out in offline HTML/PDF", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "xnote-host-"));
    let browser;
    try {
        execFileSync(process.execPath, [
            path.join(ROOT, "scripts/sync.cjs"),
            "--target",
            project,
        ]);
        const markdown =
            "# Integration\n\n```mermaid\nflowchart LR\n A[中文输入] --> B[处理]\n```\n\n```mermaid {.native}\nflowchart LR\n C[原生配色] --> D[保留]\n```\n\n```pseudocode\n\\begin{algorithm}\n\\caption{Test}\n\\begin{algorithmic}\n\\STATE $x=1$\n\\end{algorithmic}\n\\end{algorithm}\n```\n";
        const file = path.join(project, "sample.md");
        fs.writeFileSync(file, markdown);
        const notebook = await Notebook.init({
            notebookPath: project,
            config: {
                previewTheme: "none.css",
                mermaidTheme: "default",
                mathRenderingOption: "KaTeX",
                enableScriptExecution: false,
            },
        });
        const engine = notebook.getNoteMarkdownEngine(file);
        const parsed = await engine.parseMD(markdown, {
            isForPreview: true,
            useRelativeFilePath: false,
            hideFrontMatter: false,
        });
        assert.equal(parsed.markdown, markdown);
        assert.deepEqual(parsed.JSAndCssFiles, []);
        const denied = await engine.generateHTMLTemplateForPreview({
            config: notebook.config,
            vscodePreviewPanel: null,
            parsedOutput: parsed,
        });
        assert.doesNotMatch(
            denied,
            /<script[^>]+src="[^"]*\/\.crossnote\/preview\.js"/,
        );
        notebook.previewScriptsEnabled = true;
        const trusted = await engine.generateHTMLTemplateForPreview({
            config: notebook.config,
            vscodePreviewPanel: null,
            parsedOutput: parsed,
        });
        assert.match(
            trusted,
            /<script[^>]+src="[^"]*\/\.crossnote\/preview\.js"/,
        );
        assert.equal(notebook.config.enableScriptExecution, false);
        assert.match(parsed.html, /class="mermaid native"/);
        assert.match(parsed.html, /class="crossnote-pseudocode/);
        assert.match(parsed.html, /data-source-line="3"/);
        const html = await engine.htmlExportDocument({
            offline: true,
            embedLocalImages: true,
            embedSVG: true,
        });
        assert.match(html, /--diagram-surface/);
        const exported = path.join(project, "offline.html");
        fs.writeFileSync(exported, html);
        browser = await chromium.launch();
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.context().setOffline(true);
        await page.goto("file://" + exported);
        await page.waitForFunction(
            () => document.querySelectorAll(".mermaid > svg").length === 2,
        );
        const fills = () =>
            page
                .locator(".mermaid")
                .evaluateAll((es) =>
                    es.map(
                        (e) =>
                            getComputedStyle(e.querySelector(".node rect"))
                                .fill,
                    ),
                );
        await page.evaluate(() => (document.body.dataset.xnoteTheme = "paper"));
        await page.waitForTimeout(300);
        const light = await fills();
        await page.evaluate(() => (document.body.dataset.xnoteTheme = "dark"));
        await page.waitForTimeout(300);
        const dark = await fills();
        assert.notEqual(light[0], dark[0]);
        assert.equal(light[1], dark[1]);
        assert.equal(
            (await page.locator(".crossnote-pseudocode .ps-line").count()) > 0,
            true,
        );
        await page.emulateMedia({ media: "print" });
        assert.equal((await fills())[0], "rgb(245, 245, 245)");
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
        assert.ok(pdf.length > 5000);
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close();
        fs.rmSync(project, { recursive: true, force: true });
    }
});
