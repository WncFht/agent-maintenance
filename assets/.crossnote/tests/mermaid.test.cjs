"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test, before, after } = require("node:test");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const config = vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, "config.js"), "utf8"),
).mermaidConfig;
let css;
const fixtures = require("./fixtures/diagrams.json");
let browser;
before(async () => {
    css = (
        await require("less").render(
            fs.readFileSync(path.join(ROOT, "style.less"), "utf8"),
        )
    ).css.replace(/@import[^;]+;/g, "");
    browser = await chromium.launch({ headless: true });
});
after(async () => {
    await browser?.close();
});

async function pageFor(version, htmlLabels = false) {
    const page = await browser.newPage({
        viewport: { width: 1400, height: 1000 },
    });
    await page.setContent(
        '<html><head><meta charset="utf-8"></head><body data-xnote-theme="paper"><main class="markdown-preview"><div class="mermaid" id="chart"></div></main></body></html>',
    );
    await page.addStyleTag({ content: css });
    await page.addScriptTag({
        path: path.join(
            path.dirname(require.resolve(version)),
            "mermaid.min.js",
        ),
    });
    await page.evaluate((settings) => mermaid.initialize(settings), {
        ...config,
        theme: "default",
        layout: "dagre",
        htmlLabels,
        securityLevel: "strict",
    });
    return page;
}
async function render(page, source, id = "sample") {
    await page.evaluate(
        async ({ source, id }) => {
            document.querySelector("#chart").innerHTML = (
                await mermaid.render(id, source)
            ).svg;
        },
        { source, id },
    );
}
async function colors(page) {
    return page.evaluate(() => {
        const host = document.querySelector("#chart");
        const svg = host.querySelector("svg");
        const expected = (property) => {
            const p = document.createElement("span");
            p.style.color = `var(${property})`;
            host.append(p);
            const value = getComputedStyle(p).color;
            p.remove();
            return value;
        };
        const shapes = [
            ...svg.querySelectorAll(
                '.node > rect,rect.actor,.node > .outer-path > path:not([fill="none"])',
            ),
        ];
        const leafText = [
            ...svg.querySelectorAll("text,tspan,.nodeLabel p"),
        ].filter((e) => !e.querySelector("tspan") && e.textContent.trim());
        return {
            paper: expected("--diagram-paper"),
            ink: expected("--diagram-ink"),
            surface: expected("--diagram-surface"),
            line: expected("--diagram-line"),
            nodes: shapes.map((e) => ({
                id: e.parentElement.id,
                fill: getComputedStyle(e).fill,
            })),
            leaves: leafText.map((e) => ({
                text: e.textContent,
                fill: getComputedStyle(e).fill,
                color: getComputedStyle(e).color,
            })),
            geometry: [...svg.querySelectorAll(".node")].map((e) => [
                e.getAttribute("transform"),
                e.getBBox().width,
                e.getBBox().height,
            ]),
            states: [...svg.querySelectorAll(".state-start,.state-end")].map(
                (e) => ({
                    tag: e.tagName,
                    fill: getComputedStyle(e).fill,
                    stroke: getComputedStyle(e).stroke,
                }),
            ),
            backdrops: [...svg.querySelectorAll(".edgeLabel .label rect")]
                .filter((e) => e.getBBox().width > 0)
                .map((e) => getComputedStyle(e).fill),
            markerPaths: [...svg.querySelectorAll("marker path")].map((e) => ({
                id: e.parentElement.id,
                fill: getComputedStyle(e).fill,
                stroke: getComputedStyle(e).stroke,
            })),
            filter: getComputedStyle(svg).filter,
            html: svg.outerHTML,
        };
    });
}

for (const version of ["mermaid11", "mermaid12"]) {
    test(`${version}: five diagram types follow paper/OS/editor/print without layout or source mutation`, async () => {
        const page = await pageFor(version);
        try {
            for (const [kind, source] of Object.entries(fixtures)) {
                await page.emulateMedia({
                    media: "screen",
                    colorScheme: "light",
                });
                await page.evaluate(
                    () => (document.body.dataset.xnoteTheme = "paper"),
                );
                await render(page, source, "case-" + kind);
                const first = await colors(page);
                for (const slot of [
                    "paper",
                    "sepia",
                    "snow",
                    "dark",
                    "onedark",
                    "black",
                ]) {
                    await page.evaluate(
                        (s) => (document.body.dataset.xnoteTheme = s),
                        slot,
                    );
                    await page.waitForTimeout(280);
                    const current = await colors(page);
                    assert.equal(
                        current.html,
                        first.html,
                        `${kind}/${slot}: SVG was modified`,
                    );
                    assert.deepEqual(
                        current.geometry,
                        first.geometry,
                        `${kind}/${slot}: layout changed`,
                    );
                    assert.equal(current.filter, "none");
                    assert.ok(
                        current.nodes.some((n) => n.fill === current.surface),
                        `${version}/${kind}/${slot}: node palette missing ${JSON.stringify(current.nodes)}`,
                    );
                    for (const text of current.leaves) {
                        const explicit =
                            kind === "flow" &&
                            ["作者红色", "检查"].includes(text.text);
                        if (explicit)
                            assert.equal(
                                text.fill,
                                text.text === "检查"
                                    ? "rgb(0, 0, 0)"
                                    : "rgb(255, 255, 255)",
                                "author text color",
                            );
                        if (!explicit)
                            assert.equal(
                                text.fill,
                                kind === "sequence" && /^\d+$/.test(text.text)
                                    ? current.paper
                                    : current.ink,
                                `${version}/${kind}/${slot}: ${text.text}`,
                            );
                    }
                    for (const backdrop of current.backdrops)
                        assert.equal(
                            backdrop,
                            current.paper,
                            `${kind}/${slot}: edge backdrop`,
                        );
                    if (kind === "state")
                        for (const state of current.states)
                            assert.equal(
                                state.fill,
                                current.ink,
                                JSON.stringify(state),
                            );
                    if (kind === "er")
                        for (const marker of current.markerPaths)
                            assert.equal(marker.fill, "none", marker.id);
                    if (kind === "class")
                        for (const marker of current.markerPaths.filter((m) =>
                            /aggregation|extension/.test(m.id),
                        ))
                            assert.equal(marker.fill, current.paper, marker.id);
                    if (kind === "flow")
                        assert.ok(
                            current.nodes.some(
                                (n) => n.fill === "rgb(255, 0, 0)",
                            ),
                            "classDef lost",
                        );
                }
                await page.emulateMedia({ media: "print" });
                const printed = await colors(page);
                assert.equal(printed.ink, "rgb(0, 0, 0)");
                assert.equal(printed.line, "rgb(85, 85, 85)");
                assert.ok(
                    printed.nodes.some((n) => n.fill === "rgb(245, 245, 245)"),
                );
                await page.emulateMedia({
                    media: "screen",
                    colorScheme: "dark",
                });
                await page.evaluate(
                    () => (document.body.dataset.xnoteTheme = "system"),
                );
                await page.waitForTimeout(280);
                assert.equal((await colors(page)).ink, "rgb(230, 221, 203)");
                await page.evaluate(() => {
                    document.body.dataset.xnoteTheme = "editor";
                    document
                        .querySelector("main")
                        .classList.add("editor-light");
                });
                await page.waitForTimeout(280);
                assert.equal((await colors(page)).ink, "rgb(33, 27, 18)");
                await page.evaluate(() =>
                    document
                        .querySelector("main")
                        .classList.remove("editor-light"),
                );
            }
        } finally {
            await page.close();
        }
    });

    test(`${version}: native colors and unadapted data colors remain under author control`, async () => {
        const page = await pageFor(version);
        try {
            await render(page, "flowchart LR\n A[one] --> B[two]");
            await page.evaluate(() => {
                document.body.dataset.xnoteTheme = "dark";
                document.querySelector("#chart").classList.add("native");
            });
            assert.ok(
                (await colors(page)).nodes.every(
                    (n) => n.fill === "rgb(236, 236, 255)",
                ),
            );
            await page.evaluate(() =>
                document.querySelector("#chart").classList.remove("native"),
            );
            await render(
                page,
                'pie title Groups\n "A" : 2\n "B" : 3\n "C" : 4',
                "pie",
            );
            const before = await page
                .locator(".pieCircle")
                .evaluateAll((es) => es.map((e) => getComputedStyle(e).fill));
            await page.evaluate(
                () => (document.body.dataset.xnoteTheme = "paper"),
            );
            const after = await page
                .locator(".pieCircle")
                .evaluateAll((es) => es.map((e) => getComputedStyle(e).fill));
            assert.equal(new Set(before).size, 3);
            assert.deepEqual(after, before);
        } finally {
            await page.close();
        }
    });
}

for (const htmlLabels of [false, true])
    test(`snapshot and PNG preserve ${htmlLabels ? "HTML" : "SVG"} labels without host styles`, async () => {
        const page = await pageFor("mermaid12", htmlLabels);
        const standalone = await browser.newPage();
        try {
            await page.evaluate(
                () => (document.body.dataset.xnoteTheme = "dark"),
            );
            await render(
                page,
                'flowchart LR\n A["第一行<br/>第二行"] --> B["作者红色"] --> C["检查"]\n classDef chosen fill:#ff0000,color:#ffffff;\n class B chosen;\n style C fill:#00ffff,color:#000000;',
            );
            if (htmlLabels) {
                assert.equal(
                    await page
                        .locator(".chosen .nodeLabel p")
                        .evaluate((e) => getComputedStyle(e).color),
                    "rgb(255, 255, 255)",
                );
                assert.equal(
                    await page
                        .locator('[id*="flowchart-C"] .nodeLabel p')
                        .evaluate((e) => getComputedStyle(e).color),
                    "rgb(0, 0, 0)",
                );
            }
            await page.addScriptTag({
                path: path.join(ROOT, "diagram-actions.js"),
            });
            await page.waitForSelector('[data-xnote-diagram-action="svg"]');
            await page.waitForTimeout(300);
            const before = await page
                .locator("#chart > svg")
                .evaluate((e) => e.outerHTML);
            const result = await page.evaluate(async () => {
                const s = await window.__xnoteDiagramTools.snapshot(
                    document.querySelector("#chart > svg"),
                );
                const blob = await window.__xnoteDiagramTools.png(s);
                return {
                    ...s,
                    pngBytes: blob.size,
                    originalP: document
                        .querySelector("#chart .nodeLabel p")
                        ?.getBoundingClientRect().height,
                };
            });
            assert.equal(
                await page.locator("#chart > svg").evaluate((e) => e.outerHTML),
                before,
            );
            assert.ok(result.pngBytes > 1000);
            assert.ok(result.width > 300);
            assert.doesNotMatch(result.svg, /<script|<style|var\(--diagram/);
            await standalone.setContent(result.svg);
            assert.equal(
                await standalone
                    .locator(".chosen rect")
                    .first()
                    .evaluate((e) => getComputedStyle(e).fill),
                "rgb(255, 0, 0)",
            );
            if (htmlLabels) {
                const height = await standalone
                    .locator(".nodeLabel p")
                    .first()
                    .evaluate((e) => e.getBoundingClientRect().height);
                assert.equal(
                    height,
                    result.originalP,
                    "HTML label layout changed outside the document",
                );
            }
            await page.locator('[data-xnote-diagram-action="view"]').click();
            await page.waitForSelector("dialog[open]");
            await page.keyboard.press("Escape");
            await page.waitForSelector("dialog", { state: "detached" });
            await page.addScriptTag({
                path: path.join(ROOT, "diagram-actions.js"),
            });
            assert.equal(await page.locator(".xnote-diagram-tools").count(), 1);
            await page.emulateMedia({ media: "print" });
            assert.equal(
                await page.locator(".xnote-diagram-tools").isVisible(),
                false,
            );
        } finally {
            await page.close();
            await standalone.close();
        }
    });

test("prose typography does not resize HTML labels, and new host SVGs receive actions once", async () => {
    const page = await pageFor("mermaid12", true);
    try {
        await render(page, 'flowchart LR\n A["两行<br/>标签"] --> B[结果]');
        const measure = () =>
            page
                .locator(".nodeLabel p")
                .evaluateAll((es) =>
                    es.map((e) => [
                        getComputedStyle(e).fontSize,
                        getComputedStyle(e).lineHeight,
                        e.getBoundingClientRect().height,
                    ]),
                );
        const initial = await measure();
        await page.evaluate(() =>
            document
                .querySelector("main")
                .classList.add("lh2", "fs18px", "serif"),
        );
        assert.deepEqual(await measure(), initial);
        await page.addScriptTag({
            path: path.join(ROOT, "diagram-actions.js"),
        });
        await page.waitForSelector(".xnote-diagram-tools");
        await render(page, "flowchart LR\n X[更新] --> Y[完成]", "replacement");
        await page.waitForSelector(".xnote-diagram-tools");
        assert.equal(await page.locator(".xnote-diagram-tools").count(), 1);
    } finally {
        await page.close();
    }
});

test("snapshots embed loaded web fonts and fail explicitly for unavailable image resources", async () => {
    const http = require("node:http");
    const fontPath = path.join(
        path.dirname(require.resolve("katex")),
        "fonts/KaTeX_Main-Regular.woff2",
    );
    const server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (req.url === "/font.woff2") {
            res.setHeader("Content-Type", "font/woff2");
            res.end(fs.readFileSync(fontPath));
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const page = await pageFor("mermaid12", true);
    const standalone = await browser.newPage();
    try {
        const address = `http://127.0.0.1:${server.address().port}`;
        await page.addStyleTag({
            content: `@font-face{font-family:FixtureFont;src:url("${address}/font.woff2") format("woff2")}`,
        });
        await page.evaluate(async (settings) => {
            await document.fonts.load("16px FixtureFont");
            mermaid.initialize({
                ...settings,
                htmlLabels: true,
                theme: "default",
                fontFamily: "FixtureFont",
                themeVariables: { fontFamily: "FixtureFont" },
            });
        }, config);
        await render(
            page,
            'flowchart LR\n A["Font metrics"] --> B["Portable SVG"]',
        );
        await page.addScriptTag({
            path: path.join(ROOT, "diagram-actions.js"),
        });
        const result = await page.evaluate(() =>
            window.__xnoteDiagramTools.snapshot(
                document.querySelector("#chart > svg"),
            ),
        );
        assert.match(result.svg, /@font-face/);
        assert.match(result.svg, /data:font\/woff2;base64/);
        await standalone.context().setOffline(true);
        await standalone.setContent(result.svg);
        await standalone.evaluate(() => document.fonts.ready);
        assert.ok(
            await standalone.evaluate(() =>
                [...document.fonts].some(
                    (f) =>
                        f.family.toLowerCase().includes("fixturefont") &&
                        f.status === "loaded",
                ),
            ),
        );
        await page.context().setOffline(false);
        const error = await page.evaluate(async (address) => {
            const image = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "image",
            );
            image.setAttribute("href", address + "/missing.png");
            document.querySelector("#chart > svg").append(image);
            try {
                await window.__xnoteDiagramTools.snapshot(
                    document.querySelector("#chart > svg"),
                );
                return null;
            } catch (e) {
                return e.message;
            }
        }, address);
        assert.match(error, /外部图像/);
        assert.match(
            await page.evaluate(async () => {
                try {
                    await window.__xnoteDiagramTools.png({
                        width: 20000,
                        height: 10000,
                    });
                } catch (e) {
                    return e.message;
                }
            }),
            /图表过大/,
        );
    } finally {
        await page.close();
        await standalone.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
