"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test, before, after } = require("node:test");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
let browser, css;
before(async () => {
    css = (
        await require("less").render(
            fs.readFileSync(path.join(ROOT, "style.less"), "utf8"),
        )
    ).css.replace(/@import[^;]+;/g, "");
    browser = await chromium.launch();
});
after(async () => {
    await browser?.close();
});
const chart = `<svg xmlns="http://www.w3.org/2000/svg" id="source" width="2000" height="1400" viewBox="10 20 2000 1400" aria-roledescription="flowchart-v2" aria-labelledby="title">
<title id="title">Navigation fixture</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z"/></marker></defs>
<g class="node" id="alpha" transform="translate(600 500)"><rect width="150" height="60" fill="#eee"/><text x="10" y="35">Alpha node</text></g>
<g class="node" id="beta" transform="translate(1100 700)"><rect width="150" height="60" fill="#eee"/><text x="10" y="35">Beta node</text></g>
<path id="edge" d="M750 530 L1100 730" stroke="black" marker-end="url(#arrow)"/></svg>`;
async function open(page) {
    await page.locator('[data-xnote-diagram-action="view"]').click();
    await page.waitForSelector("dialog[open]");
    await settled(page);
}
async function pageFor(svg = chart) {
    const page = await browser.newPage({
        viewport: { width: 1100, height: 850 },
    });
    await page.setContent(
        "<style>" +
            css +
            '</style><main class="markdown-preview"><div class="mermaid">' +
            svg +
            "</div></main>",
    );
    await page.evaluate(() => {
        window.hostWheels = 0;
        window.errors = [];
        window.addEventListener("error", (e) => window.errors.push(e.message));
        // Reproduce MPE's document-capture interception; the viewer must win
        // regardless of registration order, without consuming outside wheels.
        document.addEventListener(
            "wheel",
            (e) => {
                if (e.ctrlKey || e.metaKey) {
                    window.hostWheels++;
                    e.preventDefault();
                    e.stopPropagation();
                }
            },
            { capture: true, passive: false },
        );
    });
    await page.addScriptTag({ path: path.join(ROOT, "diagram-actions.js") });
    await open(page);
    return page;
}
async function settled(page) {
    await page.evaluate(
        () =>
            new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
    );
}
async function camera(page) {
    return page.evaluate(() => {
        const scene = document.querySelector(".xnote-diagram-scene"),
            v = document.querySelector(".xnote-diagram-viewport");
        const m = new DOMMatrix(getComputedStyle(scene).transform);
        return {
            x: m.e,
            y: m.f,
            k: m.a,
            w: parseFloat(getComputedStyle(v).width),
            h: parseFloat(getComputedStyle(v).height),
            hostWheels,
            errors,
        };
    });
}
async function wheel(page, input, count = 1) {
    const point = await page.evaluate(
        ({ input, count }) => {
            const v = document.querySelector(".xnote-diagram-viewport"),
                r = v.getBoundingClientRect();
            let point;
            for (let i = 0; i < count; i++) {
                const e = new WheelEvent("wheel", {
                    clientX: r.left + r.width * 0.6,
                    clientY: r.top + r.height * 0.6,
                    bubbles: true,
                    cancelable: true,
                    ...input,
                });
                if (input.legacy)
                    Object.defineProperty(e, "momentum", { value: undefined });
                point = {
                    x:
                        ((e.clientX - r.left) *
                            parseFloat(getComputedStyle(v).width)) /
                        r.width,
                    y:
                        ((e.clientY - r.top) *
                            parseFloat(getComputedStyle(v).height)) /
                        r.height,
                };
                v.dispatchEvent(e);
            }
            return point;
        },
        { input, count },
    );
    await settled(page);
    return point;
}
function closeTo(a, b, epsilon = 0.03) {
    assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
}

test("continuous pinch preserves the focal point under host CSS zoom and event fragmentation", async () => {
    const p = await pageFor();
    try {
        await p.evaluate(() => (document.body.style.zoom = "1.25"));
        await settled(p);
        await p.click('[data-view="actual"]');
        await settled(p);
        const a = await camera(p);
        const anchor = await wheel(p, {
            ctrlKey: true,
            deltaY: -100 * Math.log(2),
        });
        const q = { x: (anchor.x - a.x) / a.k, y: (anchor.y - a.y) / a.k };
        const b = await camera(p);
        closeTo(b.k, 2);
        closeTo(b.x + q.x * b.k, anchor.x);
        closeTo(b.y + q.y * b.k, anchor.y);
        await p.click('[data-view="actual"]');
        await settled(p);
        await wheel(p, { ctrlKey: true, deltaY: -10 * Math.log(2) }, 10);
        const fragmented = await camera(p);
        closeTo(fragmented.k, 2);
        await wheel(p, { ctrlKey: true, deltaX: 0, deltaY: 0 });
        assert.deepEqual(await camera(p), fragmented);
        assert.equal(b.hostWheels, 0);
        assert.deepEqual(b.errors, []);
    } finally {
        await p.close();
    }
});

test("plain trackpad wheel always pans both axes and host handling returns after close", async () => {
    const p = await pageFor();
    try {
        await p.click('[data-view="actual"]');
        await settled(p);
        const a = await camera(p);
        await wheel(p, { deltaX: 37.5, deltaY: 21.25 });
        const b = await camera(p);
        closeTo(b.x, a.x - 37.5);
        closeTo(b.y, a.y - 21.25);
        closeTo(b.k, a.k);
        await wheel(p, { shiftKey: true, deltaX: 16, deltaY: 0 });
        const c = await camera(p);
        closeTo(c.x, b.x - 16);
        closeTo(c.y, b.y);
        await wheel(p, { deltaMode: 1, deltaY: 2 });
        closeTo((await camera(p)).y, c.y - 32);
        await p.click('[data-view="close"]');
        await p.waitForSelector("dialog", { state: "detached" });
        assert.ok(
            await p
                .locator('[data-xnote-diagram-action="view"]')
                .evaluate((e) => e === document.activeElement),
        );
        await p.evaluate(() =>
            document.body.dispatchEvent(
                new WheelEvent("wheel", {
                    ctrlKey: true,
                    deltaY: -10,
                    bubbles: true,
                    cancelable: true,
                }),
            ),
        );
        assert.equal(await p.evaluate(() => hostWheels), 1);
        await open(p);
        await p.click('[data-view="actual"]');
        await settled(p);
        await wheel(p, { ctrlKey: true, deltaY: -10 });
        closeTo((await camera(p)).k, Math.exp(0.1));
        assert.equal((await camera(p)).hostWheels, 1);
    } finally {
        await p.close();
    }
});

test("native momentum retains pan ownership while a new pinch takes over immediately", async () => {
    const p = await pageFor();
    try {
        await p.click('[data-view="actual"]');
        await settled(p);
        const a = await camera(p);
        await wheel(p, { deltaY: 20 });
        await wheel(p, { deltaY: 8, metaKey: true, momentum: true });
        const b = await camera(p);
        closeTo(b.k, 1);
        closeTo(b.y, a.y - 28);
        await wheel(p, { ctrlKey: true, deltaY: -10, momentum: false });
        closeTo((await camera(p)).k, Math.exp(0.1));
        await p.evaluate(() => window.dispatchEvent(new Event("blur")));
        const c = await camera(p);
        await wheel(p, { metaKey: true, deltaY: 4, momentum: true });
        assert.deepEqual(await camera(p), c);
    } finally {
        await p.close();
    }
});

test("legacy engines protect physical-modifier pan tails without delaying synthetic Ctrl pinch", async () => {
    const p = await pageFor();
    try {
        await p.click('[data-view="actual"]');
        await settled(p);
        await p.evaluate(() => {
            const v = document.querySelector(".xnote-diagram-viewport"),
                r = v.getBoundingClientRect();
            function send(ctrl) {
                const e = new WheelEvent("wheel", {
                    deltaY: ctrl ? -10 : 20,
                    ctrlKey: ctrl,
                    bubbles: true,
                    cancelable: true,
                    clientX: r.left + r.width / 2,
                    clientY: r.top + r.height / 2,
                });
                Object.defineProperty(e, "momentum", { value: undefined });
                v.dispatchEvent(e);
            }
            send(false);
            window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Control" }),
            );
            send(true);
        });
        await settled(p);
        closeTo((await camera(p)).k, 1);
        await p.evaluate(() =>
            window.dispatchEvent(
                new KeyboardEvent("keyup", { key: "Control" }),
            ),
        );
        await wheel(p, { ctrlKey: true, deltaY: -10, legacy: true });
        closeTo((await camera(p)).k, Math.exp(0.1));
    } finally {
        await p.close();
    }
});

test("fit follows resize, manual mode preserves its center, and huge diagrams remain fully visible", async () => {
    const p = await pageFor();
    try {
        const a = await camera(p);
        await p.setViewportSize({ width: 800, height: 700 });
        await settled(p);
        const b = await camera(p);
        assert.ok(b.k < a.k);
        assert.ok(2000 * b.k <= b.w - 47);
        await p.click('[data-view="actual"]');
        await settled(p);
        const c = await camera(p);
        await p.setViewportSize({ width: 1000, height: 800 });
        await settled(p);
        const d = await camera(p);
        closeTo(d.k, c.k);
        closeTo((d.w / 2 - d.x) / d.k, (c.w / 2 - c.x) / c.k);
        closeTo((d.h / 2 - d.y) / d.k, (c.h / 2 - c.y) / c.k);
        await p.click('[data-view="fit"]');
        await settled(p);
        assert.ok((await camera(p)).k < 1);
    } finally {
        await p.close();
    }
    const huge = await pageFor(
        chart
            .replace('width="2000"', 'width="200000"')
            .replace("10 20 2000 1400", "10 20 200000 1400"),
    );
    try {
        const c = await camera(huge);
        assert.ok(c.k < 0.1);
        assert.ok(200000 * c.k <= c.w - 47);
    } finally {
        await huge.close();
    }
});

test("click selects without repainting or resizing, drag does not select, and one Escape closes", async () => {
    const p = await pageFor();
    try {
        const source = await p
            .locator(".mermaid > svg")
            .evaluate((e) => e.outerHTML);
        const node = p
            .locator(".xnote-diagram-scene [data-xnote-pick]")
            .first();
        const before = await camera(p);
        await node.click();
        await settled(p);
        assert.deepEqual(await camera(p), before);
        assert.equal(await node.getAttribute("aria-pressed"), "true");
        assert.ok(await p.locator(".xnote-diagram-selection").isVisible());
        const border = await p
            .locator(".xnote-diagram-selection")
            .evaluate((e) => getComputedStyle(e).borderWidth);
        await p.click('[data-view="in"]');
        await settled(p);
        assert.equal(
            await p
                .locator(".xnote-diagram-selection")
                .evaluate((e) => getComputedStyle(e).borderWidth),
            border,
        );
        const bounds = await p.evaluate(() => {
            const n = document
                    .querySelector('[data-xnote-pick][aria-pressed="true"]')
                    .getBoundingClientRect(),
                o = document
                    .querySelector(".xnote-diagram-selection")
                    .getBoundingClientRect();
            return {
                nx: n.x,
                ny: n.y,
                ox: o.x,
                oy: o.y,
                nw: n.width,
                ow: o.width,
            };
        });
        closeTo(bounds.nx - bounds.ox, 3);
        closeTo(bounds.ny - bounds.oy, 3);
        closeTo(bounds.ow - bounds.nw, 6);
        assert.equal(
            await p.locator(".mermaid > svg").evaluate((e) => e.outerHTML),
            source,
        );
        await p.click('[data-view="clear"]');
        assert.equal(await node.getAttribute("aria-pressed"), "false");
        const r = await node.boundingBox();
        await p.mouse.move(r.x + 20, r.y + 20);
        await p.mouse.down();
        await p.mouse.move(r.x + 50, r.y + 30, { steps: 4 });
        await p.mouse.up();
        assert.equal(await node.getAttribute("aria-pressed"), "false");
        await node.click();
        assert.equal(await node.getAttribute("aria-pressed"), "true");
        await p.keyboard.press("Escape");
        await p.waitForSelector("dialog", { state: "detached" });
    } finally {
        await p.close();
    }
});

test("cloned SVG references are isolated, keyboard selection works and unsupported types remain navigable", async () => {
    const p = await pageFor();
    try {
        const references = await p.evaluate(() => {
            const s = document.querySelector(".xnote-diagram-scene svg"),
                ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
            return {
                unique: ids.length === new Set(ids).size,
                marker: s.querySelector("marker").id,
                edge: s
                    .querySelector("[marker-end]")
                    .getAttribute("marker-end"),
                label: s.getAttribute("aria-labelledby"),
                title: s.querySelector("title").id,
            };
        });
        assert.ok(references.unique);
        assert.ok(references.edge.includes("#" + references.marker));
        assert.equal(references.label, references.title);
        const n = p.locator(".xnote-diagram-scene [data-xnote-pick]");
        await n.first().focus();
        await p.keyboard.press("ArrowRight");
        assert.ok(await n.nth(1).evaluate((e) => e === document.activeElement));
        await p.keyboard.press("Enter");
        assert.equal(await n.nth(1).getAttribute("aria-pressed"), "true");
        await p.click('[data-view="selection"]');
        await settled(p);
        closeTo((await camera(p)).k, 1);
        await p.evaluate(() =>
            Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: {
                    writeText: async (text) => {
                        window.copied = text;
                    },
                },
            }),
        );
        await p.click('[data-view="copy"]');
        assert.equal(await p.evaluate(() => copied), "Beta node");
    } finally {
        await p.close();
    }
    const other = await pageFor(chart.replace("flowchart-v2", "pie"));
    try {
        assert.equal(await other.locator("[data-xnote-pick]").count(), 0);
        await wheel(other, { ctrlKey: true, deltaY: -20 });
        assert.ok((await camera(other)).k > 0);
    } finally {
        await other.close();
    }
});

test("blur, pointer cancellation and external removal release navigation ownership", async () => {
    const p = await pageFor();
    try {
        await p.click('[data-view="actual"]');
        await settled(p);
        const v = p.locator(".xnote-diagram-viewport"),
            r = await v.boundingBox();
        await p.mouse.move(r.x + 300, r.y + 300);
        await p.mouse.down();
        await p.mouse.move(r.x + 350, r.y + 320);
        await p.evaluate(() => window.dispatchEvent(new Event("blur")));
        await settled(p);
        const c = await camera(p);
        await p.mouse.move(r.x + 400, r.y + 350);
        await p.mouse.up();
        await settled(p);
        assert.deepEqual(await camera(p), c);
        await p.mouse.down();
        await p.evaluate(() =>
            document
                .querySelector(".xnote-diagram-viewport")
                .dispatchEvent(
                    new PointerEvent("pointercancel", { bubbles: true }),
                ),
        );
        await p.mouse.up();
        assert.equal(await p.locator('[aria-pressed="true"]').count(), 0);
        await p.evaluate(() => document.querySelector("dialog").remove());
        await settled(p);
        await open(p);
        await p.click('[data-view="actual"]');
        await settled(p);
        await wheel(p, { deltaY: -10, ctrlKey: true });
        closeTo((await camera(p)).k, Math.exp(0.1));
        assert.deepEqual((await camera(p)).errors, []);
    } finally {
        await p.close();
    }
});

for (const version of ["mermaid11", "mermaid12"])
    test(`${version}: real HTML-label nodes remain selectable and marker references survive`, async () => {
        const p = await browser.newPage({
            viewport: { width: 1100, height: 850 },
        });
        try {
            await p.setContent(
                "<style>" +
                    css +
                    '</style><main class="markdown-preview"><div class="mermaid"></div></main>',
            );
            await p.addScriptTag({
                path: path.join(
                    path.dirname(require.resolve(version)),
                    "mermaid.min.js",
                ),
            });
            const config = vm.runInNewContext(
                fs.readFileSync(path.join(ROOT, "config.js"), "utf8"),
            ).mermaidConfig;
            await p.evaluate(async (config) => {
                mermaid.initialize({
                    ...config,
                    htmlLabels: true,
                    securityLevel: "strict",
                    layout: "dagre",
                });
                document.querySelector(".mermaid").innerHTML = (
                    await mermaid.render(
                        "real-chart",
                        "flowchart LR\n A[输入文字] --> B[输出文字]",
                    )
                ).svg;
            }, config);
            await p.addScriptTag({
                path: path.join(ROOT, "diagram-actions.js"),
            });
            await open(p);
            const node = p
                .locator(".xnote-diagram-scene [data-xnote-pick]")
                .first();
            await node.click();
            assert.equal(await node.getAttribute("aria-pressed"), "true");
            assert.match(
                await p
                    .locator('.xnote-diagram-selection-tools [role="status"]')
                    .textContent(),
                /输入文字/,
            );
            const references = await p.evaluate(() => {
                const svg = document.querySelector(".xnote-diagram-scene svg");
                return [...svg.querySelectorAll("*")]
                    .flatMap((e) =>
                        [...e.attributes].flatMap((a) =>
                            [
                                ...a.value.matchAll(/url\(["']?#([^)'"\s]+)/g),
                            ].map((m) => m[1]),
                        ),
                    )
                    .every((id) =>
                        svg.querySelector('[id="' + CSS.escape(id) + '"]'),
                    );
            });
            assert.ok(references);
        } finally {
            await p.close();
        }
    });

test("a free canvas moves beyond every image edge, preserves off-image zoom focus, and fits home", async () => {
    const p = await pageFor();
    try {
        const initial = await camera(p);
        for (const delta of [-3000, 6000, -3000]) {
            const before = await camera(p);
            await wheel(p, { deltaX: delta, deltaY: delta });
            const after = await camera(p);
            closeTo(after.x, before.x - delta);
            closeTo(after.y, before.y - delta);
            closeTo(after.k, before.k);
        }
        await wheel(p, { deltaX: 3000, deltaY: 3000 });
        const before = await camera(p);
        const anchor = await wheel(p, { ctrlKey: true, deltaY: -20 });
        const after = await camera(p);
        closeTo(
            after.x + ((anchor.x - before.x) / before.k) * after.k,
            anchor.x,
            0.1,
        );
        closeTo(
            after.y + ((anchor.y - before.y) / before.k) * after.k,
            anchor.y,
            0.1,
        );
        await p.click('[data-view="fit"]');
        await settled(p);
        assert.deepEqual(await camera(p), initial);
    } finally {
        await p.close();
    }
});

test("viewer ships its own layout even with legacy host CSS and body-targeted Escape", async () => {
    const p = await pageFor();
    try {
        await p.addStyleTag({
            content: `.xnote-diagram-dialog { max-width:1400px; }
            .xnote-diagram-dialog .xnote-diagram-viewport { height:calc(100% - 3em); overflow:auto; margin-top:1em; }
            .xnote-diagram-dialog .xnote-diagram-controls { display:flex; gap:0.5em; }`,
        });
        await settled(p);
        const layout = await p.evaluate(() => {
            const v = document.querySelector(".xnote-diagram-viewport"),
                s = document.querySelector(".xnote-diagram-scene");
            v.scrollLeft = 200;
            v.scrollTop = 200;
            return {
                overflow: getComputedStyle(v).overflow,
                margin: getComputedStyle(v).marginTop,
                position: getComputedStyle(s).position,
                scroll: [v.scrollLeft, v.scrollTop],
            };
        });
        assert.equal(layout.overflow, "clip");
        assert.equal(layout.margin, "0px");
        assert.equal(layout.position, "absolute");
        assert.deepEqual(layout.scroll, [0, 0]);
        await wheel(p, { deltaX: 200, deltaY: 200 });
        await p.evaluate(() =>
            document.body.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "Escape",
                    bubbles: true,
                    cancelable: true,
                }),
            ),
        );
        await p.waitForSelector(".xnote-diagram-dialog", { state: "detached" });
    } finally {
        await p.close();
    }
});

test("click-only activation selects a node while native cancel exits in one step", async () => {
    const p = await pageFor();
    try {
        await p
            .locator("[data-xnote-pick]")
            .first()
            .dispatchEvent("click", { detail: 1 });
        assert.equal(
            await p
                .locator("[data-xnote-pick]")
                .first()
                .getAttribute("aria-pressed"),
            "true",
        );
        await p.locator("dialog").dispatchEvent("cancel", { cancelable: true });
        await p.waitForSelector("dialog", { state: "detached" });
    } finally {
        await p.close();
    }
});

for (const version of ["mermaid11", "mermaid12"])
    test(`${version}: all five diagram types have visible pointer-selectable nodes`, async () => {
        const fixtures = require("./fixtures/diagrams.json");
        const p = await browser.newPage({
            viewport: { width: 1100, height: 850 },
        });
        try {
            await p.setContent(
                "<style>" +
                    css +
                    '</style><main class="markdown-preview"><div class="mermaid"></div></main>',
            );
            await p.addScriptTag({
                path: path.join(
                    path.dirname(require.resolve(version)),
                    "mermaid.min.js",
                ),
            });
            await p.addScriptTag({
                path: path.join(ROOT, "diagram-actions.js"),
            });
            for (const [kind, source] of Object.entries(fixtures)) {
                const config = vm.runInNewContext(
                    fs.readFileSync(path.join(ROOT, "config.js"), "utf8"),
                ).mermaidConfig;
                await p.evaluate(
                    async ({ kind, source, config }) => {
                        mermaid.initialize({
                            ...config,
                            startOnLoad: false,
                            htmlLabels: true,
                        });
                        document.querySelector(".mermaid").innerHTML = (
                            await mermaid.render("pick-" + kind, source)
                        ).svg;
                        window.__xnoteDiagramTools.mount();
                    },
                    { kind, source, config },
                );
                try {
                    await open(p);
                } catch (error) {
                    throw new Error(
                        kind +
                            ": " +
                            (await p
                                .locator(".xnote-diagram-status")
                                .textContent()),
                        { cause: error },
                    );
                }
                const nodes = p.locator(
                    ".xnote-diagram-scene [data-xnote-pick]",
                );
                assert.ok((await nodes.count()) > 0, kind);
                // Click the actual label/shape, not an enclosing g's empty bounding box.
                const target = nodes
                    .first()
                    .locator(".nodeLabel,text.actor,text")
                    .first();
                if (await target.count()) await target.click();
                else await nodes.first().click();
                await settled(p);
                const selected = p.locator(
                    '.xnote-diagram-scene [aria-pressed="true"]',
                );
                assert.equal(await selected.count(), 1, kind);
                assert.ok(
                    await p.locator(".xnote-diagram-selection").isVisible(),
                    kind,
                );
                const name = await p
                    .locator('.xnote-diagram-selection-tools [role="status"]')
                    .textContent();
                assert.ok(name && name !== "未选中节点", kind);
                await p.keyboard.press("Escape");
                await p.waitForSelector("dialog", { state: "detached" });
            }
        } finally {
            await p.close();
        }
    });

test("locating a selection always centers it at 100%, independent of its size or prior zoom", async () => {
    const p = await pageFor();
    try {
        const node = p.locator("[data-xnote-pick]").first();
        await node.click();
        for (const previous of [0.3, 3]) {
            await p.click('[data-view="actual"]');
            await wheel(p, {
                ctrlKey: true,
                deltaY: -100 * Math.log(previous),
            });
            await p.click('[data-view="selection"]');
            await settled(p);
            closeTo((await camera(p)).k, 1);
            const offset = await p.evaluate(() => {
                const n = document
                        .querySelector('[aria-pressed="true"]')
                        .getBoundingClientRect(),
                    v = document
                        .querySelector(".xnote-diagram-viewport")
                        .getBoundingClientRect();
                return {
                    x: n.x + n.width / 2 - v.x - v.width / 2,
                    y: n.y + n.height / 2 - v.y - v.height / 2,
                };
            });
            closeTo(offset.x, 0);
            closeTo(offset.y, 0);
        }
    } finally {
        await p.close();
    }
});

test("double-click in the viewer neither zooms nor reaches host source navigation", async () => {
    const p = await pageFor();
    try {
        await p.evaluate(() => {
            window.hostDoubleClicks = 0;
            document.addEventListener(
                "dblclick",
                () => hostDoubleClicks++,
                true,
            );
        });
        const node = p.locator("[data-xnote-pick]").first(),
            before = await camera(p);
        await node.dblclick();
        await settled(p);
        assert.deepEqual(await camera(p), before);
        assert.equal(await node.getAttribute("aria-pressed"), "true");
        assert.equal(await p.evaluate(() => hostDoubleClicks), 0);
        assert.doesNotMatch(
            await p.locator(".xnote-diagram-hint").textContent(),
            /双击/,
        );
    } finally {
        await p.close();
    }
});

test("canvas and exported paper share one composited color in light, dark and author-defined backgrounds", async () => {
    const p = await pageFor();
    try {
        await p.click('[data-view="close"]');
        await p.waitForSelector("dialog", { state: "detached" });
        for (const theme of ["paper", "onedark", "black", "native"]) {
            await p.evaluate((theme) => {
                document.body.dataset.xnoteTheme =
                    theme === "native" ? "paper" : theme;
                document.querySelector(".mermaid > svg").style.backgroundColor =
                    theme === "native" ? "rgb(19, 41, 67)" : "";
            }, theme);
            await p.waitForTimeout(300);
            const source = await p
                .locator(".mermaid > svg")
                .evaluate((e) => e.outerHTML);
            const paper = await p.evaluate(
                async () =>
                    (
                        await __xnoteDiagramTools.snapshot(
                            document.querySelector(".mermaid > svg"),
                        )
                    ).paper,
            );
            await open(p);
            assert.equal(
                await p
                    .locator(".xnote-diagram-viewport")
                    .evaluate((e) => getComputedStyle(e).backgroundColor),
                paper.replace(/,/g, ", "),
                theme,
            );
            assert.equal(
                await p
                    .locator(".xnote-diagram-scene svg > rect")
                    .first()
                    .getAttribute("fill"),
                paper,
                theme,
            );
            assert.equal(
                await p.locator(".mermaid > svg").evaluate((e) => e.outerHTML),
                source,
            );
            if (theme === "native") assert.equal(paper, "rgb(19,41,67)");
            await p.keyboard.press("Escape");
            await p.waitForSelector("dialog", { state: "detached" });
        }
    } finally {
        await p.close();
    }
});

test("clicking the document diagram opens the viewer; dragging, links and controls retain their actions", async () => {
    const p = await pageFor();
    try {
        await p.click('[data-view="close"]');
        await p.waitForSelector("dialog", { state: "detached" });
        const node = p.locator(".mermaid > svg g.node").first();
        const source = await p
            .locator(".mermaid > svg")
            .evaluate((e) => e.outerHTML);
        await node.locator("rect").click();
        await p.waitForSelector("dialog[open]");
        assert.equal(
            await p.locator(".mermaid > svg").evaluate((e) => e.outerHTML),
            source,
        );
        await p.keyboard.press("Escape");
        await p.waitForSelector("dialog", { state: "detached" });
        assert.ok(
            await p
                .locator('[data-xnote-diagram-action="view"]')
                .evaluate((e) => e === document.activeElement),
        );
        await node.scrollIntoViewIfNeeded();
        const r = await node.boundingBox();
        await p.mouse.move(r.x + 10, r.y + 10);
        await p.mouse.down();
        await p.mouse.move(r.x + 50, r.y + 15);
        await p.mouse.up();
        await settled(p);
        assert.equal(await p.locator("dialog").count(), 0);
        await p.evaluate(() => getSelection().removeAllRanges());
        await node.evaluate((e) => {
            e.classList.add("clickable");
            window.authorClicks = 0;
            e.addEventListener("click", () => authorClicks++);
        });
        await node.locator("rect").click();
        await settled(p);
        assert.equal(await p.locator("dialog").count(), 0);
        assert.equal(await p.evaluate(() => authorClicks), 1);
        await node.evaluate((e) => {
            e.classList.remove("clickable");
            const a = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "a",
            );
            a.setAttribute("href", "#source");
            e.parentNode.insertBefore(a, e);
            a.append(e);
        });
        await node.locator("rect").click();
        await settled(p);
        assert.equal(await p.locator("dialog").count(), 0);
        await p.locator('[data-xnote-diagram-action="view"]').click();
        await p.waitForSelector("dialog[open]");
    } finally {
        await p.close();
    }
});

test("arrow keys move the picture in the arrow direction at every zoom", async () => {
    const p = await pageFor();
    try {
        for (const zoom of [0.5, 2]) {
            await p.click('[data-view="actual"]');
            await wheel(p, { ctrlKey: true, deltaY: -100 * Math.log(zoom) });
            await p.locator(".xnote-diagram-viewport").focus();
            for (const [key, dx, dy] of [
                ["ArrowLeft", -40, 0],
                ["ArrowRight", 40, 0],
                ["ArrowUp", 0, -40],
                ["ArrowDown", 0, 40],
            ]) {
                const a = await camera(p);
                await p.keyboard.press(key);
                await settled(p);
                const b = await camera(p);
                closeTo(b.x - a.x, dx);
                closeTo(b.y - a.y, dy);
                closeTo(b.k, a.k);
            }
        }
    } finally {
        await p.close();
    }
});

async function mapGeometry(p) {
    return p.evaluate(() => {
        const svg = document.querySelector(".xnote-diagram-minimap svg"),
            img = svg.querySelector("image"),
            v = svg.querySelector(".xnote-minimap-view"),
            r = svg.getBoundingClientRect();
        const rect = (e) => ({
            x: +e.getAttribute("x"),
            y: +e.getAttribute("y"),
            width: +e.getAttribute("width"),
            height: +e.getAttribute("height"),
        });
        return {
            image: rect(img),
            view: rect(v),
            screen: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
    });
}

test("minimap is lazy and collapsible, tracks the visible world, and can find an offscreen picture", async () => {
    const p = await pageFor();
    try {
        const toggle = p.locator(
                '.xnote-diagram-controls [data-view="minimap"]',
            ),
            map = p.locator(".xnote-diagram-minimap");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await map.isVisible(), false);
        assert.equal(await map.locator("image").getAttribute("href"), null);
        const before = await camera(p);
        await toggle.click();
        await settled(p);
        assert.deepEqual(await camera(p), before);
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        assert.match(
            await map.locator("image").getAttribute("href"),
            /^data:image\/svg\+xml/,
        );
        await p.click('[data-view="actual"]');
        await wheel(p, { deltaX: 5000, deltaY: 4000 });
        const c = await camera(p),
            m = await mapGeometry(p),
            s = m.image.width / 2000;
        closeTo((m.view.x - m.image.x) / s, -c.x / c.k, 0.1);
        closeTo((m.view.y - m.image.y) / s, -c.y / c.k, 0.1);
        closeTo(m.view.width / s, c.w / c.k, 0.1);
        closeTo(m.view.height / s, c.h / c.k, 0.1);
        for (const r of [m.image, m.view])
            assert.ok(
                r.x >= 7.9 &&
                    r.y >= 7.9 &&
                    r.x + r.width <= 212.1 &&
                    r.y + r.height <= 132.1,
                JSON.stringify(m),
            );
        const x = Math.round(
                m.screen.x +
                    ((m.image.x + m.image.width / 2) * m.screen.width) / 220,
            ),
            y = Math.round(
                m.screen.y +
                    ((m.image.y + m.image.height / 2) * m.screen.height) / 140,
            );
        const world = {
            x: (((x - m.screen.x) * 220) / m.screen.width - m.image.x) / s,
            y: (((y - m.screen.y) * 140) / m.screen.height - m.image.y) / s,
        };
        await p.mouse.click(x, y);
        await settled(p);
        const moved = await camera(p);
        closeTo((moved.w / 2 - moved.x) / moved.k, world.x, 0.1);
        closeTo((moved.h / 2 - moved.y) / moved.k, world.y, 0.1);
        closeTo(moved.k, c.k);
        await map.locator("svg").focus();
        await map.locator("button").click();
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await map.isVisible(), false);
        await p.keyboard.press("Escape");
        await p.waitForSelector("dialog", { state: "detached" });
        await open(p);
        assert.equal(
            await p
                .locator('.xnote-diagram-controls [data-view="minimap"]')
                .getAttribute("aria-expanded"),
            "false",
        );
    } finally {
        await p.close();
    }
});

test("dragging the minimap viewport preserves the grabbed offset and releases on blur", async () => {
    const p = await pageFor();
    try {
        await p.click('[data-view="actual"]');
        await p
            .locator('.xnote-diagram-controls [data-view="minimap"]')
            .click();
        await settled(p);
        const a = await camera(p),
            m = await mapGeometry(p),
            s = m.image.width / 2000;
        const x = Math.round(
                m.screen.x +
                    ((m.view.x + m.view.width * 0.3) * m.screen.width) / 220,
            ),
            y = Math.round(
                m.screen.y +
                    ((m.view.y + m.view.height * 0.3) * m.screen.height) / 140,
            );
        await p.mouse.move(x, y);
        await p.mouse.down();
        await settled(p);
        assert.deepEqual(await camera(p), a);
        await p.mouse.move(x + 60, y + 30, { steps: 4 });
        await settled(p);
        const b = await camera(p);
        closeTo(b.x, a.x - ((60 * 220) / m.screen.width / s) * a.k, 0.15);
        closeTo(b.y, a.y - ((30 * 140) / m.screen.height / s) * a.k, 0.15);
        await p.mouse.up();
        await settled(p);
        assert.deepEqual(await camera(p), b);
        const m2 = await mapGeometry(p);
        await p.mouse.move(
            m2.screen.x + m2.screen.width / 2,
            m2.screen.y + m2.screen.height / 2,
        );
        await p.mouse.down();
        await p.evaluate(() => window.dispatchEvent(new Event("blur")));
        await settled(p);
        const c = await camera(p);
        await p.mouse.move(
            m2.screen.x + m2.screen.width / 2 + 30,
            m2.screen.y + m2.screen.height / 2 + 30,
        );
        await p.mouse.up();
        await settled(p);
        assert.deepEqual(await camera(p), c);
    } finally {
        await p.close();
    }
});
