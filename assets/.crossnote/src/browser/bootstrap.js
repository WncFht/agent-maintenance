(function () {
    "use strict";
    if (window.__xnotePreviewBootstrap) return;
    window.__xnotePreviewBootstrap = true;
    var base = document.currentScript && document.currentScript.src;
    var requested = new Set();
    var frame = 0;
    function load(name, target, label) {
        if (!base || requested.has(name)) return;
        requested.add(name);
        var script = document.createElement("script");
        script.src = new URL(name, base).href;
        script.addEventListener(
            "error",
            function () {
                var error = document.createElement("p");
                error.className = "xnote-diagram-status";
                error.setAttribute("role", "alert");
                error.textContent = label + "加载失败，请重新打开预览以重试。";
                target.after(error);
            },
            { once: true },
        );
        document.head.appendChild(script);
    }
    function scan() {
        // The host's first React commit may replace body children after the
        // trusted head script ran. Reattach chrome without mounting twice.
        window.__xnoteThemeToggle.mount();
        var diagram = document.querySelector(
            ".markdown-preview .mermaid > svg",
        );
        if (diagram)
            load("diagram-actions.js", diagram.parentElement, "图表工具");
        var source = document.querySelector(
            ".markdown-preview pre.language-pseudocode > code, .markdown-preview pre > code.language-pseudocode",
        );
        if (source)
            load(
                "pseudocode-runtime.js",
                source.parentElement,
                "伪代码回退工具",
            );
    }
    var observer = new MutationObserver(function (records) {
        if (
            !frame &&
            records.some(function (r) {
                return r.addedNodes.length > 0;
            })
        ) {
            frame = requestAnimationFrame(function () {
                frame = 0;
                scan();
            });
        }
    });
    function boot() {
        observer.observe(document.body, { childList: true, subtree: true });
        scan();
    }
    if (document.body) boot();
    else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
