// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import {
    defaultConfig,
    presetRule,
    resolveRule,
    snapshotScopes,
    updateScopes,
    validateConfig,
} from "../src/core/config";
import { classify, cleanForDetection, translationTarget } from "../src/core/language";
import { protectText } from "../src/core/protection";
import { DraftSession } from "../src/core/draft";
import { DailyBudget } from "../src/core/cache";
import type { MessageInput } from "../src/core/types";

const en = [{ language: "en", score: 0.95 }];
const zh = [{ language: "zh", score: 0.95 }];
const message: MessageInput = {
    id: "1",
    channelId: "thread",
    parentId: "channel",
    guildId: "guild",
    text: "pending",
    speaker: "author",
    timestamp: 1,
};
test("scope precedence and thread inheritance preserve explicit disable", () => {
    const config = defaultConfig();
    config.servers.guild = presetRule("english");
    config.channels.channel = { enabled: false };
    assert.equal(resolveRule(config, message).enabled, false);
    config.channels.thread = { enabled: true, target: "en" };
    assert.equal(resolveRule(config, message).enabled, true);
    assert.equal(resolveRule(config, message).target, "en");
    assert.equal(resolveRule(config, message).preset, "english");
});
test("reactive scoped settings can be snapshotted without sharing mutable nested values", () => {
    const rule = presetRule("bilingual");
    const wrapped = new Proxy({ channel: new Proxy(rule, {}) }, {});
    assert.throws(() => structuredClone(wrapped), /could not be cloned/);
    const config = defaultConfig();
    config.channels = snapshotScopes(wrapped);
    validateConfig(config);
    assert.equal(resolveRule(config, { ...message, channelId: "channel" }).enabled, true);
    config.channels.channel!.sourceLanguages!.push("es");
    assert.deepEqual(rule.sourceLanguages, ["en"]);
});
test("adding a second scope removes nested proxies before native settings serialization", () => {
    const rule = presetRule("bilingual");
    const existing = new Proxy({ first: new Proxy(rule, {}) }, {});
    assert.throws(() => structuredClone({ ...existing, second: presetRule("english") }));
    const updated = updateScopes(existing, "second", presetRule("english"));
    assert.doesNotThrow(() => structuredClone(updated));
    assert.equal(updated.first!.preset, "bilingual");
    assert.equal(updated.second!.preset, "english");
    assert.equal(Object.keys(existing).length, 1);
    assert.deepEqual(Object.keys(updateScopes(updated, "second", null)), ["first"]);
});
test("global default is opt-in while Chinese preset is disabled", () => {
    assert.equal(defaultConfig().global.enabled, false);
    assert.equal(presetRule("chinese").enabled, false);
});
test("changing a daily limit preserves already reserved retry and request characters", () => {
    const budget = new DailyBudget(1000);
    budget.reserve(500);
    budget.setLimit(600);
    assert.throws(() => budget.reserve(101), /budget reached/);
    budget.reserve(100);
});
test("configuration rejects too-short visibility, excessive batches and malformed mappings", () => {
    const config = defaultConfig();
    config.visibleMs = 200;
    assert.throws(() => validateConfig(config));
    config.visibleMs = 1000;
    config.maxItems = 51;
    assert.throws(() => validateConfig(config));
    config.maxItems = 50;
    config.global.mappings = null as any;
    assert.throws(() => validateConfig(config));
});
test("Chinese, traditional Chinese, English and mixed text choose the expected gate", () => {
    const rule = presetRule("bilingual");
    assert.equal(
        translationTarget(
            rule,
            classify("出金已到账", [
                { language: "ja", score: 0.64 },
                { language: "zh", score: 0.34 },
            ]),
        ),
        null,
    );
    assert.equal(translationTarget(rule, classify("謝謝，已經收到。", zh)), null);
    assert.equal(translationTarget(rule, classify("Payout pending", en)), "zh-CN");
    assert.equal(classify("收到，payout is still pending.", en).kind, "mixed");
    assert.equal(classify("今天 ES 在 VWAP 上方", zh).kind, "chinese");
});
test("short English does not need a minimum-length gate; shared Han remains unknown", () => {
    const rule = presetRule("bilingual");
    assert.equal(
        translationTarget(rule, classify("pending", [{ language: "ms", score: 0.6 }])),
        "zh-CN",
    );
    assert.equal(translationTarget(rule, classify("why?", [])), "zh-CN");
    assert.equal(classify("出金", [{ language: "ja", score: 0.9 }]).kind, "unknown");
    assert.equal(translationTarget(rule, classify("東京", [{ language: "ja", score: 0.9 }])), null);
});
test("unexpected foreign languages retain their label and are translated", () => {
    const d = classify("Hola, gracias por la información.", [{ language: "es", score: 0.98 }]);
    assert.equal(d.language, "es");
    assert.equal(translationTarget(presetRule("english"), d), "zh-CN");
});
test("specified source languages reject unknown labels; mappings preserve Chinese translation ability", () => {
    const selected = { ...presetRule("bilingual"), mode: "selected" as const };
    assert.equal(translationTarget(selected, classify("pending", [])), null);
    assert.equal(translationTarget(selected, classify("Payout pending", en)), "zh-CN");
    const mappings = { ...selected, mode: "mappings" as const, mappings: { zh: "en" } };
    assert.equal(translationTarget(mappings, classify("请问什么时候出金？", zh)), "en");
});
test("pure noise and standalone trading symbols are skipped", () => {
    for (const text of [
        "12345",
        "👍",
        "https://example.test",
        "<@123>",
        "`console.log(1)`",
        "ES VWAP",
    ]) {
        assert.equal(classify(text, en).kind, "nonlinguistic", text);
    }
    assert.equal(cleanForDetection("Hello <@123> https://example.test"), "Hello");
});
test("mixed Chinese and Discord tokens survive translation; malformed placeholders are rejected", () => {
    const protectedText = protectText(
        "收到，pending <@123> `code` https://example.test ES",
        ["ES"],
        true,
    );
    const translated = protectedText.text.replace("pending", "尚待处理");
    assert.equal(
        protectedText.restore(translated),
        "收到，尚待处理 <@123> `code` https://example.test ES",
    );
    assert.throws(() => protectedText.restore("bad"));
    assert.throws(() => protectedText.restore(translated + "[[CT0]]"));
    assert.throws(() => protectedText.restore(translated + "[[CT99]]"));
});
test("source placeholder collisions and literal dollars round-trip", () => {
    const protectedText = protectText("[[CT0]] `a $& b` pending", []);
    assert.equal(protectedText.restore(protectedText.text), "[[CT0]] `a $& b` pending");
});
test("draft apply/restore reject channel changes and continued typing", () => {
    const original = { channelId: "a", text: "你好" };
    const session = new DraftSession(original);
    assert.throws(() => session.apply({ channelId: "b", text: "你好" }, "Hello"));
    assert.throws(() => session.apply({ channelId: "a", text: "你好呀" }, "Hello"));
    assert.equal(session.apply(original, "Hello"), "Hello");
    session.confirmApplied("Hello");
    assert.throws(() => session.restore({ channelId: "a", text: "Hello!" }));
    assert.equal(session.restore({ channelId: "a", text: "Hello" }), "你好");
});
test("daily budget reserves each request and resets on the next UTC date", () => {
    let now = new Date("2026-10-10T01:00:00Z");
    const budget = new DailyBudget(100, () => now);
    budget.reserve(80);
    assert.throws(() => budget.reserve(21));
    now = new Date("2026-10-11T01:00:00Z");
    assert.doesNotThrow(() => budget.reserve(100));
});
