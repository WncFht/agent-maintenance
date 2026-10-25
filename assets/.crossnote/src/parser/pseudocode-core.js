// DOM-free pseudocode logic shared by the QuickJS and browser builds.
var COLOR_ALIASES = {
    red: "red",
    blue: "blue",
    green: "green",
    orange: "orange",
    purple: "purple",
    gray: "gray",
    grey: "gray",
};
var COMMAND = "\\textcolor";
var DEFAULT_RENDER_OPTIONS = {
    indentSize: "1.2em",
    lineNumber: false,
    noEnd: false,
    scopeLines: false,
    titlePrefix: "Algorithm",
};
// Fence info-string flags, e.g. ```pseudocode numbered noend
var OPTION_FLAGS = {
    numbered: { key: "lineNumber", value: true },
    linenum: { key: "lineNumber", value: true },
    noend: { key: "noEnd", value: true },
    scopelines: { key: "scopeLines", value: true },
};
var renderSequence = 0;
var OPTION_PAIR_RE = /^([A-Za-z]+)=(.+)$/;
var OPTION_PAIR_WARN_RE = /^([A-Za-z]+)=(.*)$/;
var BARE_WORD_RE = /^[A-Za-z]+$/;
var INDENT_EM_RE = /^\d*\.?\d+em$/;
var LINEPUNC_RE = /^[^\s{}\\]{1,4}$/;
var COMMENTDELIM_RE = /^[^\s{}\\]{1,6}$/;

function isEscaped(source, index) {
    var slashCount = 0;
    for (
        var cursor = index - 1;
        cursor >= 0 && source[cursor] === "\\";
        cursor -= 1
    ) {
        slashCount += 1;
    }
    return slashCount % 2 === 1;
}

function skipWhitespace(source, index) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    return index;
}

function readGroup(source, openIndex) {
    if (source[openIndex] !== "{") {
        throw new Error("Expected '{' after \\textcolor.");
    }

    var depth = 0;
    for (var index = openIndex; index < source.length; index += 1) {
        var character = source[index];
        if (character === "\\") {
            index += 1;
            continue;
        }
        if (character === "{") depth += 1;
        if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return {
                    value: source.slice(openIndex + 1, index),
                    end: index + 1,
                };
            }
        }
    }

    throw new Error("Unclosed group in \\textcolor.");
}

function findTextColorOutsideMath(source, fromIndex) {
    var mathMode = null;
    for (var index = fromIndex; index < source.length; index += 1) {
        // TeX-style line comment — the vendored lexer drops % to EOL anywhere
        // (math included), so a \textcolor inside one must never be marked.
        if (source[index] === "%" && !isEscaped(source, index)) {
            while (index < source.length && source[index] !== "\n") index += 1;
            continue;
        }
        if (source[index] === "\\" && !isEscaped(source, index)) {
            var pair = source.slice(index, index + 2);
            if (
                (mathMode === "paren" && pair === "\\)") ||
                (mathMode === "bracket" && pair === "\\]")
            ) {
                mathMode = null;
                index += 1;
                continue;
            }
            if (!mathMode && (pair === "\\(" || pair === "\\[")) {
                mathMode = pair === "\\(" ? "paren" : "bracket";
                index += 1;
                continue;
            }
            if (
                !mathMode &&
                source.slice(index, index + COMMAND.length) === COMMAND &&
                !/[A-Za-z]/.test(source[index + COMMAND.length] || "")
            ) {
                return index;
            }
            index += 1;
            continue;
        }

        if (source[index] === "$" && !isEscaped(source, index)) {
            var doubleDollar = source[index + 1] === "$";
            if (!mathMode) {
                mathMode = doubleDollar ? "double-dollar" : "dollar";
                if (doubleDollar) index += 1;
            } else if (
                (mathMode === "dollar" && !doubleDollar) ||
                (mathMode === "double-dollar" && doubleDollar)
            ) {
                mathMode = null;
                if (doubleDollar) index += 1;
            }
        }
    }
    return -1;
}

function markerPrefix(source) {
    var prefix;
    do {
        renderSequence += 1;
        prefix = "PSEUDOCOLOR" + renderSequence + "X";
    } while (source.indexOf(prefix) !== -1);
    return prefix;
}

// Parse the fence info string (e.g. "pseudocode numbered title=算法") into
// renderToString options. The first token is always the language name.
// `{...}` groups are crossnote's attribute syntax — bare flag words inside
// them ({numbered}) still count as flags; .class/#id/key=value attrs don't.
function parseRenderOptions(info) {
    var options = {
        indentSize: DEFAULT_RENDER_OPTIONS.indentSize,
        lineNumber: DEFAULT_RENDER_OPTIONS.lineNumber,
        noEnd: DEFAULT_RENDER_OPTIONS.noEnd,
        scopeLines: DEFAULT_RENDER_OPTIONS.scopeLines,
        titlePrefix: DEFAULT_RENDER_OPTIONS.titlePrefix,
    };
    var braceTokens = [];
    var stripped = (info || "").replace(/\{([^}]*)\}/g, function (_, inner) {
        var innerTokens = inner.trim().split(/\s+/);
        for (var i = 0; i < innerTokens.length; i += 1) {
            // only bare words — .class, #id, k=v stay crossnote's business
            if (BARE_WORD_RE.test(innerTokens[i]))
                braceTokens.push(innerTokens[i]);
        }
        return " ";
    });
    var tokens = stripped.trim().split(/\s+/).concat(braceTokens);
    tokens.shift();
    for (var index = 0; index < tokens.length; index += 1) {
        var token = tokens[index];
        if (!token) continue;
        var flag = OPTION_FLAGS[token.toLowerCase()];
        if (flag) {
            options[flag.key] = flag.value;
            continue;
        }
        var pair = token.match(OPTION_PAIR_RE);
        if (pair) {
            var name = pair[1].toLowerCase();
            var value = pair[2];
            if (name === "title") options.titlePrefix = value;
            // pseudocode.js _parseEmVal only accepts an `em` suffix and throws on
            // anything else — validate strictly here so bad input is ignored
            // instead of failing the whole render.
            else if (name === "indent" && INDENT_EM_RE.test(value)) {
                options.indentSize = value;
            } else if (name === "linepunc" && LINEPUNC_RE.test(value)) {
                options.lineNumberPunc = value;
            } else if (name === "commentdelim" && COMMENTDELIM_RE.test(value)) {
                options.commentDelimiter = value;
            }
        }
    }
    return options;
}

function preprocessTextColors(source, markers, prefix) {
    // Early-out: sources without \textcolor (the common case) skip the whole
    // char-walk and the markerPrefix probe entirely.
    if (source.indexOf(COMMAND) === -1) return source;
    var output = "";
    var cursor = 0;

    while (cursor < source.length) {
        var commandIndex = findTextColorOutsideMath(source, cursor);
        if (commandIndex === -1) {
            output += source.slice(cursor);
            break;
        }
        // Defer the collision-free prefix until the first real \textcolor —
        // most blocks never need one.
        if (prefix === undefined) prefix = markerPrefix(source);

        output += source.slice(cursor, commandIndex);
        var colorStart = skipWhitespace(source, commandIndex + COMMAND.length);
        var colorGroup = readGroup(source, colorStart);
        var colorName = colorGroup.value.trim().toLowerCase();
        var colorClass = COLOR_ALIASES[colorName];
        if (!colorClass) {
            throw new Error(
                "Unsupported text color '" +
                    colorGroup.value.trim() +
                    "'. Use red, blue, green, orange, purple, or gray.",
            );
        }

        var bodyStart = skipWhitespace(source, colorGroup.end);
        var bodyGroup = readGroup(source, bodyStart);
        // A % inside the body starts a comment — the close marker would land
        // inside it and be eaten by the lexer, surfacing as a cryptic
        // "discarded a text-color marker". Name the real cause instead.
        for (var ci = 0; ci < bodyGroup.value.length; ci += 1) {
            if (
                bodyGroup.value[ci] === "%" &&
                !isEscaped(bodyGroup.value, ci)
            ) {
                throw new Error(
                    "\\textcolor body contains a % comment — move the comment outside the colored group.",
                );
            }
        }
        var markerId = markers.length;
        var open = prefix + "OPEN" + markerId + "TOKEN";
        var close = prefix + "CLOSE" + markerId + "TOKEN";
        markers.push({ open: open, close: close, color: colorClass });

        output += open;
        output += preprocessTextColors(bodyGroup.value, markers, prefix);
        output += close;
        cursor = bodyGroup.end;
    }

    return output;
}

// Lint-side counterpart to parseRenderOptions: report tokens that will be
// ignored (invalid values, unknown options/flags) instead of silently doing
// nothing. `{...}` groups are crossnote's attribute syntax — stripped before
// scanning and never warned on.
function collectRenderOptionWarnings(info) {
    var warnings = [];
    // `{...}` is crossnote's attribute syntax, but bare words inside are
    // honored as flags by parseRenderOptions — collect them the same way so
    // a typo like {nubmered} warns instead of vanishing silently.
    var braceTokens = [];
    var stripped = (info || "").replace(/\{([^}]*)\}/g, function (_, inner) {
        var innerTokens = inner.trim().split(/\s+/);
        for (var i = 0; i < innerTokens.length; i += 1) {
            if (BARE_WORD_RE.test(innerTokens[i]))
                braceTokens.push(innerTokens[i]);
        }
        return " ";
    });
    var tokens = stripped.trim().split(/\s+/).concat(braceTokens);
    tokens.shift();
    for (var index = 0; index < tokens.length; index += 1) {
        var token = tokens[index];
        if (!token) continue;
        if (OPTION_FLAGS[token.toLowerCase()]) continue;
        var pair = token.match(OPTION_PAIR_WARN_RE);
        if (pair) {
            var name = pair[1].toLowerCase();
            var value = pair[2];
            if (name === "title") {
                if (!value) warnings.push("title= needs a non-empty value");
            } else if (name === "indent") {
                if (!INDENT_EM_RE.test(value)) {
                    warnings.push(
                        "indent=" +
                            value +
                            " ignored — only em units (e.g. indent=1.5em)",
                    );
                }
            } else if (name === "linepunc") {
                if (!LINEPUNC_RE.test(value)) {
                    warnings.push(
                        "linepunc=" +
                            value +
                            " ignored — 1–4 chars, no space/{}/\\",
                    );
                }
            } else if (name === "commentdelim") {
                if (!COMMENTDELIM_RE.test(value)) {
                    warnings.push(
                        "commentdelim=" +
                            value +
                            " ignored — 1–6 chars, no space/{}/\\",
                    );
                }
            } else {
                warnings.push(
                    "unknown option '" +
                        name +
                        "=' — known: title, indent, linepunc, commentdelim",
                );
            }
            continue;
        }
        warnings.push(
            "unknown flag '" +
                token +
                "' — known: numbered, linenum, noend, scopelines",
        );
    }
    return warnings;
}

// Marker tokens are plain ASCII and land in text nodes only, so they survive
// pseudocode.renderToString verbatim. Replacing them in the rendered string
// (innermost first) yields the same spans the old DOM Range pass produced.
function applyColorMarkersToMarkup(markup, markers) {
    for (var index = markers.length - 1; index >= 0; index -= 1) {
        var marker = markers[index];
        var openIndex = markup.indexOf(marker.open);
        var closeIndex = markup.indexOf(
            marker.close,
            openIndex === -1 ? 0 : openIndex,
        );
        if (openIndex === -1 || closeIndex === -1) {
            throw new Error(
                "The pseudocode renderer discarded a text-color marker.",
            );
        }
        markup =
            markup.slice(0, openIndex) +
            '<span class="ps-manual-color ps-color-' +
            marker.color +
            '">' +
            markup.slice(openIndex + marker.open.length, closeIndex) +
            "</span>" +
            markup.slice(closeIndex + marker.close.length);
    }
    return markup;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function unescapeHtml(text) {
    return (
        String(text)
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
                return String.fromCodePoint(parseInt(hex, 16));
            })
            .replace(/&#(\d+);/g, function (_, dec) {
                return String.fromCodePoint(parseInt(dec, 10));
            })
            // The serializer's escapeText/escapeAttribute map U+00A0 to the named
            // entity — the only named one beyond the XML five it emits.
            .replace(/&nbsp;/g, "\u00a0")
            .replace(/&amp;/g, "&")
    );
}

// Replicates the figure semantics the DOM pass added: the caption is the
// first .ps-line inside .ps-algorithm.with-caption; it gets an id the
// <figure> can point at via aria-labelledby.
function addFigureSemanticsToMarkup(markup, captionIndex) {
    var labelId = null;
    var captionDiv = markup.indexOf("ps-algorithm with-caption");
    if (captionDiv !== -1) {
        var lineRe = /<p\b[^>]*\bclass="[^"]*\bps-line\b[^"]*"/g;
        lineRe.lastIndex = captionDiv;
        var match = lineRe.exec(markup);
        if (match) {
            labelId = "crossnote-pseudocode-caption-" + (captionIndex + 1);
            var tagEnd = markup.indexOf(">", match.index + match[0].length);
            markup =
                markup.slice(0, tagEnd) +
                ' id="' +
                labelId +
                '"' +
                markup.slice(tagEnd);
        }
    }
    return { markup: markup, labelId: labelId };
}

function pseudocodeErrorHtml(error) {
    var message =
        "Pseudocode render error: " +
        (error && error.message ? error.message : String(error));
    return (
        '<div class="pseudocode-error" role="alert"><span>' +
        escapeHtml(message) +
        "</span></div>"
    );
}

// The single render pipeline shared by the browser runtime and the parser's
// onDidParseMarkdown prerender: preprocess colors, render with pseudocode.js,
// re-materialize the color spans, wrap in a <figure> with a11y attributes.
// `extra` optionally carries {classes, id} from the source <pre> — crossnote
// puts `{.cls #id}` fence attrs there and they should survive onto the
// figure so user CSS keeps working. Returns the figure HTML; throws on
// source errors.
function renderFigureToHtml(source, info, captionIndex, sourceLine, extra) {
    var markers = [];
    var prepared = preprocessTextColors(source, markers);
    var options = parseRenderOptions(info);
    options.captionCount = captionIndex;
    var markup = pseudocode.renderToString(prepared, options);
    markup = applyColorMarkersToMarkup(markup, markers);
    var semantics = addFigureSemanticsToMarkup(markup, captionIndex);

    var customClasses =
        extra && extra.classes
            ? " " + extra.classes.trim().split(/\s+/).map(escapeHtml).join(" ")
            : "";
    var attrs =
        'class="crossnote-pseudocode' +
        customClasses +
        '"' +
        ' data-pseudocode-rendered="true" role="figure"' +
        // Position bookkeeping for the browser runtime's re-stamp pass: the
        // first caption number this block consumed (1-based, same value the
        // parser's sentinel stamp writes) and how many numbers it consumes.
        ' data-caption-index="' +
        (captionIndex + 1) +
        '"' +
        ' data-caption-count="' +
        countCaptionCommands(source) +
        '"';
    if (extra && extra.id) {
        attrs += ' id="' + escapeHtml(extra.id) + '"';
    }
    if (semantics.labelId) {
        attrs += ' aria-labelledby="' + semantics.labelId + '"';
    } else {
        attrs += ' aria-label="Pseudocode algorithm"';
    }
    if (sourceLine) {
        attrs += ' data-source-line="' + escapeHtml(sourceLine) + '"';
    }
    return "<figure " + attrs + ">" + semantics.markup + "</figure>";
}

// Returns the brace-balanced body of the first \caption{...}, or null when
// absent or unclosed. Shared with check-pseudocode.cjs for the `Semantics:`
// provenance lint.
function extractCaptionBody(source) {
    var captionIndex = source.indexOf("\\caption{");
    if (captionIndex === -1) return null;
    var depth = 0;
    for (
        var index = captionIndex + "\\caption".length;
        index < source.length;
        index += 1
    ) {
        var character = source[index];
        if (character === "\\") {
            index += 1;
            continue;
        }
        if (character === "{") depth += 1;
        else if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return source.slice(captionIndex + "\\caption{".length, index);
            }
        }
    }
    return null;
}

// Counts \caption commands outside % comments — the vendored renderer bumps
// its caption counter once per \caption, so consumers advancing a shared
// caption index across blocks must step by max(this, 1) per block.
function countCaptionCommands(source) {
    var stripped = String(source).replace(/(^|[^\\])%[^\n]*/g, "$1");
    var matches = stripped.match(/\\caption\b/g);
    return matches ? matches.length : 0;
}
