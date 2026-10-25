"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { test } = require("node:test");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
test("trusted head bootstrap loads only needed enhancements, without Markdown imports", async () => {
    const requests = [];
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, "http://localhost").pathname;
        if (pathname === "/") {
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(
                '<html><head><script src="/preview.js" defer></script></head><body><main class="markdown-preview"><p>plain note</p></main></body></html>',
            );
            return;
        }
        const file = path.resolve(ROOT, "." + pathname);
        if (
            !file.startsWith(ROOT + path.sep) ||
            !fs.existsSync(file) ||
            !fs.statSync(file).isFile()
        ) {
            res.writeHead(404);
            res.end();
            return;
        }
        requests.push(pathname);
        res.setHeader("content-type", "application/javascript");
        res.end(fs.readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForSelector("#xnote-theme-toggle");
        assert.deepEqual(requests, ["/preview.js"]);
        await page.evaluate(
            () =>
                (document.body.innerHTML =
                    '<main class="markdown-preview"><p>host replaced the initial body</p></main>'),
        );
        await page.waitForSelector("#xnote-theme-toggle");
        assert.equal(await page.locator("#xnote-theme-toggle").count(), 1);
        await page.evaluate(() =>
            document
                .querySelector("main")
                .insertAdjacentHTML(
                    "beforeend",
                    '<figure class="crossnote-pseudocode">already rendered</figure>',
                ),
        );
        await page.waitForTimeout(60);
        assert.equal(requests.length, 1);
        await page.evaluate(() =>
            document
                .querySelector("main")
                .insertAdjacentHTML(
                    "beforeend",
                    '<div class="mermaid"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><rect width="50" height="50"/></svg></div>',
                ),
        );
        await page.waitForSelector(".xnote-diagram-tools");
        assert.equal(
            requests.filter((p) => p === "/diagram-actions.js").length,
            1,
        );
        const source = String.raw`\begin{algorithm}\caption{Fallback}\begin{algorithmic}\STATE $x=1$\end{algorithmic}\end{algorithm}`;
        await page.evaluate((source) => {
            const pre = document.createElement("pre");
            pre.className = "language-pseudocode";
            const code = document.createElement("code");
            code.textContent = source;
            pre.append(code);
            document.querySelector("main").append(pre);
        }, source);
        await page.waitForSelector(".crossnote-pseudocode .ps-line");
        assert.equal(
            requests.filter((p) => p === "/pseudocode-runtime.js").length,
            1,
        );
        assert.equal(await page.locator("#xnote-theme-toggle").count(), 1);
        assert.equal(await page.locator(".xnote-diagram-tools").count(), 1);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
