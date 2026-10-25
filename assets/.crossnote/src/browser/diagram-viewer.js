// Included inside diagram-actions' closure; the host still loads one lazy module.
var viewerSequence = 0;
var closeViewer = null;
var viewerCSS = /* @xnote viewer-css */ "";

function selectableNodes(svg) {
    var selectors = {
        "flowchart-v2": "g.node",
        flowchart: "g.node",
        stateDiagram: "g.node, g.statediagram-cluster",
        class: "g.node, g.classGroup",
        classDiagram: "g.node, g.classGroup",
        er: "g.node, g.entityBox",
        sequence: "g:has(> rect.actor), g:has(> text.actor)",
    };
    var selector = selectors[svg.getAttribute("aria-roledescription")];
    return selector ? Array.from(svg.querySelectorAll(selector)) : [];
}

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
    dialog.dataset.xnoteViewer = "";
    // Load geometry with its controller, not with MPE's independently cached
    // document stylesheet. The extra scope also overrides legacy viewer rules.
    var viewerStyle = document.createElement("style");
    viewerStyle.textContent = viewerCSS;
    dialog.setAttribute("aria-label", "图表查看器");
    dialog.innerHTML =
        '<div class="xnote-diagram-controls"><div class="xnote-zoom-group"><button type="button" data-view="out" aria-label="缩小" title="缩小">−</button><button type="button" data-view="zoom-menu" class="xnote-diagram-scale" aria-label="缩放比例" aria-haspopup="dialog" aria-expanded="false"><span class="xnote-diagram-scale-value"></span><span class="xnote-zoom-chevron" aria-hidden="true"></span></button><button type="button" data-view="in" aria-label="放大" title="放大">+</button><div class="xnote-zoom-menu" role="dialog" aria-label="缩放比例" hidden><div class="xnote-zoom-custom"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="自定义缩放百分比"><span aria-hidden="true">%</span><button type="button" data-view="zoom-apply">应用</button></div><div class="xnote-zoom-presets">' +
        [25, 50, 75, 100, 125, 150, 200, 400]
            .map(function (percent) {
                return (
                    '<button type="button" data-view="' +
                    (percent === 100 ? "actual" : "zoom-preset") +
                    '" data-scale="' +
                    percent / 100 +
                    '" aria-pressed="false">' +
                    percent +
                    "%</button>"
                );
            })
            .join("") +
        '</div><button type="button" data-view="zoom-fit" aria-pressed="false">适合窗口</button></div></div><button type="button" data-view="fit" title="适合窗口">全图</button><button type="button" data-view="minimap" aria-expanded="false">小地图</button><button type="button" data-view="close" aria-label="关闭查看器" title="关闭">×</button></div>' +
        '<div class="xnote-diagram-stage"><div class="xnote-diagram-viewport" tabindex="0" role="region" aria-label="图表画布，双指移动，捏合缩放；方向键按箭头方向移动图片，加减号缩放，0 查看全图"><div class="xnote-diagram-scene"></div><div class="xnote-diagram-selection" hidden></div></div><aside class="xnote-diagram-minimap" hidden><div class="xnote-diagram-minimap-heading"><span>图表导航</span><button type="button" data-view="minimap" aria-label="收起小地图">×</button></div><svg viewBox="0 0 220 140" width="220" height="140" tabindex="0" role="region" aria-label="小地图：点击定位，拖动视口框导航；方向键按箭头方向移动图片"><image preserveAspectRatio="none"/><rect class="xnote-minimap-image-bounds"/><rect class="xnote-minimap-view"/></svg></aside>' +
        '<div class="xnote-diagram-selection-tools" hidden><span role="status" aria-live="polite"></span><button type="button" data-view="copy" title="复制节点文字">复制</button><button type="button" data-view="clear" aria-label="清除选择" title="清除选择">×</button></div></div>';
    var viewport = dialog.querySelector(".xnote-diagram-viewport");
    // The snapshot already composites the author's actual paper color. Extend
    // that same surface across the canvas instead of showing a second rectangle.
    if (result.paper) viewport.style.backgroundColor = result.paper;
    var scene = dialog.querySelector(".xnote-diagram-scene");
    var outline = dialog.querySelector(".xnote-diagram-selection");
    var scaleLabel = dialog.querySelector(".xnote-diagram-scale-value");
    var zoomToggle = dialog.querySelector('[data-view="zoom-menu"]');
    var zoomMenu = dialog.querySelector(".xnote-zoom-menu");
    var zoomInput = zoomMenu.querySelector("input");
    zoomMenu.id = "xnote-zoom-" + viewerSequence;
    zoomToggle.setAttribute("aria-controls", zoomMenu.id);
    var minimapPanel = dialog.querySelector(".xnote-diagram-minimap");
    var minimap = minimapPanel.querySelector("svg");
    var minimapImage = minimap.querySelector("image");
    var minimapView = minimap.querySelector(".xnote-minimap-view");
    var minimapBounds = minimap.querySelector(".xnote-minimap-image-bounds");
    var minimapToggle = dialog.querySelector('[data-view="minimap"]');
    minimapPanel.id = "xnote-minimap-" + viewerSequence;
    minimapToggle.setAttribute("aria-controls", minimapPanel.id);
    if (result.paper) minimap.style.backgroundColor = result.paper;
    var minimapGeometry = null,
        minimapDrag = null;
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
        wheel = null,
        suppressClick = false;
    var selected = null,
        selectionBounds = null;
    var abort = new AbortController();
    var nodes = selectableNodes(svg);
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
    function on(target, type, handler, options) {
        target.addEventListener(
            type,
            handler,
            Object.assign({ signal: abort.signal }, options),
        );
    }
    function closeZoomMenu(restoreFocus) {
        zoomMenu.hidden = true;
        zoomToggle.setAttribute("aria-expanded", "false");
        zoomInput.setCustomValidity("");
        if (restoreFocus) zoomToggle.focus({ preventScroll: true });
    }
    function applyZoomInput() {
        var value = zoomInput.value.trim();
        var percent = Number(value.replace(/%$/, "").trim());
        if (
            !/^(?:\d+(?:\.\d*)?|\.\d+)\s*%?$/.test(value) ||
            !Number.isFinite(percent) ||
            percent <= 0
        ) {
            zoomInput.setCustomValidity("请输入大于 0 的缩放百分比");
            zoomInput.reportValidity();
            return;
        }
        zoomAt(percent / 100, center());
        closeZoomMenu(false);
        viewport.focus({ preventScroll: true });
    }
    on(zoomInput, "input", function () {
        zoomInput.setCustomValidity("");
    });
    on(
        window,
        "pointerdown",
        function (event) {
            if (
                !zoomMenu.hidden &&
                !zoomMenu.contains(event.target) &&
                !zoomToggle.contains(event.target)
            )
                closeZoomMenu(false);
        },
        { capture: true },
    );
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
            (percent < 10 ? Number(percent.toFixed(6)) : Math.round(percent)) +
            "%";
        if (scaleLabel.textContent !== label) {
            scaleLabel.textContent = label;
            zoomToggle.setAttribute("aria-label", "缩放比例：" + label);
        }
        if (document.activeElement !== zoomInput)
            zoomInput.value = label.replace("%", "");
        if (!zoomMenu.hidden) {
            zoomMenu
                .querySelectorAll("[data-scale]")
                .forEach(function (button) {
                    button.setAttribute(
                        "aria-pressed",
                        String(
                            state.mode === "manual" &&
                                Math.abs(
                                    state.k - Number(button.dataset.scale),
                                ) < 0.000001,
                        ),
                    );
                });
            zoomMenu
                .querySelector('[data-view="zoom-fit"]')
                .setAttribute("aria-pressed", String(state.mode === "fit"));
        }
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
        paintMinimap();
    }
    function worldViewport() {
        return {
            x: -state.x / state.k,
            y: -state.y / state.k,
            width: width / state.k,
            height: height / state.k,
        };
    }
    function mapRect(element, x, y, w, h) {
        element.setAttribute("x", x);
        element.setAttribute("y", y);
        element.setAttribute("width", w);
        element.setAttribute("height", h);
    }
    function paintMinimap() {
        if (minimapPanel.hidden || !width || !height) return;
        var view = worldViewport();
        // Include both the picture and the visible world, even after free pan
        // moves the picture offscreen. Freeze this mapping during a map drag so
        // resizing the overview cannot move the grabbed point under the cursor.
        if (minimapDrag) minimapGeometry = minimapDrag.geometry;
        else {
            var x = Math.min(0, view.x),
                y = Math.min(0, view.y);
            var w = Math.max(result.width, view.x + view.width) - x;
            var h = Math.max(result.height, view.y + view.height) - y;
            var k = Math.min(204 / w, 124 / h);
            minimapGeometry = {
                k: k,
                x: (220 - w * k) / 2 - x * k,
                y: (140 - h * k) / 2 - y * k,
            };
        }
        var m = minimapGeometry;
        mapRect(
            minimapImage,
            m.x,
            m.y,
            result.width * m.k,
            result.height * m.k,
        );
        mapRect(
            minimapBounds,
            m.x,
            m.y,
            result.width * m.k,
            result.height * m.k,
        );
        mapRect(
            minimapView,
            m.x + view.x * m.k,
            m.y + view.y * m.k,
            view.width * m.k,
            view.height * m.k,
        );
    }
    function mapPoint(event) {
        var r = minimap.getBoundingClientRect();
        return {
            x: ((event.clientX - r.left) * 220) / r.width,
            y: ((event.clientY - r.top) * 140) / r.height,
        };
    }
    function centerOn(point) {
        wheel = null;
        state.x = width / 2 - point.x * state.k;
        state.y = height / 2 - point.y * state.k;
        state.mode = "manual";
        schedule();
    }
    function endMinimapDrag() {
        var old = minimapDrag;
        minimapDrag = null;
        if (old && minimap.hasPointerCapture(old.id))
            minimap.releasePointerCapture(old.id);
        if (old) schedule();
    }
    on(minimap, "pointerdown", function (event) {
        if (event.button !== 0 || minimapDrag || minimapPanel.hidden) return;
        consume(event);
        endDrag();
        wheel = null;
        flush();
        minimap.focus({ preventScroll: true });
        var p = mapPoint(event),
            m = minimapGeometry,
            view = worldViewport();
        var inside =
            p.x >= m.x + view.x * m.k - 4 &&
            p.x <= m.x + (view.x + view.width) * m.k + 4 &&
            p.y >= m.y + view.y * m.k - 4 &&
            p.y <= m.y + (view.y + view.height) * m.k + 4;
        var target = inside
            ? { x: view.x + view.width / 2, y: view.y + view.height / 2 }
            : { x: (p.x - m.x) / m.k, y: (p.y - m.y) / m.k };
        minimapDrag = {
            id: event.pointerId,
            geometry: m,
            start: p,
            center: target,
            clientX: event.clientX,
            clientY: event.clientY,
            moved: false,
        };
        if (!inside) centerOn(target);
        minimap.setPointerCapture(event.pointerId);
    });
    on(minimap, "pointermove", function (event) {
        if (!minimapDrag || minimapDrag.id !== event.pointerId) return;
        var p = mapPoint(event),
            d = minimapDrag;
        if (
            !d.moved &&
            Math.hypot(event.clientX - d.clientX, event.clientY - d.clientY) < 4
        )
            return;
        d.moved = true;
        centerOn({
            x: d.center.x + (p.x - d.start.x) / d.geometry.k,
            y: d.center.y + (p.y - d.start.y) / d.geometry.k,
        });
    });
    on(minimap, "pointerup", function (event) {
        if (!minimapDrag || minimapDrag.id !== event.pointerId) return;
        if (!minimapDrag.moved) {
            var p = mapPoint(event),
                m = minimapDrag.geometry;
            centerOn({ x: (p.x - m.x) / m.k, y: (p.y - m.y) / m.k });
        }
        endMinimapDrag();
    });
    on(minimap, "pointercancel", endMinimapDrag);
    on(minimap, "lostpointercapture", endMinimapDrag);
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
        schedule();
    }
    function pan(dx, dy) {
        state.x += dx;
        state.y += dy;
        state.mode = "manual";
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
        selectionTools.querySelectorAll("button").forEach(function (button) {
            button.disabled = !node;
        });
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
        endMinimapDrag();
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
            if (event.composedPath().includes(zoomMenu)) {
                if (event.ctrlKey || event.metaKey) consume(event);
                return;
            }
            if (
                !event.composedPath().includes(viewport) &&
                !event.composedPath().includes(minimap)
            )
                return;
            consume(event);
            if (drag || minimapDrag) return;
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
        suppressClick = false;
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
    on(
        window,
        "dblclick",
        function (event) {
            if (
                (!event.composedPath().includes(viewport) &&
                    !event.composedPath().includes(minimap)) ||
                event.button !== 0
            )
                return;
            consume(event);
            // Keep MPE's source-navigation double-click out of the modal.
        },
        { capture: true },
    );
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
        suppressClick = true;
        if (click) select(node);
    });
    on(viewport, "pointercancel", endDrag);
    on(viewport, "lostpointercapture", endDrag);
    on(viewport, "click", function (event) {
        // Trackpad/accessibility click-only activation has no pointer candidate.
        // Pointer capture may retarget a drag's click to the viewport: ignore it.
        if (event.detail === 0 || !suppressClick) select(pick(event.target));
        suppressClick = false;
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
            if (event.key === "Escape" && dialog.open) {
                consume(event);
                if (!zoomMenu.hidden) closeZoomMenu(true);
                else dialog.close();
                return;
            }
            if (event.target === zoomInput && event.key === "Enter") {
                consume(event);
                applyZoomInput();
                return;
            }
            if (!dialog.contains(event.target)) return;
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
            if (event.target !== viewport && event.target !== minimap) return;
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
                    key === "ArrowLeft" ? -40 : key === "ArrowRight" ? 40 : 0,
                    key === "ArrowUp" ? -40 : key === "ArrowDown" ? 40 : 0,
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
        else if (action === "zoom-menu") {
            if (!zoomMenu.hidden) closeZoomMenu(true);
            else {
                zoomMenu.hidden = false;
                flush();
                zoomToggle.setAttribute("aria-expanded", "true");
                zoomInput.value = String(Number((state.k * 100).toFixed(6)));
                zoomInput.setCustomValidity("");
                zoomInput.focus({ preventScroll: true });
                zoomInput.select();
            }
        } else if (action === "zoom-apply") applyZoomInput();
        else if (action === "zoom-preset" || action === "actual") {
            zoomAt(Number(button.dataset.scale), center());
            closeZoomMenu(false);
            viewport.focus({ preventScroll: true });
        } else if (action === "zoom-fit") {
            fit();
            closeZoomMenu(false);
            viewport.focus({ preventScroll: true });
        } else if (action === "minimap") {
            endMinimapDrag();
            minimapPanel.hidden = !minimapPanel.hidden;
            minimapToggle.setAttribute(
                "aria-expanded",
                String(!minimapPanel.hidden),
            );
            if (!minimapPanel.hidden && !minimapImage.hasAttribute("href"))
                minimapImage.setAttribute("href", imageSource(result));
            if (
                minimapPanel.hidden &&
                minimapPanel.contains(document.activeElement)
            )
                minimapToggle.focus({ preventScroll: true });
            schedule();
        } else if (action === "fit") fit();
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
        } else if (action === "in" || action === "out")
            zoomAt(state.k * (action === "in" ? 1.25 : 0.8), center());
    });
    on(dialog, "cancel", function (event) {
        event.preventDefault();
        dialog.close();
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
        viewerStyle.remove();
        if (closeViewer === dispose) closeViewer = null;
        if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    }
    on(dialog, "close", dispose);
    document.head.appendChild(viewerStyle);
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
