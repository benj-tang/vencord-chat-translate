// SPDX-License-Identifier: GPL-3.0-or-later
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProviderError, validateProvider } from "../core/provider";
import type { ProviderConfig } from "../core/types";

export const localProfilePath = () => join(homedir(), ".config", "chat-translate", "provider.json");

export async function resolveProviderConfig(
    config: ProviderConfig,
    path = localProfilePath(),
): Promise<ProviderConfig> {
    if (!config.useLocalProfile) return config;
    try {
        const file = await open(path, "r");
        try {
            const stat = await file.stat();
            if (
                !stat.isFile() ||
                stat.size > 16384 ||
                (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
            )
                throw new Error("Invalid private profile");
            const value = JSON.parse(await file.readFile("utf8"));
            if (
                !value ||
                typeof value.endpoint !== "string" ||
                typeof value.model !== "string" ||
                typeof value.apiKey !== "string"
            )
                throw new Error("Invalid profile values");
            const resolved: ProviderConfig = {
                endpoint: value.endpoint,
                model: value.model,
                apiKey: value.apiKey,
                timeoutMs: config.timeoutMs,
                maxOutputTokens: config.maxOutputTokens,
                ...(value.reasoningEffort !== undefined
                    ? { reasoningEffort: value.reasoningEffort }
                    : {}),
            };
            validateProvider(resolved);
            return resolved;
        } finally {
            await file.close();
        }
    } catch {
        throw new ProviderError(
            "Check the local ChatTranslate provider profile and its permissions",
            false,
            0,
            "credentials",
        );
    }
}
