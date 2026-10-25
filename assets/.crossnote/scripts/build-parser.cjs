#!/usr/bin/env node
"use strict";
// Compatibility entry for existing maintenance hooks. All generated assets share one build.
require("node:child_process").execFileSync(process.execPath, [require("node:path").join(__dirname, "build.cjs"), ...process.argv.slice(2)], {stdio: "inherit"});
