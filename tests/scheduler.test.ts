// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { defaultConfig, presetRule } from "../src/core/config";
import { TranslationEngine } from "../src/core/scheduler";
import { messageKey } from "../src/core/types";
import type {
    AppConfig,
    LocalDetector,
    MessageInput,
    TranslationRequest,
    TranslationResult,
    Translator,
} from "../src/core/types";

function message(id: number, channelId = "a", text = "Payout pending"): MessageInput {
    return { id: String(id), channelId, text, speaker: `private-author-${id % 2}`, timestamp: id };
}
const detector: LocalDetector = {
    detect: async (texts) =>
        texts.map((text) =>
            text.includes("收到")
                ? [{ language: "zh", score: 0.95 }]
                : [{ language: "en", score: 0.95 }],
        ),
    close: async () => {},
};
function fixture(translate?: Translator["translate"], change?: (config: AppConfig) => void) {
    let time = 0;
    const requests: TranslationRequest[] = [];
    const config = defaultConfig();
    config.global = presetRule("bilingual");
    change?.(config);
    const translator: Translator = {
        async translate(request, signal) {
            requests.push(request);
            if (translate) return translate(request, signal);
            return request.items
                .filter((i) => i.mode === "translate")
                .map((i) => ({ id: i.id, text: i.text.replace("Payout pending", "出金待处理") }));
        },
    };
    const engine = new TranslationEngine(config, detector, translator, () => time);
    const add = (m: MessageInput) => {
        engine.upsert(m);
        engine.setVisible(messageKey(m), true);
    };
    return {
        engine,
        requests,
        add,
        setTime: (t: number) => {
            time = t;
        },
    };
}
test("continuous visibility is per message and requires the full second", async () => {
    const f = fixture();
    f.add(message(1));
    f.setTime(500);
    f.add(message(2));
    f.setTime(999);
    await f.engine.tick();
    assert.equal(f.requests.length, 0);
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.requests[0]!.items.length, 1);
    f.setTime(1500);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.requests.length, 2);
    await f.engine.stop();
});
test("scrolling out resets the continuous timer", async () => {
    const f = fixture();
    const m = message(1);
    f.add(m);
    f.setTime(900);
    f.engine.setVisible(messageKey(m), false);
    f.setTime(1000);
    f.engine.setVisible(messageKey(m), true);
    f.setTime(1900);
    await f.engine.tick();
    assert.equal(f.requests.length, 0);
    f.setTime(2000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.requests.length, 1);
    await f.engine.stop();
});
test("mounted but invisible messages, inactive windows and disabled scopes do not request", async () => {
    const f = fixture();
    f.engine.upsert(message(1));
    f.add(message(2));
    f.engine.config.channels.a = { enabled: false };
    f.setTime(2000);
    await f.engine.tick();
    assert.equal(f.requests.length, 0);
    f.engine.config.channels.a = { enabled: true };
    f.engine.setActive(false);
    await f.engine.tick();
    assert.equal(f.requests.length, 0);
    f.engine.setActive(true);
    f.engine.setVisible("a:2", true);
    f.setTime(3000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.requests[0]!.items.length, 1);
    await f.engine.stop();
});
test("sixty messages become bounded fifty and ten item batches without waiting", async () => {
    const f = fixture();
    for (let i = 1; i <= 60; i++) f.add(message(i));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    assert.deepEqual(
        f.requests.map((r) => r.items.length),
        [50, 10],
    );
    assert.ok(f.requests.every((r) => r.items.every((i) => /^a\d+$/.test(i.speaker))));
    assert.ok(f.requests.every((r) => !JSON.stringify(r).includes("private-author")));
    await f.engine.stop();
});
test("batches never mix channels and preserve reply links and visible Chinese context", async () => {
    const f = fixture();
    f.add(message(1, "a", "收到"));
    f.add({ ...message(2), replyTo: "1" });
    f.add(message(3, "b"));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.requests.length, 2);
    const a = f.requests.find((r) => r.items.length === 2)!;
    assert.equal(a.items[0]!.mode, "context");
    assert.equal(a.items[1]!.replyTo, a.items[0]!.id);
    await f.engine.stop();
});
test("leaving the viewport during local detection removes pending eligibility", async () => {
    let resolve!: (value: any) => void;
    let time = 0;
    const config = defaultConfig();
    config.global = presetRule("bilingual");
    const requests: TranslationRequest[] = [];
    const engine = new TranslationEngine(
        config,
        {
            detect: () =>
                new Promise((r) => {
                    resolve = r;
                }),
            close: async () => {},
        },
        {
            translate: async (req) => {
                requests.push(req);
                return [];
            },
        },
        () => time,
    );
    const m = message(1);
    engine.upsert(m);
    engine.setVisible("a:1", true);
    time = 1000;
    const tick = engine.tick();
    engine.setVisible("a:1", false);
    resolve([[{ language: "en", score: 0.95 }]]);
    await tick;
    assert.equal(requests.length, 0);
    await engine.stop();
});
test("one offscreen member does not cancel a dispatched batch", async () => {
    let finish!: (result: TranslationResult[]) => void;
    const f = fixture(
        () =>
            new Promise((r) => {
                finish = r;
            }),
    );
    f.add(message(1));
    f.add(message(2));
    f.setTime(1000);
    await f.engine.tick();
    f.engine.setVisible("a:1", false);
    finish([
        { id: "m0", text: "first" },
        { id: "m1", text: "second" },
    ]);
    await setImmediate();
    assert.equal(f.engine.state("a:1").translation, "first");
    assert.equal(f.engine.state("a:2").translation, "second");
    await f.engine.stop();
});
test("editing or deleting pending messages rejects old results", async () => {
    let finish!: (result: TranslationResult[]) => void;
    const f = fixture(
        () =>
            new Promise((r) => {
                finish = r;
            }),
    );
    f.add(message(1));
    f.add(message(2));
    f.setTime(1000);
    await f.engine.tick();
    f.engine.upsert(message(1, "a", "Changed content"));
    f.engine.remove("a:2");
    finish([
        { id: "m0", text: "old" },
        { id: "m1", text: "deleted" },
    ]);
    await setImmediate();
    assert.equal(f.engine.state("a:1").translation, undefined);
    assert.equal(f.engine.state("a:2").status, "idle");
    await f.engine.stop();
});
test("cache survives unmount and reentry and avoids a second paid request", async () => {
    const f = fixture();
    const m = message(1);
    f.add(m);
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    f.engine.remove("a:1");
    f.add(m);
    f.setTime(3000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.requests.length, 1);
    assert.equal(f.engine.state("a:1").translation, "出金待处理");
    await f.engine.stop();
});
test("partial response keeps successful items without single-request fan-out", async () => {
    const f = fixture(async () => [{ id: "m0", text: "translated" }]);
    f.add(message(1));
    f.add(message(2));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    await f.engine.tick();
    assert.equal(f.engine.state("a:1").status, "done");
    assert.equal(f.engine.state("a:2").status, "error");
    assert.equal(f.requests.length, 1);
    await f.engine.stop();
});
test("long single messages fail explicitly, smaller messages still run", async () => {
    const f = fixture(undefined, (config) => {
        config.maxChars = 100;
    });
    f.add(message(1, "a", "a".repeat(101)));
    f.add(message(2));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.engine.state("a:1").status, "error");
    assert.equal(f.engine.state("a:2").status, "done");
    await f.engine.stop();
});
test("shared concurrency prioritizes waiting manual work over new automatic batches", async () => {
    const completions: Array<(result: TranslationResult[]) => void> = [];
    const f = fixture(
        () => new Promise((r) => completions.push(r)),
        (config) => {
            config.concurrency = 1;
            config.maxItems = 1;
        },
    );
    f.add(message(1));
    f.add(message(2));
    f.setTime(1000);
    await f.engine.tick();
    const manual = f.engine.translateText("Hello", "en");
    await f.engine.tick();
    assert.equal(f.requests.length, 1);
    completions[0]!([{ id: "m0", text: "first" }]);
    await setImmediate();
    assert.equal(f.requests[1]!.items[0]!.id, "draft");
    completions[1]!([{ id: "draft", text: "Hello" }]);
    await manual;
    await f.engine.tick();
    assert.equal(f.requests.length, 3);
    completions[2]!([{ id: "m0", text: "second" }]);
    await setImmediate();
    await f.engine.stop();
});
test("stop aborts dispatched work and prevents late results", async () => {
    let finish!: (result: TranslationResult[]) => void;
    let signal: AbortSignal | undefined;
    const f = fixture((_req, s) => {
        signal = s;
        return new Promise((r) => {
            finish = r;
        });
    });
    f.add(message(1));
    f.setTime(1000);
    await f.engine.tick();
    await f.engine.stop();
    assert.equal(signal?.aborted, true);
    finish([{ id: "m0", text: "late" }]);
    await setImmediate();
    assert.equal(f.engine.state("a:1").translation, undefined);
});
