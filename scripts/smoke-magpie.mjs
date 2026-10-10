// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

// Opt-in integration test: real provider calls use synthetic dialogue only.
await mkdir(".cache", { recursive: true });
await build({
    entryPoints: ["dist/chatTranslate.desktop/native.ts"],
    outfile: ".cache/native-magpie.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
});
const electron = createRequire(resolve(".cache/package.json"))("electron");
const main = resolve(".cache/magpie-main.cjs");
await writeFile(
    main,
    `
const { app } = require("electron");
app.setPath("userData", ${JSON.stringify(resolve(".cache/electron-magpie"))});
app.whenReady().then(async () => {
    const native = require(${JSON.stringify(resolve(".cache/native-magpie.cjs"))});
    try {
        const { runProbe } = await import(${JSON.stringify(
            new URL("./magpie-probe.mjs", import.meta.url).href,
        )});
        await runProbe(native);
        await native.stopNative(null);
        app.exit(0);
    } catch (error) {
        console.error(error.message);
        await native.stopNative(null);
        app.exit(1);
    }
});
`,
);
const exitCode = await new Promise((done, reject) => {
    const child = spawn(electron, [main], { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", done);
});
assert.equal(exitCode, 0, "Real Magpie / Electron integration probe failed");
