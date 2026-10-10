// SPDX-License-Identifier: GPL-3.0-or-later
import { parentPort } from "node:worker_threads";
import fastTextModule from "fasttext.wasm.js/dist/core/fastText.node.js";
import type { Candidate } from "../core/types";

declare const CT_WASM_BASE64: string;
declare const CT_MODEL_BASE64: string;

interface Vector {
    size(): number;
    get(i: number): [number, string];
    delete(): void;
}
interface Model {
    loadModel(path: string): void;
    predict(text: string, top: number, threshold: number): Vector;
}

let model: Model | null = null;
const ready = fastTextModule({
    wasmBinary: Buffer.from(CT_WASM_BASE64, "base64"),
    print: () => {},
    printErr: () => {},
}).then((module: any) => {
    module.FS.writeFile("/lid.ftz", Buffer.from(CT_MODEL_BASE64, "base64"));
    model = new module.FastText() as Model;
    model.loadModel("/lid.ftz");
    parentPort?.postMessage({ type: "ready" });
});

parentPort?.on("message", async ({ id, texts }: { id: number; texts: string[] }) => {
    try {
        await ready;
        if (
            !Array.isArray(texts) ||
            texts.length > 500 ||
            !texts.every((text) => typeof text === "string" && text.length <= 50000)
        ) {
            throw new Error("Invalid detection input");
        }
        const results = texts.map((text): Candidate[] => {
            if (!text.trim()) return [];
            const vector = model!.predict(text.replace(/\s+/gu, " ").trim(), 3, 0);
            try {
                return Array.from({ length: vector.size() }, (_, i) => {
                    const [score, label] = vector.get(i);
                    return { language: label.replace("__label__", ""), score };
                });
            } finally {
                vector.delete();
            }
        });
        parentPort?.postMessage({ id, results });
    } catch {
        parentPort?.postMessage({ id, error: "Local language detection failed" });
    }
});

ready.catch(() =>
    parentPort?.postMessage({ type: "error", error: "Local model could not initialize" }),
);
