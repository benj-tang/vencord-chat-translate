// SPDX-License-Identifier: GPL-3.0-or-later
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkout = join(root, ".cache/vencord");
const pin = "718c867256a9d181edc7a534afb296b9bb41ab58";
function run(command, args, cwd = root) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
        child.on("error", reject);
        child.on("exit", (code) =>
            code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
        );
    });
}
await mkdir(join(root, ".cache"), { recursive: true });
try {
    await access(join(checkout, ".git"));
} catch {
    const source = process.env.VENCORD_SOURCE || "https://github.com/Vendicated/Vencord.git";
    await run("git", ["clone", "--no-checkout", source, checkout]);
    await run("git", ["checkout", "--detach", pin], checkout);
}
await run("git", ["diff", "--exit-code", "--", "src"], checkout);
await run("git", ["rev-parse", "--verify", `${pin}^{commit}`], checkout);
const { execFileSync } = await import("node:child_process");
if (
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" }).trim() !== pin
) {
    throw new Error("Verification checkout HEAD differs from the recorded Vencord revision");
}
await run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], checkout);
await cp(
    join(root, "dist/chatTranslate.desktop"),
    join(checkout, "src/userplugins/chatTranslate.desktop"),
    {
        recursive: true,
    },
);
const config = JSON.parse(
    await readFile(join(checkout, "tsconfig.json"), "utf8").then((text) =>
        text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"),
    ),
);
config.compilerOptions.skipLibCheck = true;
config.compilerOptions.types = ["node"];
config.include = [
    "src/userplugins/chatTranslate.desktop/**/*",
    "src/globals.d.ts",
    "src/modules.d.ts",
    "src/nativeModules.d.ts",
];
await writeFile(join(checkout, "tsconfig.chatTranslate.json"), JSON.stringify(config, null, 2));
await run("pnpm", ["exec", "tsc", "--noEmit", "-p", "tsconfig.chatTranslate.json"], checkout);
await run("pnpm", ["build", "--standalone", "--disable-updater"], checkout);
console.log(
    `Vencord typecheck and desktop builds passed at ${pin}. No client was installed or modified.`,
);
