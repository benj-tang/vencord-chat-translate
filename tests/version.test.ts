// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { defaultConfig, presetRule } from "../src/core/config";
import { DraftSession } from "../src/core/draft";
import { classify } from "../src/core/language";
import { TranslationEngine } from "../src/core/scheduler";
import type { MessageInput, TranslationResult } from "../src/core/types";

const message: MessageInput = {
    id: "1",
    channelId: "a",
    text: "Hello",
    version: "1",
    speaker: "author",
    timestamp: 1,
};
function versionFixture(fail = false) {
    let time = 0;
    let finish!: (result: TranslationResult[]) => void;
    let reject!: (error: Error) => void;
    const config = defaultConfig();
    config.global = presetRule("bilingual");
    const engine = new TranslationEngine(
        config,
        {
            detect: async (texts) => texts.map(() => [{ language: "en", score: 0.95 }]),
            close: async () => {},
        },
        {
            translate: async () =>
                new Promise<TranslationResult[]>((res, rej) => {
                    finish = res;
                    reject = rej;
                }),
        },
        () => time,
    );
    engine.upsert(message);
    engine.setVisible("a:1", true);
    return {
        engine,
        setTime: (value: number) => {
            time = value;
        },
        finish: () =>
            fail
                ? reject(new Error("old failure"))
                : finish([{ id: "m0", text: "old translation" }]),
    };
}
for (const failure of [false, true]) {
    test(`same text edited through a new version rejects old ${failure ? "errors" : "translations"}`, async () => {
        const f = versionFixture(failure);
        f.setTime(1000);
        await f.engine.tick();
        f.engine.upsert({ ...message, text: "Changed", version: "2" });
        f.engine.upsert({ ...message, version: "3" });
        f.finish();
        await setImmediate();
        assert.equal(f.engine.state("a:1").translation, undefined);
        assert.equal(f.engine.state("a:1").error, undefined);
        await f.engine.stop();
    });
}
test("mapping-target cache is reused after unmount even if global target differs", async () => {
    let time = 0;
    let calls = 0;
    const config = defaultConfig();
    config.global = { ...presetRule("bilingual"), mode: "mappings", mappings: { en: "es" } };
    const engine = new TranslationEngine(
        config,
        {
            detect: async (texts) => texts.map(() => [{ language: "en", score: 0.95 }]),
            close: async () => {},
        },
        {
            translate: async (request) => {
                calls++;
                return request.items
                    .filter((i) => i.mode === "translate")
                    .map((i) => ({ id: i.id, text: "Hola" }));
            },
        },
        () => time,
    );
    engine.upsert(message);
    engine.setVisible("a:1", true);
    time = 1000;
    await engine.tick();
    await setImmediate();
    engine.remove("a:1");
    engine.upsert(message);
    engine.setVisible("a:1", true);
    time = 2000;
    await engine.tick();
    await setImmediate();
    assert.equal(calls, 1);
    assert.equal(engine.state("a:1").translation, "Hola");
    await engine.stop();
});
test("draft restore remains retryable until editor replacement is confirmed", () => {
    const session = new DraftSession({ channelId: "a", text: "你好" });
    session.apply(session.original, "Hello");
    assert.throws(() => session.restore({ channelId: "a", text: "Hello" }));
    session.confirmApplied("Hello");
    assert.equal(session.restore({ channelId: "a", text: "Hello" }), "你好");
    assert.equal(session.restore({ channelId: "a", text: "Hello" }), "你好");
    session.confirmRestored();
    assert.throws(() => session.restore({ channelId: "a", text: "Hello" }));
});
test("shared Han particles alone do not force a Chinese label", () => {
    for (const text of ["了解", "日本的"]) {
        assert.equal(classify(text, [{ language: "ja", score: 0.95 }]).kind, "unknown");
    }
});
