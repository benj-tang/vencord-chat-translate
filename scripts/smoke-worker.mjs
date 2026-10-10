// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";

const source = await readFile(new URL("../dist/detector-worker.cjs", import.meta.url), "utf8");
const worker = new Worker(source, { eval: true });
const timeout = setTimeout(() => {
    console.error("Worker smoke test timed out");
    void worker.terminate();
    process.exitCode = 1;
}, 10000);
try {
    const result = await new Promise((resolve, reject) => {
        worker.on("error", reject);
        worker.on("message", (message) => {
            if (message.error) reject(new Error(message.error));
            if (message.id === 1) resolve(message.results);
        });
        worker.postMessage({
            id: 1,
            texts: ["Your payout has been processed.", "请问什么时候可以申请提款？", ""],
        });
    });
    assert.equal(result[0][0].language, "en");
    assert.equal(result[1][0].language, "zh");
    assert.deepEqual(result[2], []);
    console.log("Embedded local worker smoke test passed (English, Chinese, empty input).");
} finally {
    clearTimeout(timeout);
    await worker.terminate();
}
