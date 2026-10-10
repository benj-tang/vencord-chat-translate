// SPDX-License-Identifier: GPL-3.0-or-later
import type { IpcMainInvokeEvent } from "electron";
import { ChatCompletionTranslator, ProviderError, type ProviderUsage } from "../core/provider";
import type { ProviderConfig, TranslationRequest } from "../core/types";
import { WorkerDetector } from "../native/detector";
import { resolveProviderConfig } from "../native/profile";
import { PersistentTranslationCache, providerNamespace, type CacheOptions } from "../native/cache";
import workerSource from "./generated/worker.json";

const detector = new WorkerDetector(workerSource);
let translator: ChatCompletionTranslator | null = null;
let providerRevision = "";
const requests = new Map<string, AbortController>();
const diskCache = new PersistentTranslationCache();
let detectionCalls = 0;
let detectionItems = 0;
const recentBatches: Array<
    {
        kind: "automatic" | "onDemand";
        targets: number;
        context: number;
        results: number;
        elapsedMs: number;
        status: "running" | "success" | "error";
    } & ProviderUsage
> = [];

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
    detectionCalls++;
    detectionItems += texts.length;
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
    const started = performance.now();
    // Keep counts only; diagnostic history never retains chat text, IDs or credentials.
    const batch = {
        kind: request.items.every((item) => item.id === "draft")
            ? ("onDemand" as const)
            : ("automatic" as const),
        targets: request.items.filter((item) => item.mode === "translate").length,
        context: request.items.filter((item) => item.mode === "context").length,
        results: 0,
        elapsedMs: 0,
        status: "running" as "running" | "success" | "error",
        reasoningTokens: null as number | null,
        completionTokens: null as number | null,
    };
    recentBatches.push(batch);
    if (recentBatches.length > 20) recentBatches.shift();
    try {
        const resolved = await resolveProviderConfig(config);
        const revision = JSON.stringify(resolved);
        if (revision !== providerRevision) {
            translator = new ChatCompletionTranslator(resolved, nativeFetch);
            providerRevision = revision;
        }
        const activeTranslator = translator!;
        const results = await activeTranslator.translate(request, controller.signal, (usage) => {
            Object.assign(batch, usage);
        });
        batch.results = results.length;
        batch.status = "success";
        return { ok: true as const, results, cacheNamespace: providerNamespace(resolved) };
    } catch (error) {
        batch.status = "error";
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Translation failed",
            retryable: error instanceof ProviderError && error.retryable,
            retryAfterMs: error instanceof ProviderError ? error.retryAfterMs : 0,
            pause: error instanceof ProviderError ? error.pause : null,
        };
    } finally {
        batch.elapsedMs = Math.round(performance.now() - started);
        requests.delete(id);
    }
}

export async function getDiagnostics(_: IpcMainInvokeEvent) {
    return {
        detectionCalls,
        detectionItems,
        batches: recentBatches.map((batch) => ({ ...batch })),
        cache: diskCache.stats(),
    };
}

function validateCacheKeys(keys: string[]) {
    if (
        !Array.isArray(keys) ||
        keys.length > 50 ||
        !keys.every((key) => typeof key === "string" && key.length <= 100000) ||
        JSON.stringify(keys).length > 2000000
    )
        throw new Error("Invalid cache keys");
}

export async function getCachedTranslations(
    _: IpcMainInvokeEvent,
    config: ProviderConfig,
    keys: string[],
    options: CacheOptions,
) {
    validateCacheKeys(keys);
    const provider = await resolveProviderConfig(config);
    return diskCache.get(providerNamespace(provider), keys, options);
}

export async function storeCachedTranslations(
    _: IpcMainInvokeEvent,
    values: Record<string, string>,
    options: CacheOptions,
    namespace: string,
) {
    if (!values || typeof values !== "object" || JSON.stringify(values).length > 4000000)
        throw new Error("Invalid cached translations");
    validateCacheKeys(Object.keys(values));
    if (typeof namespace !== "string" || !/^[a-f0-9]{64}$/.test(namespace))
        throw new Error("Invalid cache provider identity");
    await diskCache.set(namespace, values, options);
}

export async function clearCachedTranslations(_: IpcMainInvokeEvent) {
    await diskCache.clear();
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
