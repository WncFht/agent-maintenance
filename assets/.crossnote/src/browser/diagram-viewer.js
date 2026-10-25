// Included inside diagram-actions' closure; the host still loads one lazy module.
var viewerSequence = 0;
var closeViewer = null;

function viewerSvg(result) {
    var parsed = new DOMParser().parseFromString(result.svg, "image/svg+xml");
    if (parsed.querySelector("parsererror"))
        throw new Error("图表快照无法读取，请重试。");
    var svg = document.importNode(parsed.documentElement, true);
    var prefix = "xnote-view-" + ++viewerSequence + "-";
    var ids = new Map();
    [svg]
        .concat(Array.from(svg.querySelectorAll("[id]")))
        .forEach(function (node, i) {
            if (node.id) {
                ids.set(node.id, prefix + i);
                node.id = prefix + i;
            }
        });
    // The inline snapshot shares a document with the source SVG. Namespace its
    // references as well as IDs, otherwise markers and accessibility labels can
    // resolve to the hidden source. Viewer nodes never execute author callbacks.
    [svg]
        .concat(Array.from(svg.querySelectorAll("*")))
        .forEach(function (node) {
            Array.from(node.attributes).forEach(function (attr) {
                var value = attr.value.replace(
                    /url\(\s*(["']?)#([^\s)'"]+)\1\s*\)/g,
                    function (_, quote, id) {
                        return 'url("#' + (ids.get(id) || id) + '")';
                    },
                );
                if (/^(href|xlink:href)$/.test(attr.name) && value[0] === "#")
                    value = "#" + (ids.get(value.slice(1)) || value.slice(1));
                if (/^aria-(labelledby|describedby)$/.test(attr.name))
                    value = value
                        .split(/\s+/)
                        .map(function (id) {
                            return ids.get(id) || id;
                        })
                        .join(" ");
                node.setAttribute(attr.name, value);
                if (/^on/i.test(attr.name) || attr.name === "tabindex")
                    node.removeAttribute(attr.name);
            });
        });
    svg.querySelectorAll(
        "script,animate,animateMotion,animateTransform,set",
    ).forEach(function (node) {
        node.remove();
    });
    svg.querySelectorAll("a").forEach(function (node) {
        node.removeAttribute("href");
        node.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
    });
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "图表放大视图");
    return svg;
}

function openViewer(result, returnFocus) {
    var svg = viewerSvg(result);
    if (closeViewer) closeViewer();
    var dialog = document.createElement("dialog");
    // MPE's CSS zoom synchronizer recognizes .fixed elements.
    dialog.className = "xnote-diagram-dialog fixed";
    dialog.setAttribute("aria-label", "图表查看器");
    dialog.innerHTML =
        '<div class="xnote-diagram-controls"><button type="button" data-view="out" aria-label="缩小">−</button><output class="xnote-diagram-scale" aria-label="缩放比例"></output><button type="button" data-view="in" aria-label="放大">+</button><button type="button" data-view="fit">全图</button><button type="button" data-view="actual">100%</button><button type="button" data-view="close">关闭</button></div>' +
        '<div class="xnote-diagram-hint">双指移动 · 捏合缩放 · 拖动平移 · 0 全图</div>' +
        '<div class="xnote-diagram-viewport" tabindex="0" role="region" aria-label="图表画布，双指移动，捏合缩放；方向键移动，加减号缩放，0 查看全图"><div class="xnote-diagram-scene"></div><div class="xnote-diagram-selection" hidden></div></div>' +
        '<div class="xnote-diagram-selection-tools" hidden><span role="status" aria-live="polite"></span><button type="button" data-view="selection">定位选中项</button><button type="button" data-view="copy">复制文字</button><button type="button" data-view="clear">清除选择</button></div>';
    var viewport = dialog.querySelector(".xnote-diagram-viewport");
    var scene = dialog.querySelector(".xnote-diagram-scene");
    var outline = dialog.querySelector(".xnote-diagram-selection");
    var scaleLabel = dialog.querySelector("output");
    var selectionTools = dialog.querySelector(".xnote-diagram-selection-tools");
    var selectionLabel = selectionTools.querySelector('[role="status"]');
    scene.appendChild(svg);
    scene.style.width = result.width + "px";
    scene.style.height = result.height + "px";
    var state = { x: 0, y: 0, k: 1, mode: "fit" };
    var width = 0,
        height = 0,
        frame = 0,
        disposed = false;
    var drag = null,
        space = false,
        physicalControl = false,
        wheel = null;
    var selected = null,
        selectionBounds = null;
    var abort = new AbortController();
    var nodes =
        svg.getAttribute("aria-roledescription") === "flowchart-v2"
            ? Array.from(svg.querySelectorAll("g.node"))
            : [];
    var labels = new Map();
    nodes.forEach(function (node, index) {
        var label = node.querySelector(".nodeLabel") || node;
        labels.set(
            node,
            label.textContent.replace(/\s+/g, " ").trim() ||
                "节点 " + (index + 1),
        );
        node.setAttribute("tabindex", index === 0 ? "0" : "-1");
        node.setAttribute("role", "button");
        node.setAttribute("aria-label", labels.get(node));
        node.setAttribute("aria-pressed", "false");
        node.dataset.xnotePick = "";
    });
    if (nodes.length)
        dialog.querySelector(".xnote-diagram-hint").append(" · 单击节点高亮");
    function on(target, type, handler, options) {
        target.addEventListener(
            type,
            handler,
            Object.assign({ signal: abort.signal }, options),
        );
    }
    function fitScale() {
        return Math.max(
            0.000001,
            Math.min(
                Math.max(1, width - 48) / result.width,
                Math.max(1, height - 48) / result.height,
                1,
            ),
        );
    }
    function boundedScale(k) {
        return Math.max(Math.min(0.1, fitScale() / 4), Math.min(8, k));
    }
    function clampAxis(value, size, content) {
        return content <= size - 48
            ? (size - content) / 2
            : Math.min(24, Math.max(size - content - 24, value));
    }
    function constrain() {
        state.x = clampAxis(state.x, width, result.width * state.k);
        state.y = clampAxis(state.y, height, result.height * state.k);
    }
    function paint() {
        frame = 0;
        if (disposed) return;
        scene.style.transform =
            "translate(" +
            state.x +
            "px," +
            state.y +
            "px) scale(" +
            state.k +
            ")";
        var percent = state.k * 100;
        var label =
            (percent < 10 ? percent.toFixed(1) : Math.round(percent)) + "%";
        if (scaleLabel.textContent !== label) scaleLabel.textContent = label;
        if (selectionBounds) {
            outline.hidden = false;
            outline.style.transform =
                "translate(" +
                (state.x + selectionBounds.x * state.k - 3) +
                "px," +
                (state.y + selectionBounds.y * state.k - 3) +
                "px)";
            outline.style.width = selectionBounds.width * state.k + 6 + "px";
            outline.style.height = selectionBounds.height * state.k + 6 + "px";
        } else outline.hidden = true;
    }
    function schedule() {
        if (!frame && !disposed) frame = requestAnimationFrame(paint);
    }
    function flush() {
        if (frame) cancelAnimationFrame(frame);
        paint();
    }
    function fit() {
        state.k = fitScale();
        state.x = (width - result.width * state.k) / 2;
        state.y = (height - result.height * state.k) / 2;
        state.mode = "fit";
        wheel = null;
        schedule();
    }
    function center() {
        return { x: width / 2, y: height / 2 };
    }
    function zoomAt(next, point) {
        var k = boundedScale(next);
        var ratio = k / state.k;
        state.x = point.x - (point.x - state.x) * ratio;
        state.y = point.y - (point.y - state.y) * ratio;
        state.k = k;
        state.mode = "manual";
        constrain();
        schedule();
    }
    function pan(dx, dy) {
        state.x += dx;
        state.y += dy;
        state.mode = "manual";
        constrain();
        schedule();
    }
    function local(event) {
        var rect = viewport.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) * width) / rect.width,
            y: ((event.clientY - rect.top) * height) / rect.height,
            sx: width / rect.width,
            sy: height / rect.height,
        };
    }
    function resize() {
        // clientWidth/Height round to integers. Fractional grid tracks would
        // otherwise change pan distance and make the selection outline drift.
        var computed = getComputedStyle(viewport);
        var w = parseFloat(computed.width),
            h = parseFloat(computed.height);
        if (w <= 0 || h <= 0 || (width === w && height === h)) return;
        var q = {
            x: (width / 2 - state.x) / state.k,
            y: (height / 2 - state.y) / state.k,
        };
        width = w;
        height = h;
        if (state.mode === "fit") fit();
        else {
            state.k = boundedScale(state.k);
            state.x = width / 2 - q.x * state.k;
            state.y = height / 2 - q.y * state.k;
            constrain();
            schedule();
        }
    }
    function sizeDialog() {
        // MPE zooms .fixed elements; dimensions in vw/vh would then exceed the
        // physical viewport. Account for CSS zoom without mixing in Retina DPR.
        var zoom = 1,
            node = dialog;
        while (node) {
            zoom *= parseFloat(getComputedStyle(node).zoom) || 1;
            node = node.parentElement;
        }
        var w = ((window.innerWidth * 0.94) / zoom).toFixed(3) + "px";
        var h = ((window.innerHeight * 0.9) / zoom).toFixed(3) + "px";
        if (parseFloat(dialog.style.width) !== parseFloat(w))
            dialog.style.width = w;
        if (parseFloat(dialog.style.height) !== parseFloat(h))
            dialog.style.height = h;
    }
    function pick(target) {
        var node =
            target instanceof Element && target.closest("[data-xnote-pick]");
        return labels.has(node) ? node : null;
    }
    function select(node) {
        if (selected) selected.setAttribute("aria-pressed", "false");
        selected = node;
        selectionBounds = null;
        if (node) {
            flush();
            var r = node.getBoundingClientRect(),
                v = viewport.getBoundingClientRect();
            selectionBounds = {
                x: (((r.left - v.left) * width) / v.width - state.x) / state.k,
                y: (((r.top - v.top) * height) / v.height - state.y) / state.k,
                width: (r.width * width) / v.width / state.k,
                height: (r.height * height) / v.height / state.k,
            };
            node.setAttribute("aria-pressed", "true");
            nodes.forEach(function (item) {
                item.setAttribute("tabindex", item === node ? "0" : "-1");
            });
            selectionLabel.textContent = labels.get(node);
        } else selectionLabel.textContent = "";
        selectionTools.hidden = !node;
        schedule();
    }
    function focusSelection() {
        if (!selectionBounds) return;
        var b = selectionBounds;
        state.k = boundedScale(
            Math.min(
                (width - 96) / Math.max(1, b.width),
                (height - 96) / Math.max(1, b.height),
                2,
            ),
        );
        state.x = width / 2 - (b.x + b.width / 2) * state.k;
        state.y = height / 2 - (b.y + b.height / 2) * state.k;
        state.mode = "manual";
        constrain();
        schedule();
    }
    function endDrag() {
        var old = drag;
        drag = null;
        viewport.classList.remove("dragging");
        if (old && viewport.hasPointerCapture(old.id))
            viewport.releasePointerCapture(old.id);
    }
    function resetInput() {
        endDrag();
        space = false;
        physicalControl = false;
        wheel = null;
    }
    function consume(event) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
    }
    // MPE 0.8.40 consumes Ctrl/Meta-wheel at document capture. Own the canvas
    // earlier, at window capture, and update here rather than relying on a target
    // listener that stopPropagation would prevent from running.
    on(
        window,
        "wheel",
        function (event) {
            if (!event.composedPath().includes(viewport)) return;
            consume(event);
            if (drag) return;
            var mode = event.deltaMode;
            var dx = event.deltaX,
                dy = event.deltaY;
            if (!Number.isFinite(dx + dy) || (!dx && !dy)) return;
            var now = performance.now();
            var kind = dy && (event.ctrlKey || event.metaKey) ? "zoom" : "pan";
            if (event.momentum === true) {
                if (!wheel) return; // Tail of a gesture that began outside this viewer.
                kind = wheel.kind;
            } else if (
                typeof event.momentum !== "boolean" &&
                wheel &&
                wheel.kind === "pan" &&
                now - wheel.time < 120 &&
                (event.metaKey || (event.ctrlKey && physicalControl))
            ) {
                // Older engines lack native momentum. Preserve a recent pan when a
                // physical modifier arrives; synthetic Ctrl pinch can switch at once.
                kind = "pan";
            }
            wheel = { kind: kind, time: now };
            var p = local(event);
            if (kind === "zoom") {
                if (!dy) return;
                var delta = dy * (mode === 1 ? 16 : mode === 2 ? height : 1);
                // Chromium encodes pinch as -100*log(scale). Never quantize to sign
                // or infer mouse hardware from delta frequency/fractional values.
                zoomAt(
                    state.k * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.003)),
                    p,
                );
            } else {
                dx *= mode === 1 ? 16 : mode === 2 ? width : 1;
                dy *= mode === 1 ? 16 : mode === 2 ? height : 1;
                if (event.shiftKey && !dx) {
                    dx = dy;
                    dy = 0;
                }
                pan(-dx * p.sx, -dy * p.sy);
            }
        },
        { capture: true, passive: false },
    );
    on(viewport, "pointerdown", function (event) {
        if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.pointerType === "touch" ||
            drag
        )
            return;
        event.preventDefault();
        wheel = null;
        viewport.focus({ preventScroll: true });
        drag = {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            lastX: event.clientX,
            lastY: event.clientY,
            moved: false,
            candidate: space ? null : pick(event.target),
            selecting: !space,
        };
        viewport.setPointerCapture(event.pointerId);
    });
    on(viewport, "pointermove", function (event) {
        if (!drag || drag.id !== event.pointerId) return;
        var distance = Math.hypot(
            event.clientX - drag.startX,
            event.clientY - drag.startY,
        );
        if (!drag.moved && distance < 4) return;
        drag.moved = true;
        viewport.classList.add("dragging");
        var p = local(event);
        pan(
            (event.clientX - drag.lastX) * p.sx,
            (event.clientY - drag.lastY) * p.sy,
        );
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
    });
    on(viewport, "pointerup", function (event) {
        if (!drag || drag.id !== event.pointerId) return;
        var click =
                !drag.moved &&
                drag.selecting &&
                Math.hypot(
                    event.clientX - drag.startX,
                    event.clientY - drag.startY,
                ) < 4,
            node = drag.candidate;
        endDrag();
        if (click) select(node);
    });
    on(viewport, "pointercancel", endDrag);
    on(viewport, "lostpointercapture", endDrag);
    on(viewport, "click", function (event) {
        if (event.detail === 0 && pick(event.target))
            select(pick(event.target));
    });
    on(viewport, "focusin", function (event) {
        var node = pick(event.target);
        if (!node) return;
        flush();
        var r = node.getBoundingClientRect(),
            v = viewport.getBoundingClientRect();
        if (
            r.left < v.left ||
            r.right > v.right ||
            r.top < v.top ||
            r.bottom > v.bottom
        )
            pan(
                ((v.left + v.width / 2 - r.left - r.width / 2) * width) /
                    v.width,
                ((v.top + v.height / 2 - r.top - r.height / 2) * height) /
                    v.height,
            );
    });
    on(
        window,
        "keydown",
        function (event) {
            if (event.key === "Control") physicalControl = true;
            if (!dialog.contains(event.target)) return;
            if (event.key === "Escape") {
                consume(event);
                if (selected) {
                    select(null);
                    viewport.focus({ preventScroll: true });
                } else dialog.close();
                return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            var node = pick(event.target);
            if (
                node &&
                [
                    "Enter",
                    " ",
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                ].includes(event.key)
            ) {
                consume(event);
                if (event.key === "Enter" || event.key === " ") select(node);
                else {
                    var offset = ["ArrowLeft", "ArrowUp"].includes(event.key)
                        ? -1
                        : 1;
                    var next =
                        nodes[
                            (nodes.indexOf(node) + offset + nodes.length) %
                                nodes.length
                        ];
                    nodes.forEach(function (item) {
                        item.setAttribute(
                            "tabindex",
                            item === next ? "0" : "-1",
                        );
                    });
                    next.focus({ preventScroll: true });
                }
                return;
            }
            if (event.target !== viewport) return;
            var key = event.key;
            if (
                ![
                    " ",
                    "+",
                    "=",
                    "-",
                    "0",
                    "1",
                    "ArrowLeft",
                    "ArrowRight",
                    "ArrowUp",
                    "ArrowDown",
                ].includes(key)
            )
                return;
            consume(event);
            if (key === " ") space = true;
            else if (key === "0") fit();
            else if (key === "1") zoomAt(1, center());
            else if (key === "+" || key === "=")
                zoomAt(state.k * 1.25, center());
            else if (key === "-") zoomAt(state.k / 1.25, center());
            else
                pan(
                    key === "ArrowLeft" ? 40 : key === "ArrowRight" ? -40 : 0,
                    key === "ArrowUp" ? 40 : key === "ArrowDown" ? -40 : 0,
                );
        },
        { capture: true },
    );
    on(
        window,
        "keyup",
        function (event) {
            if (event.key === " ") space = false;
            if (event.key === "Control") physicalControl = false;
        },
        { capture: true },
    );
    on(window, "blur", resetInput);
    on(window, "resize", sizeDialog);
    on(document, "visibilitychange", function () {
        if (document.hidden) resetInput();
    });
    on(dialog, "click", async function (event) {
        var button = event.target.closest("button[data-view]");
        if (!button) return;
        var action = button.dataset.view;
        if (action === "close") dialog.close();
        else if (action === "fit") fit();
        else if (action === "actual") zoomAt(1, center());
        else if (action === "selection") focusSelection();
        else if (action === "clear") {
            select(null);
            viewport.focus({ preventScroll: true });
        } else if (action === "copy") {
            var node = selected;
            if (!node) return;
            try {
                await navigator.clipboard.writeText(labels.get(node));
                if (!disposed && selected === node)
                    selectionLabel.textContent = "已复制：" + labels.get(node);
            } catch (_) {
                if (!disposed && selected === node)
                    selectionLabel.textContent =
                        "复制不可用，请在原文中复制：" + labels.get(node);
            }
        } else zoomAt(state.k * (action === "in" ? 1.25 : 0.8), center());
    });
    on(dialog, "cancel", function (event) {
        event.preventDefault();
        if (selected) select(null);
        else dialog.close();
    });
    var resizeObserver = new ResizeObserver(resize);
    var removalObserver = new MutationObserver(function () {
        if (!dialog.isConnected) dispose();
        else sizeDialog();
    });
    function dispose() {
        if (disposed) return;
        disposed = true;
        abort.abort();
        resizeObserver.disconnect();
        removalObserver.disconnect();
        if (frame) cancelAnimationFrame(frame);
        resetInput();
        dialog.remove();
        if (closeViewer === dispose) closeViewer = null;
        if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    }
    on(dialog, "close", dispose);
    document.body.appendChild(dialog);
    closeViewer = dispose;
    dialog.showModal();
    sizeDialog();
    resize();
    flush();
    viewport.focus({ preventScroll: true });
    resizeObserver.observe(viewport);
    removalObserver.observe(document.body, {
        childList: true,
        attributes: true,
        attributeFilter: ["style", "class"],
    });
    removalObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["style", "class"],
    });
    removalObserver.observe(dialog, {
        attributes: true,
        attributeFilter: ["style"],
    });
}
