// Parser hook source. The build embeds the canonical pseudocode core and vendors.
(function () {
    // ======== BEGIN GENERATED — regenerate: npm run build:preview ========
    /* @xnote parser-core */
    // ======== END GENERATED ========

    var PSEUDOCODE_LANG_RE = /^pseudocode(?=[\s{]|$)/i;

    // Shape of rendered fences at onDidParseMarkdown time (crossnote's `sgi`
    // renderer + `wHs` post-pass):
    //   <pre data-role="codeBlock" data-info="<full info string>"
    //        data-source-line="N" class="language-pseudocode"><code>ESCAPED</code></pre>
    // Open-tag matching must be quote-aware: crossnote's escapeAttribute only
    // escapes " & and non-breaking space, so a literal `>` inside an attribute
    // value (e.g. data-info="pseudocode {key=>val}") is emitted verbatim and a
    // plain [^>]* would truncate the tag mid-attribute.
    var TAG_ATTRS = "(?:[^>\"']|\"[^\"]*\"|'[^']*')*";
    var CODEBLOCK_PRE = new RegExp(
        "<pre\\b" +
            TAG_ATTRS +
            '\\bdata-role="codeBlock"' +
            TAG_ATTRS +
            ">[\\s\\S]*?</pre>",
        "g",
    );
    var PRE_OPEN_TAG = new RegExp("^<pre\\b" + TAG_ATTRS + ">");
    var DATA_INFO = /\bdata-info="([^"]*)"/;
    var DATA_SOURCE_LINE = /\bdata-source-line="([^"]*)"/;
    var PRE_CLASS = /\bclass="([^"]*)"/;
    // \s-anchored, not \b: a `data-id=`/`x-id=` attribute would otherwise match
    // at the word boundary after `-`. Attrs on a <pre> tag are space-separated.
    var PRE_ID = /\sid="([^"]*)"/;
    var CODE_INNER = /<code\b[^>]*>([\s\S]*?)<\/code>/;
    // crossnote's _dt merges {data-source-line="N"} into the fence's data-info
    // on preview renders (HTML-escaped quotes). It is volatile — every line
    // edit above a block rewrites it — so it must stay out of the cache key.
    var DSL_IN_INFO =
        /\s*data-source-line=(?:(?:&quot;|"|')?\d+(?:&quot;|"|')?)/g;
    var FIGURE_OPEN_TAG = /<figure [^>]*>/;

    // Vendored KaTeX + pseudocode.js arrive as source strings (spliced in by
    // scripts/build.cjs) so their ~300KB eval is only paid by notebooks that
    // actually render a pseudocode block. The UMD wrappers probe
    // module/exports/define/window/global/self — direct eval here sees the
    // locals below, so every host (QuickJS sandbox, Node tests, browsers) lands
    // on the same branch: attach `katex`/`pseudocode` to globalThis via `self`.
    var vendoredGlobalsReady = false;
    function ensureVendoredGlobals() {
        if (vendoredGlobalsReady) return;
        var self = globalThis;
        var module, exports, require, define, window, global; // undefine UMD hosts
        eval(CROSSNOTE_KATEX_SRC);
        eval(CROSSNOTE_PSEUDOCODE_SRC);
        // Release ~640KB of source text — the compiled globals live on `self`.
        // If either eval throws we skip this, keeping the strings for the retry.
        CROSSNOTE_KATEX_SRC = null;
        CROSSNOTE_PSEUDOCODE_SRC = null;
        vendoredGlobalsReady = true;
    }

    // The QuickJS context persists for the notebook's lifetime, so module
    // state survives across renders: memoize the per-block KaTeX render
    // (~16ms/block interpreted). Figures are rendered with a sentinel caption
    // index and the real number is stamped post-hoc, so inserting a fence
    // above no longer invalidates every captioned block below it. The cache is
    // bounded by count and bytes — rendered figures can be tens of KB and the
    // sandbox caps at 64MB.
    var figureCache = new Map();
    var figureCacheBytes = 0;
    var FIGURE_CACHE_MAX = 512;
    var FIGURE_CACHE_BYTES = 16 * 1024 * 1024;
    var SOURCE_LINE_ATTR = / data-source-line="[^"]*"/;
    var CAPTION_SENTINEL = 7777777;
    var CAPTION_SENTINEL_NUM = String(CAPTION_SENTINEL + 1);

    function figureCacheSet(key, figure) {
        // .length counts UTF-16 code units; CJK-heavy figures cost ~2 bytes each
        // on the heap, so account double to keep the cap honest.
        figureCacheBytes += (key.length + figure.length) * 2;
        figureCache.set(key, figure);
        while (
            figureCache.size > FIGURE_CACHE_MAX ||
            figureCacheBytes > FIGURE_CACHE_BYTES
        ) {
            var oldest = figureCache.keys().next().value;
            figureCacheBytes -=
                (oldest.length + figureCache.get(oldest).length) * 2;
            figureCache.delete(oldest);
        }
    }

    // Replace each rendered ```pseudocode codeBlock with the same <figure> the
    // client runtime produces — so HTML/PDF exports and previews without
    // enablePreviewScripts still get rendered algorithms. Failures keep the raw
    // <pre> (the imported client runtime retries it in the preview) and prepend
    // an error banner.
    function prerenderPseudocode(html) {
        var captionIndex = 0;
        return html.replace(CODEBLOCK_PRE, function (block) {
            var openTag = PRE_OPEN_TAG.exec(block);
            if (!openTag) return block;
            var infoMatch = DATA_INFO.exec(openTag[0]);
            if (!infoMatch) return block;
            var rawInfo = infoMatch[1];
            // unescapeHtml only expands &…; entities, so a literal leading
            // "pseudocode" is unaffected — the raw attr gives the same verdict
            // without paying an unescape on every non-pseudocode block.
            if (!PSEUDOCODE_LANG_RE.test(rawInfo.trim())) return block;

            var codeMatch = CODE_INNER.exec(block);
            var rawSource = codeMatch
                ? codeMatch[1]
                : block.slice(openTag[0].length, block.lastIndexOf("</pre>"));
            // The vendored renderer bumps its caption counter once per \caption
            // command, so a block consumes that many numbers — advance ours the
            // same way or later blocks re-emit numbers already used.
            var captionCount = countCaptionCommands(rawSource);
            var index = captionIndex;
            captionIndex += captionCount > 0 ? captionCount : 1;
            var classMatch = PRE_CLASS.exec(openTag[0]);
            var rawClasses = classMatch ? classMatch[1] : "";
            var idMatch = PRE_ID.exec(openTag[0]);
            var rawId = idMatch ? idMatch[1] : "";
            var lineMatch = DATA_SOURCE_LINE.exec(openTag[0]);

            // The cache key is raw attribute text — escaping is deterministic, so
            // unescaping only needs to happen on the miss path. The volatile
            // per-render {data-source-line="N"} in data-info is stripped first:
            // keeping it would invalidate every block below any line edit.
            var key =
                rawInfo.replace(DSL_IN_INFO, "") +
                "\n" +
                rawClasses +
                "\n" +
                rawId +
                "\n" +
                rawSource;
            var figure = figureCache.get(key);
            if (figure !== undefined) {
                // LRU touch.
                figureCache.delete(key);
                figureCache.set(key, figure);
            } else {
                var info = unescapeHtml(rawInfo);
                var source = unescapeHtml(rawSource);
                // `{.cls #id}` fence attrs land on the <pre> — carry them to the figure.
                var customClasses = classMatch
                    ? unescapeHtml(rawClasses)
                          .split(/\s+/)
                          .filter(function (cls) {
                              return (
                                  cls &&
                                  cls.indexOf("language-") !== 0 &&
                                  cls !== "pseudocode-source-error"
                              );
                          })
                          .join(" ")
                    : "";
                var extra = {
                    classes: customClasses,
                    id: idMatch ? unescapeHtml(rawId) : null,
                };
                // The sentinel number renders as the caption ("Algorithm 7777778")
                // plus the caption's id and the figure's aria-labelledby — three
                // occurrences when a \caption is present, zero without. Counting
                // them can't distinguish our artifacts from content carrying the
                // same digits, so the collision check runs on the raw inputs
                // instead: sentinel-free input means every "7777778" in the output
                // is ours and safe to stamp. Dirty input bypasses the cache and
                // renders the real index directly.
                var sentinelDirty =
                    rawSource.indexOf(CAPTION_SENTINEL_NUM) !== -1 ||
                    rawInfo.indexOf(CAPTION_SENTINEL_NUM) !== -1 ||
                    rawClasses.indexOf(CAPTION_SENTINEL_NUM) !== -1 ||
                    rawId.indexOf(CAPTION_SENTINEL_NUM) !== -1 ||
                    // >1 \caption emits sentinel+2, sentinel+3, … which the post-hoc
                    // stamp (a single fixed number) can't cover — render the real
                    // index directly instead of leaking "Algorithm 7777779".
                    captionCount > 1;
                try {
                    ensureVendoredGlobals();
                    if (sentinelDirty) {
                        return renderFigureToHtml(
                            source,
                            info,
                            index,
                            lineMatch ? unescapeHtml(lineMatch[1]) : null,
                            extra,
                        );
                    }
                    figure = renderFigureToHtml(
                        source,
                        info,
                        CAPTION_SENTINEL,
                        null,
                        extra,
                    );
                } catch (error) {
                    return pseudocodeErrorHtml(error) + block;
                }
                figureCacheSet(key, figure);
            }
            // Stamp the real caption number and the current data-source-line onto
            // the cached figure (preview scroll-sync locates blocks by it).
            var stamped = figure;
            if (stamped.indexOf(CAPTION_SENTINEL_NUM) !== -1) {
                stamped = stamped
                    .split(CAPTION_SENTINEL_NUM)
                    .join(String(index + 1));
            }
            stamped = stamped.replace(SOURCE_LINE_ATTR, "");
            if (lineMatch) {
                // Append at the end of the opening tag — same attribute order as the
                // client runtime's renderFigureToHtml, so prerendered and live-rendered
                // markup stay byte-identical.
                stamped = stamped.replace(FIGURE_OPEN_TAG, function (tag) {
                    return (
                        tag.slice(0, -1) +
                        ' data-source-line="' +
                        escapeHtml(unescapeHtml(lineMatch[1])) +
                        '">'
                    );
                });
            }
            return stamped;
        });
    }

    return {
        onWillParseMarkdown: async function (markdown) {
            // || markdown: the QuickJS wrapper String()-coerces hook results — an
            // undefined return would silently replace the document with "undefined".
            return markdown;
        },

        onDidParseMarkdown: async function (html) {
            // Fast path: nothing that even looks like a pseudocode codeBlock —
            // indexOf over a regex scan (~5x cheaper interpreted on multi-MB html).
            // data-info is emitted trimmed, so "pseudocode" always starts the attr.
            // Case-insensitive fallback: ```Pseudocode lowercases to the same
            // language class, so it renders too — don't let the fast path drop it.
            if (
                html.indexOf('data-info="pseudocode') === -1 &&
                !/data-info="pseudocode/i.test(html)
            ) {
                return html;
            }
            return prerenderPseudocode(html) || html;
        },
    };
})();
