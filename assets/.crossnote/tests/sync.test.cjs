"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const ROOT = path.resolve(__dirname, "..");
function fixture(t) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xnote-sync-"));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const source = path.join(temp, "source"),
        target = path.join(temp, "project");
    fs.cpSync(ROOT, source, { recursive: true });
    fs.mkdirSync(target);
    const script = path.join(source, "scripts/sync.cjs");
    const run = (...flags) =>
        spawnSync(process.execPath, [script, "--target", target, ...flags], {
            encoding: "utf8",
        });
    const edit = (name, extra) => {
        const p = path.join(source, name);
        fs.writeFileSync(p, fs.readFileSync(p, "utf8") + extra);
        const m = JSON.parse(fs.readFileSync(path.join(source, "bundle.json")));
        m.files[name] = crypto
            .createHash("sha256")
            .update(fs.readFileSync(p))
            .digest("hex");
        fs.writeFileSync(
            path.join(source, "bundle.json"),
            JSON.stringify(m, null, 2) + "\n",
        );
    };
    return {
        temp,
        source,
        target,
        script,
        run,
        edit,
        dest: path.join(target, ".crossnote"),
    };
}
test("check is read-only; deploy makes independent copies and is idempotent", (t) => {
    const f = fixture(t);
    assert.notEqual(f.run("--check").status, 0);
    assert.equal(fs.existsSync(f.dest), false);
    const first = f.run();
    assert.equal(first.status, 0, first.stderr);
    const files = JSON.parse(
        fs.readFileSync(path.join(f.source, "bundle.json")),
    ).files;
    for (const name of Object.keys(files)) {
        const a = fs.statSync(path.join(f.dest, name)),
            b = fs.statSync(path.join(f.source, name));
        assert.equal(
            fs.lstatSync(path.join(f.dest, name)).isSymbolicLink(),
            false,
        );
        assert.notEqual(a.ino, b.ino);
        assert.deepEqual(
            fs.readFileSync(path.join(f.dest, name)),
            fs.readFileSync(path.join(f.source, name)),
        );
    }
    const before = fs.statSync(path.join(f.dest, "parser.js")).ino;
    assert.equal(f.run("--check").status, 0);
    assert.equal(f.run().status, 0);
    assert.equal(fs.statSync(path.join(f.dest, "parser.js")).ino, before);
    fs.writeFileSync(path.join(f.dest, "private.txt"), "keep me");
    f.edit("config.js", "\n// new build\n");
    assert.notEqual(f.run("--check").status, 0);
    assert.equal(f.run().status, 0);
    assert.equal(
        fs.readFileSync(path.join(f.dest, "private.txt"), "utf8"),
        "keep me",
    );
});
test("conflicts prevent every write, including other otherwise valid updates", (t) => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    const oldStyle = fs.readFileSync(path.join(f.dest, "style.less"));
    fs.writeFileSync(path.join(f.dest, "config.js"), "// user configuration\n");
    f.edit("style.less", "\n/* new style */\n");
    const rejected = f.run();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /config.js has local changes/);
    assert.equal(
        fs.readFileSync(path.join(f.dest, "config.js"), "utf8"),
        "// user configuration\n",
    );
    assert.deepEqual(
        fs.readFileSync(path.join(f.dest, "style.less")),
        oldStyle,
    );
    assert.equal(
        fs.existsSync(path.join(f.target, ".crossnote-sync.lock")),
        false,
    );
});
test("old canonical directory links and hard links are detached without changing the source", (t) => {
    const f = fixture(t);
    fs.mkdirSync(f.dest);
    for (const name of [
        "parser.js",
        "config.js",
        "style.less",
        "head.html",
        "README.md",
        "scripts",
        "vendor",
    ])
        fs.symlinkSync(path.join(f.source, name), path.join(f.dest, name));
    for (const name of ["theme-toggle.js", "pseudocode-runtime.js"])
        fs.linkSync(path.join(f.source, name), path.join(f.dest, name));
    const before = fs.readFileSync(path.join(f.source, "config.js"));
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
        fs.lstatSync(path.join(f.dest, "scripts")).isSymbolicLink(),
        false,
    );
    assert.notEqual(
        fs.statSync(path.join(f.dest, "theme-toggle.js")).ino,
        fs.statSync(path.join(f.source, "theme-toggle.js")).ino,
    );
    fs.writeFileSync(path.join(f.dest, "config.js"), "local edit");
    assert.deepEqual(fs.readFileSync(path.join(f.source, "config.js")), before);
});
test("known legacy copies are adopted; unrelated directory links and damaged manifests fail", (t) => {
    const f = fixture(t);
    fs.mkdirSync(f.dest);
    fs.copyFileSync(
        path.join(__dirname, "fixtures/legacy-config.js"),
        path.join(f.dest, "config.js"),
    );
    assert.equal(f.run().status, 0);
    fs.rmSync(path.join(f.dest, "vendor"), { recursive: true });
    const outside = path.join(f.temp, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(f.dest, "vendor"));
    const fail = f.run();
    assert.notEqual(fail.status, 0);
    assert.match(fail.stderr, /unrelated/);
    assert.deepEqual(fs.readdirSync(outside), []);
    fs.unlinkSync(path.join(f.dest, "vendor"));
    fs.writeFileSync(
        path.join(f.dest, ".xnote-manifest.json"),
        '{"version":1,"files":{"../../outside":"' + "a".repeat(64) + '"}}',
    );
    assert.match(f.run().stderr, /Invalid manifest entry/);
});
test("failed installation rolls managed files back and releases its lock", (t) => {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    const names = ["config.js", "parser.js", ".xnote-manifest.json"];
    const originals = names.map((n) => fs.readFileSync(path.join(f.dest, n)));
    f.edit("config.js", "\n// changed\n");
    f.edit("parser.js", "\n// changed\n");
    const sync = require(f.script);
    const write = fs.writeFileSync;
    fs.writeFileSync = function (file) {
        if (String(file).endsWith("owner.json"))
            throw new Error("injected lock metadata failure");
        return write.apply(this, arguments);
    };
    try {
        assert.throws(() => sync.main(["--target", f.target]), /rolled back/);
    } finally {
        fs.writeFileSync = write;
    }
    assert.equal(
        fs.existsSync(path.join(f.target, ".crossnote-sync.lock")),
        false,
    );
    const rename = fs.renameSync;
    fs.renameSync = function (from, to) {
        if (
            path.basename(from).startsWith("new-") &&
            to === path.join(f.dest, "parser.js")
        )
            throw new Error("injected I/O failure");
        return rename.apply(this, arguments);
    };
    try {
        assert.throws(() => sync.main(["--target", f.target]), /rolled back/);
    } finally {
        fs.renameSync = rename;
    }
    names.forEach((n, i) =>
        assert.deepEqual(fs.readFileSync(path.join(f.dest, n)), originals[i]),
    );
    assert.equal(
        fs.existsSync(path.join(f.target, ".crossnote-sync.lock")),
        false,
    );
    assert.deepEqual(fs.readdirSync(f.target), [".crossnote"]);
});
test("source drift, deployment into source, and concurrent synchronization fail", (t) => {
    const f = fixture(t);
    fs.mkdirSync(path.join(f.target, ".crossnote-sync.lock"));
    assert.match(f.run().stderr, /locked/);
    fs.rmdirSync(path.join(f.target, ".crossnote-sync.lock"));
    fs.appendFileSync(path.join(f.source, "parser.js"), "\n// stale\n");
    assert.match(f.run().stderr, /Build is stale/);
    assert.equal(fs.existsSync(f.dest), false);
    const same = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts/sync.cjs"), "--target", path.dirname(ROOT)],
        { encoding: "utf8" },
    );
    assert.notEqual(same.status, 0);
    assert.match(same.stderr, /maintained source/);
});
