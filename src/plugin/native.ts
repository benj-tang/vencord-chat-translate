// SPDX-License-Identifier: GPL-3.0-or-later
import type { IpcMainInvokeEvent } from "electron";
import { ChatCompletionTranslator } from "../core/provider";
import type { ProviderConfig, TranslationRequest } from "../core/types";
import { WorkerDetector } from "../native/detector";
import { resolveProviderConfig } from "../native/profile";
import workerSource from "./generated/worker.json";

const detector = new WorkerDetector(workerSource);
let translator: ChatCompletionTranslator | null = null;
let providerRevision = "";
const requests = new Map<string, AbortController>();

// Chromium uses the client's system certificate trust, including private LAN CAs.
const nativeFetch: typeof fetch = async (input, init) => {
    if (!process.versions.electron) return fetch(input, init);
    const { net } = await import("electron");
    return net.fetch(input, init);
};

export async function detectLanguages(_: IpcMainInvokeEvent, texts: string[]) {
    if (
        !Array.isArray(texts) ||
        texts.length > 500 ||
        !texts.every((text) => typeof text === "string" && text.length <= 50000)
    ) {
        throw new Error("Invalid detection input");
    }
    return detector.detect(texts);
}

export async function translateBatch(
    _: IpcMainInvokeEvent,
    id: string,
    config: ProviderConfig,
    request: TranslationRequest,
) {
    if (
        typeof id !== "string" ||
        id.length > 100 ||
        requests.has(id) ||
        !request ||
        !Array.isArray(request.items) ||
        request.items.length > 50 ||
        JSON.stringify(request).length > 200000
    )
        throw new Error("Invalid translation request");
    const controller = new AbortController();
    requests.set(id, controller);
    try {
        const resolved = await resolveProviderConfig(config);
        const revision = JSON.stringify(resolved);
        if (revision !== providerRevision) {
            translator = new ChatCompletionTranslator(resolved, nativeFetch);
            providerRevision = revision;
        }
        const activeTranslator = translator!;
        const results = await activeTranslator.translate(request, controller.signal);
        return { ok: true as const, results };
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Translation failed",
        };
    } finally {
        requests.delete(id);
    }
}

export async function cancelRequest(_: IpcMainInvokeEvent, id: string) {
    requests.get(id)?.abort();
}

export async function stopNative(_: IpcMainInvokeEvent) {
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    await detector.close();
    translator = null;
    providerRevision = "";
}
