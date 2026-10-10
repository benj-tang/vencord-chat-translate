// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProviderConfig } from "../src/native/profile";
import type { ProviderConfig } from "../src/core/types";

const config: ProviderConfig = {
    endpoint: "",
    model: "",
    apiKey: "",
    timeoutMs: 30000,
    maxOutputTokens: 6000,
    useLocalProfile: true,
};
test("local profile supplies credentials only to its own endpoint and preserves UI limits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ct-profile-"));
    const path = join(dir, "provider.json");
    try {
        const profile = {
            endpoint: "https://gateway.example.test/v1/chat/completions",
            model: "deepseek/deepseek-v4-flash",
            apiKey: "synthetic-profile-key",
            reasoningEffort: "low",
            timeoutMs: 120000,
        };
        await writeFile(path, JSON.stringify(profile), { mode: 0o600 });
        assert.deepEqual(
            await resolveProviderConfig(
                { ...config, endpoint: "https://other.example.test", apiKey: "other-key" },
                path,
            ),
            {
                ...profile,
                timeoutMs: 30000,
                maxOutputTokens: 6000,
            },
        );
        const custom = { ...config, useLocalProfile: false };
        assert.equal(await resolveProviderConfig(custom, "/missing/profile"), custom);
    } finally {
        await rm(dir, { recursive: true });
    }
});
test("missing, malformed, insecure and publicly readable profiles fail without exposing values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ct-profile-"));
    const path = join(dir, "provider.json");
    try {
        const rejected = () =>
            assert.rejects(
                resolveProviderConfig(config, path),
                /^Error: Check the local ChatTranslate provider profile and its permissions$/,
            );
        await rejected();
        for (const value of [
            "synthetic-secret",
            JSON.stringify({ endpoint: "https://example.test", model: "m" }),
            JSON.stringify({
                endpoint: "http://lan.test/v1",
                model: "m",
                apiKey: "synthetic-secret",
            }),
            JSON.stringify({
                endpoint: "https://example.test",
                model: "m",
                apiKey: "synthetic-secret",
                reasoningEffort: "unknown",
            }),
        ]) {
            await writeFile(path, value, { mode: 0o600 });
            await rejected();
        }
        await writeFile(
            path,
            JSON.stringify({ endpoint: "https://example.test", model: "m", apiKey: "secret" }),
        );
        if (process.platform !== "win32") {
            await chmod(path, 0o644);
            await rejected();
        }
    } finally {
        await rm(dir, { recursive: true });
    }
});
