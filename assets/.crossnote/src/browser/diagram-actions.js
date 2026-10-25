(function () {
    "use strict";
    if (window.__xnoteDiagramTools) return;
    var SVG_NS = "http://www.w3.org/2000/svg";
    var XHTML_NS = "http://www.w3.org/1999/xhtml";
    var SVG_STYLE = [
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-opacity",
        "stroke-width",
        "stroke-dasharray",
        "stroke-dashoffset",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-miterlimit",
        "opacity",
        "color",
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "font-variant",
        "letter-spacing",
        "word-spacing",
        "text-anchor",
        "dominant-baseline",
        "alignment-baseline",
        "text-decoration",
        "paint-order",
        "visibility",
        "display",
        "marker-start",
        "marker-mid",
        "marker-end",
        "clip-path",
        "mask",
        "filter",
    ];
    var HTML_STYLE = [
        "display",
        "position",
        "box-sizing",
        "width",
        "height",
        "min-width",
        "max-width",
        "min-height",
        "max-height",
        "margin",
        "padding",
        "border",
        "border-radius",
        "background-color",
        "color",
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "font-variant",
        "font-variant-numeric",
        "font-feature-settings",
        "line-height",
        "letter-spacing",
        "word-spacing",
        "white-space",
        "overflow",
        "overflow-wrap",
        "word-break",
        "text-align",
        "text-decoration",
        "text-transform",
        "vertical-align",
        "opacity",
        "visibility",
        "top",
        "left",
        "right",
        "bottom",
        "transform",
        "transform-origin",
        "flex-direction",
        "align-items",
        "justify-content",
        "gap",
    ];
    SVG_STYLE.push(
        "background-color",
        "stop-color",
        "stop-opacity",
        "flood-color",
        "flood-opacity",
        "lighting-color",
    );
    ["top", "right", "bottom", "left"].forEach(function (side) {
        ["width", "style", "color"].forEach(function (part) {
            HTML_STYLE.push("border-" + side + "-" + part);
        });
    });
    var colorCanvas = document.createElement("canvas");
    colorCanvas.width = colorCanvas.height = 1;
    var colorContext = colorCanvas.getContext("2d", {
        willReadFrequently: true,
    });

    function color(value) {
        if (!value || value === "none" || /url\(/i.test(value)) return value;
        if (!CSS.supports("color", value)) return value;
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = value;
        colorContext.fillRect(0, 0, 1, 1);
        var rgba = colorContext.getImageData(0, 0, 1, 1).data;
        return (
            "rgba(" +
            [rgba[0], rgba[1], rgba[2], +(rgba[3] / 255).toFixed(4)].join(",") +
            ")"
        );
    }

    function localUrls(value, ids) {
        return value.replace(/url\(["']?([^"')]+)["']?\)/g, function (_, ref) {
            var url = new URL(ref, document.baseURI);
            var id;
            try {
                id = decodeURIComponent(url.hash.slice(1));
            } catch (_) {
                id = "";
            }
            var sameDocument =
                ref.startsWith("#") ||
                [document.baseURI, location.href].some(function (base) {
                    return (
                        new URL(base).href.split("#")[0] ===
                        url.href.split("#")[0]
                    );
                });
            if (id && ids.has(id) && sameDocument)
                return 'url("#' + id.replace(/["\\]/g, "\\$&") + '")';
            if (url.protocol === "data:") return 'url("' + ref + '")';
            throw new Error(
                "图表包含外部样式资源，无法独立保存。请先将资源嵌入图表。",
            );
        });
    }

    function dataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                resolve(reader.result);
            };
            reader.onerror = function () {
                reject(new Error("读取图表资源失败。"));
            };
            reader.readAsDataURL(blob);
        });
    }

    async function resource(url) {
        var controller = new AbortController(),
            timer = setTimeout(function () {
                controller.abort();
            }, 10000);
        try {
            var response = await fetch(url, { signal: controller.signal });
            if (!response.ok) throw new Error("HTTP " + response.status);
            var blob = await response.blob();
            if (blob.size > 16 * 1024 * 1024) throw new Error("资源超过 16 MB");
            return blob;
        } finally {
            clearTimeout(timer);
        }
    }

    function families(value) {
        return (value.match(/"[^"]+"|'[^']+'|[^,]+/g) || []).map(function (v) {
            return v
                .trim()
                .replace(/^["']|["']$/g, "")
                .toLowerCase();
        });
    }

    async function embedFonts(used) {
        // System fonts stay named; loaded web fonts must travel with the SVG.
        var required = new Set();
        function key(family, style, weight, range) {
            return [
                family,
                style || "normal",
                weight || "normal",
                range || "U+0-10FFFF",
            ]
                .join("|")
                .replace(/\s/g, "")
                .toLowerCase();
        }
        document.fonts.forEach(function (face) {
            if (face.status === "loaded")
                families(face.family).forEach(function (f) {
                    if (used.has(f))
                        required.add(
                            key(f, face.style, face.weight, face.unicodeRange),
                        );
                });
        });
        if (!required.size) return "";
        var found = new Set(),
            visited = new Set(),
            output = [];
        async function scan(sheet, base) {
            if (!sheet || visited.has(sheet)) return;
            visited.add(sheet);
            base = sheet.href || base || document.baseURI;
            var rules;
            try {
                rules = sheet.cssRules;
            } catch (_) {
                if (!sheet.href) return;
                try {
                    var text = await (await resource(sheet.href)).text();
                    var parsed = new CSSStyleSheet();
                    parsed.replaceSync(text);
                    rules = parsed.cssRules;
                } catch (_) {
                    return;
                }
            }
            for (var rule of Array.from(rules || [])) {
                if (rule.type === 3) {
                    await scan(rule.styleSheet, base);
                    continue;
                }
                if (rule.type !== 5) {
                    if (rule.cssRules) await scan(rule, base);
                    continue;
                }
                var names = families(
                    rule.style.getPropertyValue("font-family"),
                );
                var keys = names.map(function (f) {
                    return key(
                        f,
                        rule.style.getPropertyValue("font-style"),
                        rule.style.getPropertyValue("font-weight"),
                        rule.style.getPropertyValue("unicode-range"),
                    );
                });
                if (
                    !keys.some(function (f) {
                        return required.has(f);
                    })
                )
                    continue;
                var source = rule.style.getPropertyValue("src");
                var match = /url\(["']?([^"')]+)["']?\)/.exec(source);
                if (match) {
                    var address = new URL(match[1], base).href;
                    if (!address.startsWith("data:"))
                        address = await dataUrl(await resource(address));
                    // Prefer the first provided web format; avoid fetching unused fallbacks.
                    var format = /^\s*format\(([^)]+)\)/.exec(
                        source.slice(match.index + match[0].length),
                    );
                    source =
                        'url("' +
                        address +
                        '")' +
                        (format ? " format(" + format[1] + ")" : "");
                } else if (!/local\(/.test(source)) continue;
                var declarations = [
                    "font-family",
                    "font-style",
                    "font-weight",
                    "font-stretch",
                    "unicode-range",
                ]
                    .map(function (key) {
                        var value = rule.style.getPropertyValue(key);
                        return value ? key + ":" + value + ";" : "";
                    })
                    .join("");
                output.push(
                    "@font-face{" + declarations + "src:" + source + ";}",
                );
                keys.forEach(function (f) {
                    found.add(f);
                });
            }
        }
        for (var sheet of Array.from(document.styleSheets)) await scan(sheet);
        if (
            Array.from(required).some(function (f) {
                return !found.has(f);
            })
        )
            throw new Error(
                "图表字体无法独立保存，请使用文档打印，或改用本地字体。",
            );
        return output.join("\n");
    }

    async function embedImage(node) {
        var html = node.namespaceURI === XHTML_NS;
        var ref = html
            ? node.getAttribute("src")
            : node.getAttribute("href") ||
              node.getAttributeNS("http://www.w3.org/1999/xlink", "href");
        if (!ref || ref.startsWith("#") || ref.startsWith("data:")) return;
        var controller = new AbortController();
        var timer = setTimeout(function () {
            controller.abort();
        }, 10000);
        try {
            var response = await fetch(new URL(ref, document.baseURI).href, {
                signal: controller.signal,
            });
            if (!response.ok) throw new Error("HTTP " + response.status);
            var blob = await response.blob();
            if (blob.size > 16 * 1024 * 1024) throw new Error("图像超过 16 MB");
            if (!blob.type.startsWith("image/"))
                throw new Error("资源不是图像");
            var encoded = await dataUrl(blob);
            node.setAttribute(html ? "src" : "href", encoded);
            if (!html)
                node.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
            if (html) node.removeAttribute("srcset");
        } catch (error) {
            throw new Error(
                "无法读取图中的外部图像。请先改用可离线访问的图像。 " +
                    error.message,
            );
        } finally {
            clearTimeout(timer);
        }
    }

    // Snapshot the already-laid-out diagram. No Mermaid initialization or rendering.
    async function snapshot(svg) {
        if (!svg || !svg.isConnected) throw new Error("图表已更新，请重试。");
        if (
            svg.querySelector(
                "foreignObject iframe, foreignObject object, foreignObject embed, foreignObject video, foreignObject canvas",
            )
        )
            throw new Error("图表包含动态内容，请使用文档打印保存。");
        var view = svg.viewBox.baseVal;
        var width = view.width || svg.getBoundingClientRect().width;
        var height = view.height || svg.getBoundingClientRect().height;
        if (!(width > 0 && height > 0 && Number.isFinite(width + height)))
            throw new Error("图表尚未完成布局，请稍后重试。");
        var clone = svg.cloneNode(true);
        var ids = new Set(
            Array.from(svg.querySelectorAll("[id]")).map(function (e) {
                return e.id;
            }),
        );
        ids.add(svg.id);
        var usedFonts = new Set();
        var original = [svg].concat(Array.from(svg.querySelectorAll("*")));
        var copies = [clone].concat(Array.from(clone.querySelectorAll("*")));
        original.forEach(function (node, index) {
            var target = copies[index];
            var computed = getComputedStyle(node);
            families(computed.fontFamily).forEach(function (f) {
                usedFonts.add(f);
            });
            target.removeAttribute("style");
            Array.from(target.attributes).forEach(function (attr) {
                if (/^on/i.test(attr.name)) target.removeAttribute(attr.name);
                else if (/url\(/i.test(attr.value))
                    target.setAttribute(attr.name, localUrls(attr.value, ids));
            });
            var properties =
                node.namespaceURI === XHTML_NS ? HTML_STYLE : SVG_STYLE;
            properties.forEach(function (property) {
                var value = computed.getPropertyValue(property);
                if (!value) return;
                if (
                    property === "fill" ||
                    property === "stroke" ||
                    property.includes("color")
                )
                    value = color(value);
                target.style.setProperty(property, localUrls(value, ids));
            });
            // CSS transforms override presentation attributes rather than composing
            // twice, so the computed matrix also freezes CSS-animated geometry.
            if (
                node.namespaceURI !== XHTML_NS &&
                computed.transform !== "none"
            ) {
                target.style.transform = computed.transform;
                target.style.transformOrigin = computed.transformOrigin;
            }
        });
        clone.querySelectorAll("style,script").forEach(function (e) {
            e.remove();
        });
        clone.querySelectorAll("a").forEach(function (a) {
            ["href", "xlink:href"].forEach(function (attr) {
                if (
                    /^\s*(javascript|vbscript|data):/i.test(
                        a.getAttribute(attr) || "",
                    )
                )
                    a.removeAttribute(attr);
            });
        });
        // Browser SVG images have a 300 px fallback when width remains 100%.
        clone.setAttribute("width", String(Math.ceil(width)));
        clone.setAttribute("height", String(Math.ceil(height)));
        clone.setAttribute("xmlns", SVG_NS);
        if (!clone.hasAttribute("viewBox"))
            clone.setAttribute("viewBox", "0 0 " + width + " " + height);
        clone.style.maxWidth = "none";
        clone.style.width = Math.ceil(width) + "px";
        clone.style.height = Math.ceil(height) + "px";
        // Composite the actual ancestor surfaces, including an author's native
        // diagram background, instead of assuming every canvas is the paper slot.
        var ancestors = [],
            current = svg;
        while (current) {
            ancestors.unshift(current);
            current = current.parentElement;
        }
        colorContext.clearRect(0, 0, 1, 1);
        colorContext.fillStyle = "#ffffff";
        colorContext.fillRect(0, 0, 1, 1);
        ancestors.forEach(function (node) {
            colorContext.fillStyle = getComputedStyle(node).backgroundColor;
            colorContext.fillRect(0, 0, 1, 1);
        });
        var rgba = colorContext.getImageData(0, 0, 1, 1).data;
        var paper = "rgb(" + [rgba[0], rgba[1], rgba[2]].join(",") + ")";
        var background = document.createElementNS(SVG_NS, "rect");
        background.setAttribute("x", String(view.x || 0));
        background.setAttribute("y", String(view.y || 0));
        background.setAttribute("width", String(width));
        background.setAttribute("height", String(height));
        background.setAttribute("fill", paper);
        clone.insertBefore(background, clone.firstChild);
        await Promise.all(
            Array.from(clone.querySelectorAll("image,img")).map(embedImage),
        );
        var fonts = await embedFonts(usedFonts);
        if (fonts) {
            var fontStyle = document.createElementNS(SVG_NS, "style");
            fontStyle.textContent = fonts;
            clone.insertBefore(fontStyle, clone.firstChild);
        }
        return {
            svg: new XMLSerializer().serializeToString(clone),
            paper: paper,
            width: Math.ceil(width),
            height: Math.ceil(height),
        };
    }

    function imageSource(result) {
        return (
            "data:image/svg+xml;charset=utf-8," + encodeURIComponent(result.svg)
        );
    }

    async function png(result) {
        var width = result.width * 2,
            height = result.height * 2;
        if (width > 16384 || height > 16384 || width * height > 32000000)
            throw new Error("图表过大，请保存 SVG。");
        // A self-contained data URL also supports HTML labels in Chromium without
        // the opaque-origin canvas taint introduced by a blob URL with foreignObject.
        var img = new Image();
        img.src = imageSource(result);
        await img.decode();
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        return new Promise(function (resolve, reject) {
            try {
                canvas.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error("PNG 生成失败，请保存 SVG。"));
                }, "image/png");
            } catch (_) {
                reject(
                    new Error(
                        "浏览器无法将这张图保存为 PNG，请保存 SVG 或打印文档。",
                    ),
                );
            }
        });
    }

    function download(blob, name) {
        var url = URL.createObjectURL(blob),
            link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 30000);
    }

    /* @xnote diagram-viewer */

    var pending = new WeakSet();
    var sourcePress = null;
    function sourceDiagram(target) {
        if (!(target instanceof Element)) return null;
        var container = target.closest(".mermaid");
        var svg = container && container.querySelector(":scope > svg");
        return svg &&
            svg.contains(target) &&
            !container.closest(".hidden-preview")
            ? container
            : null;
    }
    async function onAction(event) {
        var button = event.target.closest("button[data-xnote-diagram-action]");
        if (!button) {
            var source = sourceDiagram(event.target);
            if (
                !source ||
                event.defaultPrevented ||
                event.button > 0 ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                event.shiftKey
            )
                return;
            if (
                event.target.closest(
                    "a, button, input, textarea, select, [contenteditable], .clickable",
                )
            )
                return;
            var dragged =
                event.detail > 0 &&
                sourcePress &&
                sourcePress.container === source &&
                sourcePress.moved;
            sourcePress = null;
            var selection = window.getSelection();
            if (dragged || (selection && !selection.isCollapsed)) return;
            button = source.querySelector('[data-xnote-diagram-action="view"]');
            if (!button) return;
        }
        var container = button.closest(".mermaid");
        if (!container || pending.has(container)) return;
        pending.add(container);
        var status = container.querySelector(".xnote-diagram-status");
        var buttons = container.querySelectorAll(
            "button[data-xnote-diagram-action]",
        );
        buttons.forEach(function (b) {
            b.disabled = true;
        });
        status.textContent = "正在准备图表…";
        try {
            var svg = container.querySelector(":scope > svg");
            var result = await snapshot(svg);
            if (
                !svg.isConnected ||
                container.querySelector(":scope > svg") !== svg
            )
                throw new Error("图表已更新，请重试。");
            var action = button.dataset.xnoteDiagramAction;
            if (action === "view") openViewer(result, button);
            else {
                var blob =
                    action === "png"
                        ? await png(result)
                        : new Blob([result.svg], { type: "image/svg+xml" });
                var index =
                    Array.from(document.querySelectorAll(".mermaid")).indexOf(
                        container,
                    ) + 1;
                download(blob, "diagram-" + index + "." + action);
            }
            status.textContent = "";
        } catch (error) {
            status.textContent = error.message;
        } finally {
            pending.delete(container);
            buttons.forEach(function (b) {
                b.disabled = false;
            });
        }
    }

    function mount() {
        document.querySelectorAll(".mermaid").forEach(function (container) {
            if (
                container.closest(".hidden-preview") ||
                !container.querySelector(":scope > svg") ||
                container.querySelector(":scope > .xnote-diagram-tools")
            )
                return;
            var tools = document.createElement("div");
            tools.className = "xnote-diagram-tools";
            tools.innerHTML =
                '<button type="button" data-xnote-diagram-action="view">放大查看</button><button type="button" data-xnote-diagram-action="svg">保存 SVG</button><button type="button" data-xnote-diagram-action="png">保存 PNG</button><span class="xnote-diagram-status" role="status" aria-live="polite"></span>';
            container.appendChild(tools);
        });
    }
    var frame = 0;
    var observer = new MutationObserver(function (records) {
        var relevant = records.some(function (r) {
            return Array.from(r.addedNodes).some(function (n) {
                return (
                    n.nodeType === 1 &&
                    (n.matches("svg,.mermaid") || n.querySelector(".mermaid"))
                );
            });
        });
        if (relevant && !frame)
            frame = requestAnimationFrame(function () {
                frame = 0;
                mount();
            });
    });
    function boot() {
        mount();
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("click", onAction);
        document.addEventListener(
            "pointerdown",
            function (event) {
                var container = sourceDiagram(event.target);
                sourcePress =
                    container && event.button === 0
                        ? {
                              container: container,
                              id: event.pointerId,
                              x: event.clientX,
                              y: event.clientY,
                              moved: false,
                          }
                        : null;
            },
            true,
        );
        function trackSourceDrag(event) {
            if (
                sourcePress &&
                sourcePress.id === event.pointerId &&
                Math.hypot(
                    event.clientX - sourcePress.x,
                    event.clientY - sourcePress.y,
                ) >= 4
            )
                sourcePress.moved = true;
        }
        document.addEventListener("pointermove", trackSourceDrag, true);
        document.addEventListener("pointerup", trackSourceDrag, true);
        document.addEventListener(
            "pointercancel",
            function () {
                sourcePress = null;
            },
            true,
        );
        window.addEventListener("blur", function () {
            sourcePress = null;
        });
    }
    window.__xnoteDiagramTools = { snapshot: snapshot, png: png, mount: mount };
    if (document.body) boot();
    else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
