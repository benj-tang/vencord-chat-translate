// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { defaultConfig, presetRule } from "../src/core/config";
import { TranslationEngine } from "../src/core/scheduler";
import { messageKey } from "../src/core/types";
import { ProviderError } from "../src/core/provider";
import { DailyBudget, Lru } from "../src/core/cache";
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
test("transient failures retry bounded batches after 2 and 5 seconds", async () => {
    let calls = 0;
    const f = fixture(async (request) => {
        if (++calls <= 2) throw new ProviderError("Temporary upstream failure", true);
        return request.items
            .filter((item) => item.mode === "translate")
            .map((item) => ({ id: item.id, text: "成功" }));
    });
    for (let i = 1; i <= 30; i++) f.add(message(i));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.engine.failureSummary("a").retrying, 30);
    f.setTime(2999);
    await f.engine.tick();
    assert.equal(calls, 1);
    f.setTime(3000);
    await f.engine.tick();
    await setImmediate();
    f.setTime(7999);
    await f.engine.tick();
    assert.equal(calls, 2);
    f.setTime(8000);
    await f.engine.tick();
    await setImmediate();
    assert.deepEqual(
        f.requests.map((request) => request.items.length),
        [30, 30, 30],
    );
    assert.equal(f.engine.failureSummary("a").failed, 0);
    assert.equal(f.engine.failureSummary("a").retrying, 0);
    assert.equal(f.engine.state("a:1").status, "done");
    await f.engine.stop();
});
test("retry exhaustion pauses new automatic work and aggregates visible failures", async () => {
    const f = fixture(async () => {
        throw new ProviderError("Temporary failure", true);
    });
    f.add(message(1));
    f.add(message(2));
    for (const time of [1000, 3000, 8000]) {
        f.setTime(time);
        await f.engine.tick();
        await setImmediate();
    }
    assert.equal(f.requests.length, 3);
    assert.deepEqual(f.engine.failureSummary("a"), {
        failed: 2,
        retrying: 0,
        pause: { kind: "service", remainingMs: null },
    });
    f.add(message(3));
    f.setTime(100000);
    await f.engine.tick();
    assert.equal(f.requests.length, 3);
    f.engine.setVisible("a:1", false);
    assert.equal(f.engine.failureSummary("a").failed, 1);
    await f.engine.stop();
});
test("retrying a failed batch never resends offscreen targets", async () => {
    let calls = 0;
    const f = fixture(async (request) => {
        if (++calls === 1) throw new ProviderError("Temporary failure", true);
        return request.items
            .filter((item) => item.mode === "translate")
            .map((item) => ({ id: item.id, text: "成功" }));
    });
    f.add(message(1));
    f.add(message(2));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    f.engine.setVisible("a:1", false);
    f.setTime(3000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.requests[1]!.items.length, 1);
    assert.equal(f.engine.state("a:2").status, "done");
    assert.equal(f.engine.state("a:1").translation, undefined);
    await f.engine.stop();
});
test("429 blocks new automatic work until Retry-After, then retries as a batch", async () => {
    let calls = 0;
    const f = fixture(async (request) => {
        if (++calls === 1) throw new ProviderError("HTTP 429", false, 10000, "rateLimit");
        return request.items
            .filter((item) => item.mode === "translate")
            .map((item) => ({ id: item.id, text: "成功" }));
    });
    f.add(message(1));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    f.add(message(2));
    f.setTime(10999);
    await f.engine.tick();
    assert.equal(f.requests.length, 1);
    f.setTime(11000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1]!.items.filter((item) => item.mode === "translate").length, 2);
    await f.engine.stop();
});
test("credentials pause without automatic retries; an explicit retry can resume", async () => {
    let fixed = false;
    const f = fixture(async (request) => {
        if (!fixed) throw new ProviderError("HTTP 401", false, 0, "credentials");
        return request.items
            .filter((item) => item.mode === "translate")
            .map((item) => ({ id: item.id, text: "成功" }));
    });
    f.add(message(1));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.engine.failureSummary("a").pause?.kind, "credentials");
    f.setTime(100000);
    await f.engine.tick();
    assert.equal(f.requests.length, 1);
    fixed = true;
    f.engine.retryVisible("a");
    await setImmediate();
    assert.equal(f.requests.length, 2);
    assert.equal(f.engine.state("a:1").status, "done");
    await f.engine.stop();
});
test("retry-all sends only visible failed targets, retaining successes only as context", async () => {
    let calls = 0;
    const f = fixture(async (request) => {
        calls++;
        return calls === 1
            ? [{ id: "m0", text: "成功" }]
            : request.items
                  .filter((item) => item.mode === "translate")
                  .map((item) => ({ id: item.id, text: "补译" }));
    });
    f.add(message(1));
    f.add(message(2));
    f.setTime(1000);
    await f.engine.tick();
    await setImmediate();
    assert.equal(f.engine.failureSummary("a").failed, 1);
    f.engine.retryVisible("a");
    await setImmediate();
    assert.deepEqual(
        f.requests[1]!.items.map((item) => item.mode),
        ["context", "translate"],
    );
    assert.equal(f.engine.state("a:1").translation, "成功");
    assert.equal(f.engine.state("a:2").translation, "补译");
    await f.engine.stop();
});
test("automatic retries can be disabled and format failures never retry blindly", async () => {
    for (const retryable of [true, false]) {
        const f = fixture(
            async () => {
                throw new ProviderError("Failure", retryable);
            },
            (config) => {
                config.autoRetryCount = 0;
            },
        );
        f.add(message(1));
        f.setTime(1000);
        await f.engine.tick();
        await setImmediate();
        f.setTime(10000);
        await f.engine.tick();
        assert.equal(f.requests.length, 1);
        assert.equal(f.engine.state("a:1").status, "error");
        await f.engine.stop();
    }
});
test("scope-only engine reloads reuse translations, while target and glossary changes miss cache", async () => {
    const cache = new Lru<string>(1000);
    let calls = 0;
    let time = 0;
    const translate: Translator = {
        translate: async (request) => {
            calls++;
            return request.items
                .filter((item) => item.mode === "translate")
                .map((item) => ({ id: item.id, text: "成功" }));
        },
    };
    const config = defaultConfig();
    config.channels.a = presetRule("bilingual");
    const create = (value: AppConfig) =>
        new TranslationEngine(value, detector, translate, () => time, cache);
    const first = create(config);
    first.upsert(message(1));
    first.setVisible("a:1", true);
    time = 1000;
    await first.tick();
    await setImmediate();
    assert.equal(calls, 1);
    await first.stop(true);
    const updated = structuredClone(config);
    updated.channels.b = presetRule("english");
    updated.autoRetryCount = 0;
    const second = create(updated);
    second.upsert(message(1));
    second.setVisible("a:1", true);
    time = 2000;
    await second.tick();
    await setImmediate();
    assert.equal(calls, 1);
    assert.equal(second.state("a:1").translation, "成功");
    await second.stop(true);
    updated.channels.a!.target = "en";
    const third = create(updated);
    third.upsert(message(1));
    assert.equal(third.state("a:1").translation, undefined);
    await third.stop(true);
    updated.channels.a!.target = "zh-CN";
    updated.glossary.payout = "提取";
    const fourth = create(updated);
    fourth.upsert(message(1));
    assert.equal(fourth.state("a:1").translation, undefined);
    await fourth.stop();
});
test("a shared daily budget survives scope reload and stops retries without new provider calls", async () => {
    const budget = new DailyBudget(700);
    const cache = new Lru<string>(1000);
    const config = defaultConfig();
    config.global = presetRule("bilingual");
    config.maxDailyChars = 700;
    let time = 0;
    let calls = 0;
    const translator: Translator = {
        translate: async (request) => {
            calls++;
            return request.items
                .filter((item) => item.mode === "translate")
                .map((item) => ({ id: item.id, text: "成功" }));
        },
    };
    const first = new TranslationEngine(config, detector, translator, () => time, cache, budget);
    first.upsert(message(1, "a", "A".repeat(350)));
    first.setVisible("a:1", true);
    time = 1000;
    await first.tick();
    await setImmediate();
    assert.equal(calls, 1);
    await first.stop(true);
    const second = new TranslationEngine(config, detector, translator, () => time, cache, budget);
    second.upsert(message(2, "a", "B".repeat(350)));
    second.setVisible("a:2", true);
    time = 2000;
    await second.tick();
    await setImmediate();
    assert.equal(calls, 1);
    assert.equal(second.failureSummary("a").pause?.kind, "budget");
    second.retryVisible("a");
    await setImmediate();
    assert.equal(calls, 1);
    await second.stop();
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
