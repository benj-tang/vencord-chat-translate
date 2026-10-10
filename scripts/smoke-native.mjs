// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

await mkdir(".cache", { recursive: true });
await build({
    entryPoints: ["dist/chatTranslate.desktop/native.ts"],
    outfile: ".cache/native-smoke.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
});
const native = (await import(pathToFileURL(resolve(".cache/native-smoke.cjs")).href)).default;
let requestSeen = 0;
let sawSlow;
const slowStarted = new Promise((resolve) => {
    sawSlow = resolve;
});
const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    assert.equal(req.headers.authorization, "Bearer synthetic-test-key");
    requestSeen++;
    if (data.model === "slow-test") {
        sawSlow();
        return;
    }
    const request = JSON.parse(data.messages[1].content);
    assert.equal(request.items.length, 2);
    assert.equal(request.items[1].mode, "context");
    res.setHeader("content-type", "application/json");
    res.end(
        JSON.stringify({
            choices: [
                {
                    finish_reason: "stop",
                    message: { content: '[{"id":"m0","text":"你好"}]' },
                },
            ],
        }),
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const config = {
    endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    model: "synthetic-test",
    apiKey: "synthetic-test-key",
    timeoutMs: 30000,
    maxOutputTokens: 6000,
};
const request = {
    target: "zh-CN",
    glossary: {},
    items: [
        { id: "m0", text: "Hello", mode: "translate", speaker: "a0", source: "en" },
        { id: "m1", text: "收到", mode: "context", speaker: "a1", source: "zh" },
    ],
};
try {
    const detection = await native.detectLanguages(null, ["Your payout has been processed."]);
    assert.equal(detection[0][0].language, "en");
    const translation = await native.translateBatch(null, "native-test", config, request);
    assert.equal(translation.ok, true);
    assert.deepEqual(translation.results, [{ id: "m0", text: "你好" }]);
    assert.match(translation.cacheNamespace, /^[a-f0-9]{64}$/);
    const pending = native.translateBatch(
        null,
        "cancel-test",
        { ...config, model: "slow-test" },
        request,
    );
    await slowStarted;
    await native.cancelRequest(null, "cancel-test");
    const cancelled = await pending;
    assert.equal(cancelled.ok, false);
    assert.match(cancelled.error, /cancelled/);
    assert.equal(requestSeen, 2);
    console.log(
        "Native bundle smoke test passed: embedded worker, real loopback HTTP batch, and cancellation.",
    );
} finally {
    await native.stopNative(null);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
}
