"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const parserSource = fs.readFileSync(
    path.resolve(__dirname, "..", "parser.js"),
    "utf8",
);
const parser = vm.runInNewContext(parserSource);

test("source is preserved exactly, including open fences and front matter", async () => {
    for (const markdown of [
        "",
        "# Note\nplain text\n",
        "---\ntitle: Test\n---\n# Note\n",
        "---\n---\n",
        "\ufeff---\ntitle: Test\n---\n",
        "```mermaid\nflowchart LR\n A --> B\n```\n",
        "```pseudocode\n\\begin{algorithm}\n",
        "~~~Pseudocode\nx\n~~~\n",
        "> - ```pseudocode\n> x\n> ```\n",
        "\t```pseudocode\n\tx\n",
        "````markdown\n```pseudocode\nx\n```\n````\n",
        '@import "/.crossnote/theme-toggle.js";\n',
    ])
        assert.equal(await parser.onWillParseMarkdown(markdown), markdown);
});

test("ordinary parsed HTML is unchanged", async () => {
    const html =
        '<h1 data-source-line="1">Note</h1><p>正文</p><div class="mermaid">flowchart LR</div>';
    assert.equal(await parser.onDidParseMarkdown(html), html);
});

test("vendored KaTeX/pseudocode eval lazily — only on first real render", async () => {
    // The ~640KB vendored sources are spliced in as strings and eval'd by
    // ensureVendoredGlobals on the first prerendered block. In a vm sandbox the
    // UMD globals land on the context object, so laziness is observable.
    const sandbox = {};
    const lazy = vm.runInNewContext(parserSource, sandbox);
    await lazy.onWillParseMarkdown("# Note\n```js\nx\n```\n");
    await lazy.onDidParseMarkdown("<p>plain</p><pre><code>x</code></pre>");
    assert.equal(sandbox.katex, undefined);
    assert.equal(sandbox.pseudocode, undefined);

    const algo = String.raw`\begin{algorithm}
\caption{T}
\begin{algorithmic}
\STATE x
\end{algorithmic}
\end{algorithm}`;
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const html =
        `<pre data-role="codeBlock" data-info="pseudocode" ` +
        `class="language-pseudocode"><code>${esc(algo)}</code></pre>`;
    const output = await lazy.onDidParseMarkdown(html);
    assert.match(output, /crossnote-pseudocode/);
    assert.ok(sandbox.katex);
    assert.ok(sandbox.pseudocode);
});
