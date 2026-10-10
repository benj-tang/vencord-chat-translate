// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentTranslationCache, providerNamespace } from "../src/native/cache";
import { protectText } from "../src/core/protection";

async function fixture(run: (path: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "ct-cache-"));
    try {
        await run(join(dir, "private", "translations-v1.json"));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

test("disk cache survives a new instance and stores hashes rather than originals or credentials", async () => {
    await fixture(async (path) => {
        const namespace = providerNamespace({
            endpoint: "https://synthetic.test/v1/chat/completions",
            model: "test-model",
            apiKey: "secret-not-for-disk",
            timeoutMs: 30000,
            maxOutputTokens: 6000,
        });
        const key = "private-channel:private-message:Original payout message";
        await new PersistentTranslationCache(path).set(namespace, { [key]: "出金待处理" });
        const fresh = new PersistentTranslationCache(path);
        assert.deepEqual(await fresh.get(namespace, [key]), { [key]: "出金待处理" });
        assert.deepEqual(await fresh.get("different-provider", [key]), {});
        const raw = await readFile(path, "utf8");
        for (const secret of [key, "synthetic.test", "secret-not-for-disk", "test-model"])
            assert.equal(raw.includes(secret), false);
        if (process.platform !== "win32") {
            assert.equal((await stat(path)).mode & 0o777, 0o600);
            assert.equal((await stat(join(path, ".."))).mode & 0o777, 0o700);
        }
    });
});

test("provider identity separates models and effort while allowing credential rotation", () => {
    const config = {
        endpoint: "https://example.test/v1",
        model: "m",
        apiKey: "first",
        timeoutMs: 30000,
        maxOutputTokens: 6000,
    };
    assert.equal(
        providerNamespace(config),
        providerNamespace({ ...config, apiKey: "rotated", timeoutMs: 40000 }),
    );
    assert.notEqual(providerNamespace(config), providerNamespace({ ...config, model: "other" }));
    assert.notEqual(
        providerNamespace(config),
        providerNamespace({ ...config, reasoningEffort: "low" }),
    );
});

test("expiry removes disk entries and is based on creation rather than repeated reads", async () => {
    await fixture(async (path) => {
        let time = 1000000000;
        const cache = new PersistentTranslationCache(
            path,
            { ttlDays: 1, maxEntries: 100 },
            () => time,
        );
        await cache.set("p", { first: "first translation" });
        time += 12 * 3600000;
        assert.equal((await cache.get("p", ["first"])).first, "first translation");
        time += 12 * 3600000 + 1;
        assert.deepEqual(await cache.get("p", ["first"]), {});
        assert.equal(JSON.parse(await readFile(path, "utf8")).entries.length, 0);
    });
});

test("capacity evicts least recently used entries and clear survives restart", async () => {
    await fixture(async (path) => {
        let time = Date.now();
        const cache = new PersistentTranslationCache(
            path,
            { ttlDays: 30, maxEntries: 2 },
            () => ++time,
        );
        await cache.set("p", { a: "A", b: "B" });
        await cache.get("p", ["a"]);
        await cache.set("p", { c: "C" });
        assert.deepEqual(await new PersistentTranslationCache(path).get("p", ["a", "b", "c"]), {
            a: "A",
            c: "C",
        });
        await cache.clear();
        assert.deepEqual(await new PersistentTranslationCache(path).get("p", ["a", "c"]), {});
    });
});

test("concurrent writes merge and malformed cache is safely rebuilt", async () => {
    await fixture(async (path) => {
        const cache = new PersistentTranslationCache(path);
        await Promise.all([cache.set("p", { a: "A" }), cache.set("p", { b: "B" })]);
        assert.deepEqual(await new PersistentTranslationCache(path).get("p", ["a", "b"]), {
            a: "A",
            b: "B",
        });
        await writeFile(path, "{broken", { mode: 0o600 });
        const repaired = new PersistentTranslationCache(path);
        assert.deepEqual(await repaired.get("p", ["a"]), {});
        await repaired.set("p", { c: "C" });
        assert.deepEqual(await new PersistentTranslationCache(path).get("p", ["c"]), { c: "C" });
    });
});

test("byte capacity counts UTF-8 bytes and bounds the actual persisted file", async () => {
    await fixture(async (path) => {
        const cache = new PersistentTranslationCache(path);
        await cache.set(
            "p",
            Object.fromEntries(
                Array.from({ length: 250 }, (_, i) => [`message-${i}`, "中".repeat(16000)]),
            ),
        );
        assert.ok((await stat(path)).size <= 10 * 1024 * 1024);
        assert.ok(cache.stats().entries < 250);
        assert.equal((await cache.get("p", ["message-249"]))["message-249"], "中".repeat(16000));
    });
});

test("cache refuses publicly readable files and symbolic links without touching their targets", async () => {
    if (process.platform === "win32") return;
    await fixture(async (path) => {
        const cache = new PersistentTranslationCache(path);
        await cache.set("p", { a: "A" });
        await chmod(path, 0o644);
        await assert.rejects(
            new PersistentTranslationCache(path).get("p", ["a"]),
            /private cache/i,
        );
        const original = await readFile(path, "utf8");
        await rm(path);
        const target = join(path, "..", "external.json");
        await writeFile(target, original, { mode: 0o600 });
        await symlink(target, path);
        await assert.rejects(new PersistentTranslationCache(path).set("p", { b: "B" }));
        assert.equal(await readFile(target, "utf8"), original);
    });
});

test("persistent codec removes original protected tokens and restores duplicate reordered mentions", () => {
    const original =
        "Hello <@111111111111111111> and <@222222222222222222>, <@111111111111111111> `const id = 123`";
    const translation =
        "你好 <@222222222222222222> 和 <@111111111111111111>，<@111111111111111111> `const id = 123`";
    const protection = protectText(original, []);
    const encoded = protection.encode(translation);
    assert.equal(encoded.includes("111111111111111111"), false);
    assert.equal(encoded.includes("const id"), false);
    assert.equal(protection.restore(encoded), translation);
    assert.throws(() => protection.encode("missing mentions"));
});
