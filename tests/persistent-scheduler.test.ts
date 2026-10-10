// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, presetRule } from "../src/core/config";
import { TranslationEngine } from "../src/core/scheduler";
import type { PersistentTranslations } from "../src/core/cache";
import type { MessageInput, TranslationRequest } from "../src/core/types";
import { PersistentTranslationCache } from "../src/native/cache";

const message: MessageInput = {
    id: "synthetic-message",
    channelId: "synthetic-channel",
    text: "Hello <@111111111111111111>",
    speaker: "synthetic-author",
    timestamp: 1,
};
function fixture(persistent: PersistentTranslations) {
    let time = 0;
    const requests: TranslationRequest[] = [];
    const config = defaultConfig();
    config.global = presetRule("bilingual");
    const engine = new TranslationEngine(
        config,
        {
            detect: async (texts) => texts.map(() => [{ language: "en", score: 0.99 }]),
            close: async () => {},
        },
        {
            translate: async (request) => {
                requests.push(request);
                return request.items
                    .filter((item) => item.mode === "translate")
                    .map((item) => ({ id: item.id, text: item.text.replace("Hello", "你好") }));
            },
        },
        () => time,
        undefined,
        undefined,
        persistent,
    );
    engine.upsert(message);
    engine.setVisible("synthetic-channel:synthetic-message", true);
    return {
        engine,
        requests,
        ready: () => {
            time = 1000;
        },
    };
}
function backend() {
    const data: Record<string, string> = {};
    const cache: PersistentTranslations = {
        get: async (keys) =>
            Object.fromEntries(
                keys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]!]),
            ),
        set: async (values) => {
            Object.assign(data, values);
        },
        clear: async () => {
            for (const key of Object.keys(data)) delete data[key];
        },
    };
    return { cache, data };
}

test("a fresh engine reuses persisted incoming translations without a paid request and restores mentions", async () => {
    const disk = backend();
    const first = fixture(disk.cache);
    first.ready();
    await first.engine.tick();
    await setImmediate();
    assert.equal(first.requests.length, 1);
    assert.equal(Object.values(disk.data)[0]!.includes("111111111111111111"), false);
    await first.engine.stop();
    const second = fixture(disk.cache);
    second.ready();
    await second.engine.tick();
    assert.equal(second.requests.length, 0);
    assert.equal(
        second.engine.state("synthetic-channel:synthetic-message").translation,
        "你好 <@111111111111111111>",
    );
    await second.engine.manual(message, "zh-CN", true);
    assert.equal(second.requests.length, 1);
    await second.engine.stop();
});

test("visibility is rechecked after disk lookup, and a cache failure falls back to translation", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const entered = backend();
    const f = fixture({
        ...entered.cache,
        get: async () => {
            await waiting;
            return {};
        },
    });
    f.ready();
    const tick = f.engine.tick();
    await setImmediate();
    f.engine.setVisible("synthetic-channel:synthetic-message", false);
    release();
    await tick;
    assert.equal(f.requests.length, 0);
    await f.engine.stop();
    const failed = fixture({
        get: async () => {
            throw new Error("disk unavailable");
        },
        set: async () => {
            throw new Error("disk full");
        },
        clear: async () => {},
    });
    failed.ready();
    await failed.engine.tick();
    await setImmediate();
    assert.equal(failed.requests.length, 1);
    assert.equal(failed.engine.state("synthetic-channel:synthetic-message").status, "done");
    await failed.engine.stop();
});

test("target and content changes miss persisted values; protected-token corruption is never displayed", async () => {
    const disk = backend();
    const first = fixture(disk.cache);
    first.ready();
    await first.engine.tick();
    await setImmediate();
    await first.engine.stop();
    const target = fixture(disk.cache);
    target.engine.config.global.target = "ja";
    target.ready();
    await target.engine.tick();
    await setImmediate();
    assert.equal(target.requests.length, 1);
    await target.engine.stop();
    const changed = fixture(disk.cache);
    changed.engine.upsert({
        ...message,
        text: "Hello, edited <@111111111111111111>",
        version: "2",
    });
    changed.ready();
    await changed.engine.tick();
    await setImmediate();
    assert.equal(changed.requests.length, 1);
    await changed.engine.stop();
    const corrupt = fixture({
        ...disk.cache,
        get: async (keys) => Object.fromEntries(keys.map((key) => [key, "missing mention"])),
    });
    corrupt.ready();
    await corrupt.engine.tick();
    await setImmediate();
    assert.equal(corrupt.requests.length, 1);
    assert.equal(
        corrupt.engine.state("synthetic-channel:synthetic-message").translation,
        "你好 <@111111111111111111>",
    );
    await corrupt.engine.stop();
});

test("real disk backend and a new engine reuse the same message after all session caches are lost", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ct-disk-engine-"));
    const path = join(dir, "private", "translations.json");
    try {
        const connect = () => {
            const disk = new PersistentTranslationCache(path);
            const cache: PersistentTranslations = {
                get: (keys) => disk.get("synthetic-provider", keys),
                set: (values) => disk.set("synthetic-provider", values),
                clear: () => disk.clear(),
            };
            return { disk, cache };
        };
        const firstDisk = connect();
        const first = fixture(firstDisk.cache);
        first.ready();
        await first.engine.tick();
        await setImmediate();
        await firstDisk.disk.get("synthetic-provider", []);
        await first.engine.stop();
        const raw = await readFile(path, "utf8");
        assert.equal(raw.includes("synthetic-channel"), false);
        assert.equal(raw.includes("Hello"), false);
        assert.equal(raw.includes("111111111111111111"), false);
        const second = fixture(connect().cache);
        second.ready();
        await second.engine.tick();
        assert.equal(second.requests.length, 0);
        assert.equal(
            second.engine.state("synthetic-channel:synthetic-message").translation,
            "你好 <@111111111111111111>",
        );
        await second.engine.stop();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
