// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { ChatCompletionTranslator, validateProvider, validateResults } from "../src/core/provider";
import type { ProviderConfig, TranslationRequest } from "../src/core/types";

const config: ProviderConfig = {
    endpoint: "https://translator.example.test/v1/chat/completions",
    model: "test-model",
    apiKey: "synthetic-secret",
    timeoutMs: 1000,
    maxOutputTokens: 6000,
};
const request: TranslationRequest = {
    target: "zh-CN",
    glossary: {},
    items: [
        { id: "m0", text: "Hello", speaker: "a0", mode: "translate", source: "en" },
        { id: "m1", text: "你好", speaker: "a1", mode: "context", source: "zh" },
    ],
};
test("provider permits HTTPS and loopback HTTP, rejects insecure URLs and credentials", () => {
    assert.doesNotThrow(() => validateProvider(config));
    assert.doesNotThrow(() =>
        validateProvider({ ...config, endpoint: "http://127.0.0.1:8080/v1/chat/completions" }),
    );
    for (const endpoint of [
        "http://lan.test/v1",
        "https://user:pass@example.test",
        "file:///tmp/model",
        "https://example.test?key=secret",
    ]) {
        assert.throws(() => validateProvider({ ...config, endpoint }));
    }
});
test("response rejects duplicate, extra, empty and invalid IDs; missing IDs remain partial", () => {
    for (const rows of [
        [
            { id: "m0", text: "你好" },
            { id: "m0", text: "你好" },
        ],
        [{ id: "m1", text: "你好" }],
        [{ id: "unknown", text: "你好" }],
        [{ id: "m0", text: "" }],
        [{ id: 1, text: "你好" }],
    ])
        assert.throws(() => validateResults(rows, request));
    assert.deepEqual(validateResults([], request), []);
});
test("adapter sends contextual request and parses JSON fences without reasoning tags", async () => {
    let payload: any;
    const adapter = new ChatCompletionTranslator(config, (async (_url, init) => {
        payload = JSON.parse(init!.body as string);
        assert.equal(init!.redirect, "error");
        assert.equal(init!.credentials, "omit");
        assert.equal(
            (init!.headers as Record<string, string>).Authorization,
            "Bearer synthetic-secret",
        );
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        message: { content: '```json\n[{"id":"m0","text":"你好"}]\n```' },
                        finish_reason: "stop",
                    },
                ],
            }),
        );
    }) as typeof fetch);
    assert.deepEqual(await adapter.translate(request), [{ id: "m0", text: "你好" }]);
    assert.deepEqual(JSON.parse(payload.messages[1].content), request);
});
test("credential errors pause subsequent calls and never include body or key in errors", async () => {
    let calls = 0;
    const adapter = new ChatCompletionTranslator(config, (async () => {
        calls++;
        return new Response("synthetic-secret private-message", { status: 401 });
    }) as typeof fetch);
    await assert.rejects(
        adapter.translate(request),
        /^Error: Translation provider returned HTTP 401$/,
    );
    await assert.rejects(adapter.translate(request), /paused/);
    assert.equal(calls, 1);
});
test("429 pauses the adapter instead of immediately retrying", async () => {
    let calls = 0;
    const adapter = new ChatCompletionTranslator(config, (async () => {
        calls++;
        return new Response("", { status: 429, headers: { "retry-after": "10" } });
    }) as typeof fetch);
    await assert.rejects(adapter.translate(request), /HTTP 429/);
    await assert.rejects(adapter.translate(request), /rate limit/);
    assert.equal(calls, 1);
});
test("truncated and malformed model responses cannot become translations", async () => {
    for (const data of [
        { choices: [{ finish_reason: "length", message: { content: "[]" } }] },
        { choices: [{ message: { content: "<think>not JSON</think>" } }] },
        { choices: [] },
    ]) {
        const adapter = new ChatCompletionTranslator(
            config,
            (async () => new Response(JSON.stringify(data))) as typeof fetch,
        );
        await assert.rejects(adapter.translate(request));
    }
});
test("a pre-cancelled request never starts a provider request", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const adapter = new ChatCompletionTranslator(config, (async () => {
        calls++;
        throw new Error("secret upstream details");
    }) as typeof fetch);
    await assert.rejects(adapter.translate(request, controller.signal), /cancelled or timed out/);
    assert.equal(calls, 0);
});
test("Magpie effort is explicit and separate reasoning is never rendered as a translation", async () => {
    const adapter = new ChatCompletionTranslator({ ...config, reasoningEffort: "low" }, (async (
        _url,
        init,
    ) => {
        const payload = JSON.parse(init!.body as string);
        assert.equal(payload.reasoning_effort, "low");
        assert.equal(payload.thinking, undefined);
        return new Response(
            JSON.stringify({
                choices: [
                    {
                        finish_reason: "stop",
                        message: {
                            reasoning_content: "Synthetic reasoning that must stay private.",
                            content: '[{"id":"m0","text":"你好"}]',
                        },
                    },
                ],
            }),
        );
    }) as typeof fetch);
    assert.deepEqual(await adapter.translate(request), [{ id: "m0", text: "你好" }]);
    assert.throws(() => validateProvider({ ...config, reasoningEffort: "none" as "low" }));
});
