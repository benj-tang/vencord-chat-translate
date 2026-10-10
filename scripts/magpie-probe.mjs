// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

export async function runProbe(native) {
    const config = {
        endpoint: "",
        model: "",
        apiKey: "",
        useLocalProfile: true,
        timeoutMs: 30000,
        maxOutputTokens: 6000,
    };
    const fixtures = [
        {
            name: "incoming-context",
            target: "zh-CN",
            glossary: { payout: "出金" },
            items: [
                {
                    id: "m0",
                    text: "Your payout is pending review.",
                    mode: "translate",
                    source: "en",
                    speaker: "a0",
                },
                {
                    id: "m1",
                    text: "Do not close the account before it is approved.",
                    mode: "translate",
                    source: "en",
                    speaker: "a0",
                    replyTo: "m0",
                },
                {
                    id: "m2",
                    text: "Keep the $125 fee and [[CT0]] unchanged.",
                    mode: "translate",
                    source: "en",
                    speaker: "a1",
                },
                {
                    id: "m3",
                    text: "请保留所有金额和否定条件。",
                    mode: "context",
                    source: "zh",
                    speaker: "a2",
                },
            ],
        },
        {
            name: "draft-to-english",
            target: "en",
            glossary: {},
            items: [
                {
                    id: "draft0",
                    text: "你好，请问出金审核预计需要多久？",
                    mode: "translate",
                    source: "zh",
                    speaker: "self",
                },
            ],
        },
        {
            name: "batch-50",
            target: "zh-CN",
            glossary: { payout: "出金" },
            items: Array.from({ length: 50 }, (_, i) => ({
                id: `batch${i}`,
                text:
                    i < 5
                        ? `Context: ticket ${i} is under review.`
                        : `Ticket ${i}: the payout is still pending. Do not resubmit it.`,
                mode: i < 5 ? "context" : "translate",
                source: "en",
                speaker: `a${i % 3}`,
            })),
        },
    ];
    const report = {
        electron: process.versions.electron,
        date: new Date().toISOString(),
        probes: [],
    };
    for (const fixture of fixtures) {
        const { name, ...request } = fixture;
        const start = Date.now();
        const response = await native.translateBatch(null, name, config, request);
        assert.equal(response.ok, true, `${name}: ${response.error ?? "failed"}`);
        const expected = request.items
            .filter((item) => item.mode === "translate")
            .map((item) => item.id);
        assert.deepEqual(response.results.map((r) => r.id).sort(), expected.sort());
        if (name === "incoming-context") {
            const protectedResult = response.results.find((r) => r.id === "m2").text;
            assert.equal(protectedResult.split("[[CT0]]").length - 1, 1);
            assert.match(protectedResult, /125/);
            const condition = response.results.find((r) => r.id === "m1").text;
            assert.match(condition, /出金/);
            assert.match(condition, /勿|不要|不可|不能|别/u);
        }
        if (name === "draft-to-english")
            assert.doesNotMatch(response.results[0].text, /[\u4e00-\u9fff]/u);
        const row = {
            name,
            elapsedMs: Date.now() - start,
            inputItems: request.items.length,
            translatedItems: response.results.length,
            results: response.results,
        };
        report.probes.push(row);
        console.log(JSON.stringify({ ...row, results: row.results.slice(0, 3) }));
    }
    await writeFile(".cache/magpie-smoke.json", JSON.stringify(report, null, 2) + "\n");
    console.log(
        "Magpie native integration passed using isolated Electron, private local profile, system TLS trust and synthetic dialogue.",
    );
}
