(function () {
    "use strict";

    var SOURCE_SELECTOR =
        "pre.language-pseudocode > code, pre > code.language-pseudocode";
    // Same set restricted to unrendered blocks — expressible in a selector so
    // querySelector can stop at the first match instead of walking a subtree.
    var UNRENDERED_SOURCE_SELECTOR =
        "pre.language-pseudocode:not([data-pseudocode-rendered]) > code, " +
        "pre:not([data-pseudocode-rendered]) > code.language-pseudocode";
    var BLOCK_SELECTOR = ".crossnote-pseudocode, " + SOURCE_SELECTOR;
    var DEPENDENCY_TIMEOUT_MS = 8000;

    // ==== BEGIN PURE CORE ====
    /* @xnote pseudocode-core */
    // ==== END PURE CORE ====

    // Null when this file is require()'d under Node (no DOM available).
    var runtimeScriptUrl =
        typeof document !== "undefined" ? findRuntimeScriptUrl() : null;
    var observer = null;
    var renderQueued = false;
    var renderInFlight = false;
    var renderAgain = false;
    var dependencyPromise = null;

    function findRuntimeScriptUrl() {
        var script = document.currentScript;
        if (!script || !script.src) {
            var scripts = document.querySelectorAll("script[src]");
            for (var index = scripts.length - 1; index >= 0; index -= 1) {
                if (
                    /\/pseudocode-runtime\.js(?:[?#]|$)/.test(
                        scripts[index].src,
                    )
                ) {
                    script = scripts[index];
                    break;
                }
            }
        }
        return script && script.src ? script.src : null;
    }

    function dependencyUrl(filename) {
        if (!runtimeScriptUrl) {
            throw new Error(
                "Cannot locate pseudocode-runtime.js; vendor dependency URLs are unknown.",
            );
        }
        return new URL("vendor/" + filename, runtimeScriptUrl).href;
    }

    function waitForScript(script, globalName, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timeout = window.setTimeout(function () {
                if (settled) return;
                settled = true;
                reject(
                    new Error(
                        globalName +
                            " did not load within " +
                            timeoutMs +
                            "ms.",
                    ),
                );
            }, timeoutMs);

            function finish(error) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                script.removeEventListener("load", onLoad);
                script.removeEventListener("error", onError);
                if (error) reject(error);
                else resolve(window[globalName]);
            }

            function onLoad() {
                if (!window[globalName]) {
                    finish(
                        new Error(
                            globalName +
                                " loaded but did not create window." +
                                globalName +
                                ".",
                        ),
                    );
                    return;
                }
                finish();
            }

            function onError() {
                finish(new Error("Failed to load " + script.src + "."));
            }

            script.addEventListener("load", onLoad);
            script.addEventListener("error", onError);
            if (window[globalName]) finish();
        });
    }

    function loadDependency(filename, globalName) {
        if (window[globalName]) return Promise.resolve(window[globalName]);

        var url = dependencyUrl(filename);
        var scripts = document.querySelectorAll(
            "script[data-crossnote-pseudocode-dependency]",
        );
        var script = null;
        for (var index = 0; index < scripts.length; index += 1) {
            if (
                scripts[index].dataset.crossnotePseudocodeDependency ===
                globalName
            ) {
                script = scripts[index];
                break;
            }
        }

        if (!script) {
            script = document.createElement("script");
            script.src = url;
            script.async = false;
            script.dataset.crossnotePseudocodeDependency = globalName;
            var pending = waitForScript(
                script,
                globalName,
                DEPENDENCY_TIMEOUT_MS,
            );
            document.head.appendChild(script);
            return pending;
        }
        return waitForScript(script, globalName, DEPENDENCY_TIMEOUT_MS);
    }

    function ensureDependencies() {
        if (window.katex && window.pseudocode) return Promise.resolve();
        if (dependencyPromise) return dependencyPromise;

        dependencyPromise = Promise.all([
            // The two vendor files are independent — pseudocode.js only touches
            // the katex global at render time, so load them in parallel.
            window.katex
                ? Promise.resolve(window.katex)
                : loadDependency("katex-0.16.47.min.js", "katex"),
            window.pseudocode
                ? Promise.resolve(window.pseudocode)
                : loadDependency("pseudocode-2.4.1.min.js", "pseudocode"),
        ])
            .then(function () {
                if (!window.katex || !window.pseudocode) {
                    throw new Error(
                        "KaTeX or pseudocode.js is unavailable after loading.",
                    );
                }
            })
            .catch(function (error) {
                dependencyPromise = null;
                throw error;
            });

        return dependencyPromise;
    }

    function removeExistingError(pre) {
        var previous = pre.previousElementSibling;
        if (previous && previous.classList.contains("pseudocode-error"))
            previous.remove();
    }

    function renderError(pre, error, retryable) {
        removeExistingError(pre);
        pre.dataset.pseudocodeRendered = retryable
            ? "dependency-error"
            : "source-error";
        pre.classList.add("pseudocode-source-error");

        var message = document.createElement("div");
        message.className = "pseudocode-error";
        message.setAttribute("role", "alert");

        var text = document.createElement("span");
        text.textContent =
            "Pseudocode render error: " + (error.message || String(error));
        message.appendChild(text);

        if (retryable) {
            var retry = document.createElement("button");
            retry.type = "button";
            retry.className = "pseudocode-retry";
            retry.textContent = "Retry";
            retry.addEventListener("click", retryDependencies);
            message.appendChild(retry);
        }
        pre.parentNode.insertBefore(message, pre);
    }

    function renderCode(code, captionIndex) {
        var pre = code.closest("pre");
        if (!pre || pre.dataset.pseudocodeRendered) return;

        try {
            // crossnote's fence renderer writes the full info string to data-info,
            // so `numbered`, `noend`, `title=...` etc. reach the DOM unchanged.
            // `{.cls #id}` fence attrs land on the <pre> — carry them to the figure.
            var customClasses = (pre.getAttribute("class") || "")
                .split(/\s+/)
                .filter(function (cls) {
                    return (
                        cls &&
                        cls.indexOf("language-") !== 0 &&
                        cls !== "pseudocode-source-error"
                    );
                })
                .join(" ");
            var html = renderFigureToHtml(
                code.textContent,
                (pre.dataset && pre.dataset.info) || "",
                captionIndex,
                pre.getAttribute("data-source-line"),
                { classes: customClasses, id: pre.id || null },
            );
            var template = document.createElement("template");
            template.innerHTML = html;
            // Drop a stale banner the prerender may have left in front of this pre
            // before swapping in the figure.
            removeExistingError(pre);
            pre.replaceWith(template.content.firstElementChild);
        } catch (error) {
            renderError(pre, error, false);
        }
    }

    // Re-stamps a rendered figure when insertion/removal above it changed its
    // position-derived number — the live counterpart of the parser's post-hoc
    // sentinel stamp. The caption <p> id, the figure's aria-labelledby, and
    // the emitted "Title N" keyword text move together; the visible number is
    // first-index + count - 1 (multi-\caption blocks consume that many).
    function restampFigure(figure, newIndex) {
        var oldFirst = parseInt(
            figure.getAttribute("data-caption-index") || "",
            10,
        );
        var count = parseInt(
            figure.getAttribute("data-caption-count") || "",
            10,
        );
        if (!isFinite(oldFirst)) return;
        if (!isFinite(count) || count < 1) count = 1;
        var newFirst = newIndex + 1;
        figure.setAttribute("data-caption-index", String(newFirst));

        var oldLabelId = "crossnote-pseudocode-caption-" + oldFirst;
        var newLabelId = "crossnote-pseudocode-caption-" + newFirst;
        // The caption <p> must come from THIS figure: a document-wide id lookup
        // races with the renumbering walk — a block rendered above may already
        // hold the id this figure is about to vacate, and getElementById returns
        // the first match in DOM order.
        var caption = figure.querySelector('[id="' + oldLabelId + '"]');
        if (figure.getAttribute("aria-labelledby") === oldLabelId) {
            figure.setAttribute("aria-labelledby", newLabelId);
        }
        if (!caption) return;
        caption.id = newLabelId;
        // The vendored renderer emits "${titlePrefix} ${number} " inside a
        // .ps-keyword span — the last digit run is the caption number.
        var keyword = caption.querySelector(".ps-keyword");
        if (keyword) {
            keyword.textContent = keyword.textContent.replace(
                /\d+(\s*)$/,
                String(newFirst + count - 1) + "$1",
            );
        }
    }

    function renderAll() {
        var blocks = document.querySelectorAll(BLOCK_SELECTOR);
        var captionIndex = 0;
        blocks.forEach(function (block) {
            // MPE stages each refresh in a hidden .hidden-preview buffer — blocks
            // rendered there are throwaway DOM and must not consume caption numbers.
            if (block.closest(".hidden-preview")) return;
            if (block.tagName === "CODE") {
                renderCode(block, captionIndex);
                captionIndex += Math.max(
                    countCaptionCommands(block.textContent || ""),
                    1,
                );
            } else {
                // Already-rendered figure: re-stamp when edits above shifted its
                // number, then advance by the count recorded at render time.
                var stored = parseInt(
                    block.getAttribute("data-caption-index") || "",
                    10,
                );
                var count = parseInt(
                    block.getAttribute("data-caption-count") || "",
                    10,
                );
                if (!isFinite(count) || count < 1) count = 1;
                if (isFinite(stored) && stored !== captionIndex + 1) {
                    restampFigure(block, captionIndex);
                }
                captionIndex += count;
            }
        });
    }

    function renderDependencyErrors(error) {
        document.querySelectorAll(SOURCE_SELECTOR).forEach(function (code) {
            if (code.closest(".hidden-preview")) return;
            var pre = code.closest("pre");
            if (!pre || pre.dataset.pseudocodeRendered === "source-error")
                return;
            renderError(pre, error, true);
        });
    }

    function runRender() {
        renderQueued = false;
        // Skip work when the only unrendered sources live in the hidden staging
        // buffer — the real render happens once they land in the visible preview.
        var pending = document.querySelectorAll(UNRENDERED_SOURCE_SELECTOR);
        for (var index = 0; index < pending.length; index += 1) {
            if (!pending[index].closest(".hidden-preview")) {
                // A dependency load can take seconds — don't stack a second
                // full-document renderAll on the same promise for every mutation
                // that arrives mid-flight; just re-check when it settles.
                if (renderInFlight) {
                    renderAgain = true;
                    return;
                }
                renderInFlight = true;
                ensureDependencies()
                    .then(renderAll)
                    .catch(renderDependencyErrors)
                    .then(function () {
                        renderInFlight = false;
                        if (renderAgain) {
                            renderAgain = false;
                            queueRender();
                        }
                    });
                return;
            }
        }
    }

    function queueRender() {
        if (renderQueued) return;
        renderQueued = true;
        window.requestAnimationFrame(runRender);
    }

    function retryDependencies() {
        dependencyPromise = null;
        document
            .querySelectorAll("script[data-crossnote-pseudocode-dependency]")
            .forEach(function (script) {
                var globalName = script.dataset.crossnotePseudocodeDependency;
                if (!window[globalName]) script.remove();
            });
        document
            .querySelectorAll(
                "pre[data-pseudocode-rendered='dependency-error']",
            )
            .forEach(function (pre) {
                removeExistingError(pre);
                pre.classList.remove("pseudocode-source-error");
                delete pre.dataset.pseudocodeRendered;
            });
        queueRender();
    }

    function nodeContainsSource(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        // The whole subtree is inside the staging buffer — never renders.
        if (node.closest(".hidden-preview")) return false;
        // A freshly rendered figure/error-marked pre cannot contain unrendered
        // sources — skip the subtree query entirely (figures are large: hundreds
        // of nodes per algorithm).
        if (
            node.hasAttribute &&
            node.hasAttribute("data-pseudocode-rendered")
        ) {
            return false;
        }
        if (node.matches(UNRENDERED_SOURCE_SELECTOR)) return true;
        var pending = node.querySelectorAll(UNRENDERED_SOURCE_SELECTOR);
        for (var index = 0; index < pending.length; index += 1) {
            if (!pending[index].closest(".hidden-preview")) return true;
        }
        return false;
    }

    function mutationNeedsRender(mutation) {
        if (mutation.type === "attributes") {
            // Only pre/code class changes can flip SOURCE_SELECTOR matching.
            if (!/^(pre|code)$/i.test(mutation.target.tagName || ""))
                return false;
            return nodeContainsSource(mutation.target);
        }
        // MPE stages each refresh in a hidden .hidden-preview buffer inside
        // document.body, then copies buffer.innerHTML into the visible preview —
        // that copy is a separate mutation on the visible side. Buffer-internal
        // mutations never reach users, so scanning them is wasted work.
        var target = mutation.target;
        if (target.closest && target.closest(".hidden-preview")) return false;
        for (var index = 0; index < mutation.addedNodes.length; index += 1) {
            if (nodeContainsSource(mutation.addedNodes[index])) return true;
        }
        return false;
    }

    function start() {
        if (!document.body) {
            document.addEventListener("DOMContentLoaded", start, {
                once: true,
            });
            return;
        }

        queueRender();
        if (observer) return;
        observer = new MutationObserver(function (mutations) {
            if (mutations.some(mutationNeedsRender)) queueRender();
        });
        // MPE may replace the preview root after imported scripts execute. Observe
        // the stable body, while mutationNeedsRender filters unrelated additions.
        observer.observe(document.body, {
            attributeFilter: ["class"],
            attributes: true,
            childList: true,
            subtree: true,
        });
        if (window.__crossnotePseudocodeRuntime) {
            window.__crossnotePseudocodeRuntime.observerActive = true;
        }
    }

    if (typeof window !== "undefined" && typeof document !== "undefined") {
        var existing = window.__crossnotePseudocodeRuntime;
        if (existing && existing.observerActive) {
            // A still-live document may re-execute this script — a version-skewed
            // copy whose export predates queueRender, or a same-version re-run.
            // Its observer owns the document; a second MutationObserver would
            // double every scan. Defer to it and just render when possible.
            if (typeof existing.queueRender === "function")
                existing.queueRender();
        } else {
            window.__crossnotePseudocodeRuntime = {
                inspectTextColors: function (source) {
                    var markers = [];
                    return {
                        markers: markers,
                        source: preprocessTextColors(source, markers),
                    };
                },
                selectors: { block: BLOCK_SELECTOR, source: SOURCE_SELECTOR },
                queueRender: queueRender,
                retryDependencies: retryDependencies,
                observerActive: false,
                version: 4,
            };

            start();
        }
    }

    // Node export used by .crossnote/scripts/check-pseudocode.cjs and tests.
    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            COLOR_ALIASES: COLOR_ALIASES,
            DEFAULT_RENDER_OPTIONS: DEFAULT_RENDER_OPTIONS,
            OPTION_FLAGS: OPTION_FLAGS,
            applyColorMarkersToMarkup: applyColorMarkersToMarkup,
            collectRenderOptionWarnings: collectRenderOptionWarnings,
            countCaptionCommands: countCaptionCommands,
            escapeHtml: escapeHtml,
            extractCaptionBody: extractCaptionBody,
            markerPrefix: markerPrefix,
            parseRenderOptions: parseRenderOptions,
            preprocessTextColors: preprocessTextColors,
            pseudocodeErrorHtml: pseudocodeErrorHtml,
            renderFigureToHtml: renderFigureToHtml,
            unescapeHtml: unescapeHtml,
        };
    }
})();
