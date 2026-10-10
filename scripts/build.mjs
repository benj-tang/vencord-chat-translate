// SPDX-License-Identifier: GPL-3.0-or-later
import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist/chatTranslate.desktop");
const packageRoot = dirname(
    createRequire(import.meta.url).resolve("fasttext.wasm.js/package.json"),
);
const wasm = await readFile(join(packageRoot, "dist/core/fastText.node.wasm"));
const model = await readFile(
    join(packageRoot, "dist/models/language-identification/assets/lid.176.ftz"),
);
const bundled = await build({
    absWorkingDir: root,
    entryPoints: ["src/native/worker.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    write: false,
    minify: true,
    define: {
        CT_WASM_BASE64: JSON.stringify(wasm.toString("base64")),
        CT_MODEL_BASE64: JSON.stringify(model.toString("base64")),
        "import.meta.url": JSON.stringify("file:///chattranslate-worker.cjs"),
    },
});
const worker = bundled.outputFiles[0].text;
await mkdir(join(output, "generated"), { recursive: true });
await mkdir(join(output, "native"), { recursive: true });
await cp(join(root, "src/core"), join(output, "core"), { recursive: true });
for (const name of ["detector.ts", "profile.ts"])
    await cp(join(root, "src/native", name), join(output, "native", name));
for (const name of [
    "index.tsx",
    "native.ts",
    "runtime.ts",
    "settings.tsx",
    "ui.tsx",
    "styles.css",
]) {
    const source = await readFile(join(root, "src/plugin", name), "utf8");
    await writeFile(
        join(output, name),
        source.replaceAll('"../core/', '"./core/').replaceAll('"../native/', '"./native/'),
    );
}
await writeFile(join(output, "generated/worker.json"), JSON.stringify(worker));
await writeFile(join(root, "dist/detector-worker.cjs"), worker);
await mkdir(join(output, "licenses"), { recursive: true });
for (const name of ["LICENSE", "NOTICE.md"])
    await cp(join(root, name), join(output, "licenses", name));
await cp(join(packageRoot, "LICENSE"), join(output, "licenses/fasttext-wrapper-MIT.txt"));
await cp(join(root, "docs/model-license.txt"), join(output, "licenses/model-CC-BY-SA-3.0.txt"));
console.log(`Plugin source package built: ${output}`);
console.log(`Embedded worker: ${Math.ceil(Buffer.byteLength(worker) / 1024)} KiB`);
