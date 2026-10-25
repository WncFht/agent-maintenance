#!/usr/bin/env node
"use strict";

// Explicit deployment of a verified build. Never write through a source link.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const SOURCE = path.resolve(__dirname, "..");
const MANIFEST = ".xnote-manifest.json";
const digest = (bytes) =>
    crypto.createHash("sha256").update(bytes).digest("hex");
const exists = (file) => {
    try {
        return fs.lstatSync(file);
    } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
    }
};

function manifest(file) {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
        value.version !== 1 ||
        !value.files ||
        Array.isArray(value.files) ||
        typeof value.files !== "object"
    )
        throw new Error("Invalid manifest: " + file);
    for (const [name, hash] of Object.entries(value.files)) {
        if (
            !name
                .split("/")
                .every(
                    (part) =>
                        /^[\w.-]+$/.test(part) && part !== "." && part !== "..",
                ) ||
            !/^[a-f0-9]{64}$/.test(hash)
        )
            throw new Error("Invalid manifest entry: " + name);
    }
    if (!Object.keys(value.files).length)
        throw new Error("Empty manifest: " + file);
    return value;
}

const STUBS = {
    "parser.js":
        "({ // Please visit the URL below for more information:\n // https://shd101wyy.github.io/markdown-preview-enhanced/#/extend-parser\n onWillParseMarkdown: async function(markdown) { return markdown; }, onDidParseMarkdown: async function(html) { return html; }, })",
    "config.js":
        '({ katexConfig: {"macros": {}}, mathjaxConfig: {"tex": {}, "options": {}, "loader": {}}, mermaidConfig: {"startOnLoad": false}, })',
    "style.less":
        "/* Please visit the URL below for more information: */ /* https://shd101wyy.github.io/markdown-preview-enhanced/#/customize-css */ .markdown-preview.markdown-preview { // modify your style here // eg: background-color: blue; }",
    "head.html":
        '<!-- The content below will be included at the end of the <head> element. --> <script type="text/javascript"> document.addEventListener("DOMContentLoaded", function () { // your code here }); </script>',
};
function filler(name, bytes) {
    const compact = bytes.toString("utf8").replace(/\s/g, "");
    return (
        !compact || (STUBS[name] && compact === STUBS[name].replace(/\s/g, ""))
    );
}

function plan(target) {
    const destination = path.join(target, ".crossnote");
    if (
        destination === SOURCE ||
        (exists(destination) &&
            fs.realpathSync(destination) === fs.realpathSync(SOURCE))
    )
        throw new Error(
            "Target is the maintained source; choose a project directory.",
        );
    if (exists(destination)?.isSymbolicLink())
        throw new Error(
            "The .crossnote directory is a symlink. Materialize the directory before synchronizing.",
        );
    if (exists(destination) && !fs.statSync(destination).isDirectory())
        throw new Error(".crossnote is not a directory.");
    const bundle = manifest(path.join(SOURCE, "bundle.json"));
    const previousFile = path.join(destination, MANIFEST);
    if (exists(previousFile)?.isSymbolicLink())
        throw new Error("Deployment manifest must not be a symlink.");
    const previous = exists(previousFile)
        ? manifest(previousFile)
        : { files: {} };
    const legacy = manifest(path.join(SOURCE, "src/legacy-deployment.json"));
    const buffers = new Map();
    const conflicts = [];
    const directories = new Set();
    const changes = [];
    for (const [name, expected] of Object.entries(bundle.files)) {
        const sourceFile = path.join(SOURCE, name);
        if (!exists(sourceFile)?.isFile())
            throw new Error("Missing build file: " + name);
        const bytes = fs.readFileSync(sourceFile);
        if (digest(bytes) !== expected)
            throw new Error(
                "Build is stale at " +
                    name +
                    ". Run scripts/build.cjs in the maintenance repository.",
            );
        buffers.set(name, bytes);
        let parent = path.dirname(name);
        while (parent !== ".") {
            const directory = path.join(destination, parent),
                stat = exists(directory);
            if (stat?.isSymbolicLink()) {
                if (
                    fs.realpathSync(directory) !==
                    fs.realpathSync(path.join(SOURCE, parent))
                )
                    conflicts.push(
                        parent + " is linked to an unrelated directory",
                    );
                else directories.add(parent);
            } else if (stat && !stat.isDirectory())
                conflicts.push(parent + " is not a directory");
            parent = path.dirname(parent);
        }
        const file = path.join(destination, name),
            stat = exists(file);
        let current = null;
        if (stat) {
            if (!fs.statSync(file).isFile()) {
                conflicts.push(name + " is not a file");
                continue;
            }
            const old = fs.readFileSync(file);
            current = digest(old);
            if (
                current !== expected &&
                current !== previous.files[name] &&
                current !== legacy.files[name] &&
                !filler(name, old)
            )
                conflicts.push(name + " has local changes");
        }
        if (
            !stat ||
            current !== expected ||
            stat.isSymbolicLink() ||
            stat.nlink > 1
        )
            changes.push({ name, current, remove: false });
    }
    const obsolete = new Set([
        ...Object.keys(previous.files).filter(
            (name) => !(name in bundle.files),
        ),
        "scripts/build-parser.cjs",
        "scripts/patch-mpe-globalcss-dedupe.cjs",
    ]);
    for (const name of obsolete) {
        const file = path.join(destination, name);
        if (!exists(file)) continue;
        if (!fs.statSync(file).isFile()) {
            conflicts.push(name + " is not a file");
            continue;
        }
        const current = digest(fs.readFileSync(file));
        if ([...directories].some((dir) => name.startsWith(dir + "/")))
            continue;
        if (current !== previous.files[name] && current !== legacy.files[name])
            conflicts.push(name + " is an edited obsolete file");
        else changes.push({ name, current, remove: true });
    }
    // Files underneath an old source-directory symlink must all be materialized.
    for (const name of buffers.keys())
        if (
            [...directories].some((dir) => name.startsWith(dir + "/")) &&
            !changes.some((c) => c.name === name)
        )
            changes.push({
                name,
                current: digest(fs.readFileSync(path.join(destination, name))),
                remove: false,
            });
    if (conflicts.length)
        throw new Error(
            "No files changed. Resolve conflicts first:\n  " +
                [...new Set(conflicts)].join("\n  "),
        );
    const manifestText = JSON.stringify(bundle, null, 2) + "\n";
    const manifestChanged =
        !exists(previousFile) ||
        fs.readFileSync(previousFile, "utf8") !== manifestText;
    return {
        destination,
        changes,
        directories: [...directories].sort((a, b) => a.length - b.length),
        buffers,
        manifestText,
        manifestChanged,
    };
}

function deploy(target) {
    const lock = path.join(target, ".crossnote-sync.lock");
    try {
        fs.mkdirSync(lock);
    } catch (e) {
        if (e.code === "EEXIST")
            throw new Error(
                "Synchronization is locked: " +
                    lock +
                    ". Check for an active sync before removing a stale lock.",
            );
        throw e;
    }
    const undo = [],
        created = [];
    let stage,
        rollbackFailed = false;
    try {
        fs.writeFileSync(
            path.join(lock, "owner.json"),
            JSON.stringify({
                pid: process.pid,
                hostname: require("node:os").hostname(),
            }),
        );
        const work = plan(target); // Revalidate after acquiring the lock.
        stage = fs.mkdtempSync(path.join(target, ".crossnote-sync-"));
        function mkdir(directory) {
            if (exists(directory)) return;
            mkdir(path.dirname(directory));
            fs.mkdirSync(directory);
            created.push(directory);
        }
        mkdir(work.destination);
        for (const dir of work.directories) {
            // Nested directories under a detached link no longer need detaching.
            const dest = path.join(work.destination, dir);
            if (!exists(dest)?.isSymbolicLink()) continue;
            const backup = path.join(stage, "backup-" + undo.length);
            fs.renameSync(dest, backup);
            undo.push({ dest, backup, directory: true });
            fs.mkdirSync(dest);
        }
        const operations = work.changes.concat({
            name: MANIFEST,
            remove: false,
            manifest: true,
        });
        for (const item of operations) {
            const dest = path.join(work.destination, item.name);
            const detached = work.directories.some((dir) =>
                item.name.startsWith(dir + "/"),
            );
            if (!item.manifest && !detached) {
                const current = exists(dest)
                    ? digest(fs.readFileSync(dest))
                    : null;
                if (current !== item.current)
                    throw new Error(
                        "File changed during synchronization: " + item.name,
                    );
            }
            if (item.remove && !exists(dest)) continue;
            mkdir(path.dirname(dest));
            let backup = null;
            if (exists(dest)) {
                backup = path.join(stage, "backup-" + undo.length);
                fs.renameSync(dest, backup);
            }
            undo.push({ dest, backup, directory: false });
            if (!item.remove) {
                const temporary = path.join(stage, "new-" + undo.length);
                fs.writeFileSync(
                    temporary,
                    item.manifest
                        ? work.manifestText
                        : work.buffers.get(item.name),
                );
                fs.renameSync(temporary, dest);
            }
        }
        console.log(
            `Synchronized ${work.changes.length} files to ${work.destination}`,
        );
    } catch (error) {
        const problems = [];
        for (const entry of undo.reverse()) {
            try {
                if (exists(entry.dest)) {
                    if (entry.directory) fs.rmdirSync(entry.dest);
                    else fs.unlinkSync(entry.dest);
                }
                if (entry.backup) fs.renameSync(entry.backup, entry.dest);
            } catch (e) {
                problems.push(entry.dest + ": " + e.message);
            }
        }
        for (const directory of created.reverse()) {
            try {
                fs.rmdirSync(directory);
            } catch (e) {
                if (!["ENOENT", "ENOTEMPTY"].includes(e.code))
                    problems.push(directory + ": " + e.message);
            }
        }
        rollbackFailed = problems.length > 0;
        throw new Error(
            error.message +
                (rollbackFailed
                    ? "\nRecovery needs attention; backups retained at " +
                      stage +
                      "\n" +
                      problems.join("\n")
                    : "\nManaged changes rolled back."),
        );
    } finally {
        if (!rollbackFailed) {
            if (stage) fs.rmSync(stage, { recursive: true, force: true });
            fs.rmSync(lock, { recursive: true, force: true });
        }
    }
}

function main(args = process.argv.slice(2)) {
    let target,
        check = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--target" && args[i + 1])
            target = path.resolve(args[++i]);
        else if (args[i] === "--check") check = true;
        else throw new Error("Usage: sync.cjs --target PROJECT [--check]");
    }
    if (!target || !fs.statSync(target).isDirectory())
        throw new Error("--target must name an existing project directory.");
    const work = plan(target);
    if (
        !work.changes.length &&
        !work.directories.length &&
        !work.manifestChanged
    ) {
        console.log("Crossnote deployment is current: " + work.destination);
        return;
    }
    if (check)
        throw new Error(
            "Deployment differs; run sync without --check:\n  " +
                work.changes
                    .map((c) => (c.remove ? "remove " : "update ") + c.name)
                    .concat(work.manifestChanged ? ["update " + MANIFEST] : [])
                    .join("\n  "),
        );
    deploy(target);
}
if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
module.exports = { main, plan, deploy };
