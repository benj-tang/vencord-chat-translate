// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

if (process.argv.length !== 3 || process.argv[2] !== "--from-paseo") {
    console.error("Usage: npm run configure:magpie -- --from-paseo");
    process.exit(1);
}
try {
    const source = JSON.parse(await readFile(join(homedir(), ".paseo/config.json"), "utf8")).agents
        .providers.codex.env;
    const url = new URL(source.OPENAI_BASE_URL);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        typeof source.OPENAI_API_KEY !== "string" ||
        !source.OPENAI_API_KEY.trim()
    )
        throw new Error("Invalid source");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
    const directory = join(homedir(), ".config/chat-translate");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
        join(directory, "provider.json"),
        JSON.stringify(
            {
                endpoint: url.href,
                model: "deepseek/deepseek-v4-flash",
                apiKey: source.OPENAI_API_KEY,
                reasoningEffort: "low",
            },
            null,
            2,
        ) + "\n",
        { mode: 0o600, flag: "wx" },
    );
    console.log("Private local profile created for Magpie / DeepSeek V4 Flash (low).");
} catch (error) {
    console.error(
        error.code === "EEXIST"
            ? "Local profile already exists; it was preserved."
            : "Could not create profile. Check the local Paseo provider configuration.",
    );
    process.exitCode = 1;
}
