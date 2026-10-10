// SPDX-License-Identifier: GPL-3.0-or-later
import { DailyBudget, Lru, type PersistentTranslations } from "./cache";
import { resolveRule, validateConfig } from "./config";
import { classify, translationTarget } from "./language";
import { protectText } from "./protection";
import { ProviderError, validateResults } from "./provider";
import { messageKey } from "./types";
import type {
    AppConfig,
    Candidate,
    Detection,
    LocalDetector,
    MessageInput,
    TranslationItem,
    TranslationRequest,
    Translator,
    ViewState,
} from "./types";

interface Entry {
    message: MessageInput;
    visibleSince: number | null;
    state: ViewState;
    detection: Detection | null;
    considered: boolean;
    attempts: number;
    retryAt: number;
}

export interface AutomaticPause {
    kind: "credentials" | "rateLimit" | "service" | "budget" | "local";
    until: number | null;
}

interface Prepared {
    request: TranslationRequest;
    restore: Map<string, (text: string) => string>;
    entries: Array<{ key: string; text: string; version: string | undefined; cacheKey: string }>;
}

export class TranslationEngine {
    private entries = new Map<string, Entry>();
    private detectionCache = new Lru<Candidate[]>(2000);
    private listeners = new Set<() => void>();
    private active = true;
    private stopped = false;
    private checking = false;
    private running = 0;
    private manualWaiting = 0;
    private controllers = new Set<AbortController>();
    private slotListeners = new Set<() => void>();
    private pause: AutomaticPause | null = null;
    private cacheEpoch = 0;

    constructor(
        readonly config: AppConfig,
        private readonly detector: LocalDetector,
        private readonly translator: Translator,
        private readonly clock = () => performance.now(),
        private readonly translations = new Lru<string>(1000),
        private readonly budget = new DailyBudget(config.maxDailyChars),
        private readonly persistent?: PersistentTranslations,
    ) {
        validateConfig(config);
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    private emit(): void {
        for (const listener of this.listeners) listener();
    }

    private cacheKey(message: MessageInput, target: string): string {
        return JSON.stringify([
            message.channelId,
            message.id,
            message.text,
            message.version,
            target,
            this.config.preserveTerms,
            this.config.glossary,
        ]);
    }

    private async hydrate(
        messages: Array<{ message: MessageInput; target: string }>,
    ): Promise<void> {
        if (!this.persistent || this.stopped) return;
        const epoch = this.cacheEpoch;
        const missing = messages.filter(
            ({ message, target }) =>
                this.translations.get(this.cacheKey(message, target)) === undefined,
        );
        for (let offset = 0; offset < missing.length; offset += 50) {
            const chunk = missing.slice(offset, offset + 50);
            const keys = chunk.map(({ message, target }) => this.cacheKey(message, target));
            try {
                const cached = await this.persistent.get(keys);
                if (this.stopped || this.cacheEpoch !== epoch) return;
                chunk.forEach(({ message }, i) => {
                    const value = cached[keys[i]!];
                    if (typeof value !== "string") return;
                    try {
                        const restored = protectText(message.text, []).restore(value);
                        this.translations.set(keys[i]!, restored);
                    } catch {
                        // A stale or tampered protected value is a cache miss, never a displayed result.
                    }
                });
            } catch {
                // Disk availability must not block translation or create message-level errors.
            }
        }
    }

    private async persist(
        values: Array<{ key: string; original: string; text: string }>,
        request: TranslationRequest,
    ): Promise<void> {
        if (!this.persistent || this.stopped || !values.length) return;
        const encoded: Record<string, string> = {};
        for (const { key, original, text } of values) {
            try {
                encoded[key] = protectText(original, []).encode(text);
            } catch {
                // Keep a valid session translation even if it cannot be safely encoded for disk.
            }
        }
        if (Object.keys(encoded).length)
            await this.persistent.set(encoded, request).catch(() => {});
    }

    upsert(message: MessageInput): void {
        if (this.stopped) return;
        const key = messageKey(message);
        const old = this.entries.get(key);
        if (old && old.message.text === message.text && old.message.version === message.version) {
            old.message = message;
            return;
        }
        const target = resolveRule(this.config, message).target;
        const cached = this.translations.get(this.cacheKey(message, target));
        this.entries.set(key, {
            message,
            visibleSince: old?.visibleSince == null ? null : this.clock(),
            state: cached ? { status: "done", translation: cached } : { status: "idle" },
            detection: null,
            considered: !!cached,
            attempts: 0,
            retryAt: 0,
        });
        this.emit();
    }
    remove(key: string): void {
        this.entries.delete(key);
        this.emit();
    }
    state(key: string): ViewState {
        return this.entries.get(key)?.state ?? { status: "idle" };
    }
    hide(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) return;
        entry.considered = true;
        entry.state = { status: "idle" };
        this.emit();
    }
    setVisible(key: string, visible: boolean): void {
        const entry = this.entries.get(key);
        if (!entry) return;
        if (!visible) {
            entry.visibleSince = null;
            if (entry.state.status === "queued") entry.state = { status: "idle" };
        } else if (entry.visibleSince === null && this.active) entry.visibleSince = this.clock();
    }
    setActive(active: boolean): void {
        this.active = active;
        if (!active) for (const entry of this.entries.values()) entry.visibleSince = null;
    }
    private eligible(entry: Entry): boolean {
        return (
            this.active &&
            entry.visibleSince !== null &&
            this.clock() - entry.visibleSince >= this.config.visibleMs
        );
    }
    private fail(
        key: string,
        text: string,
        error: string,
        version?: string,
        automatic = true,
    ): void {
        const entry = this.entries.get(key);
        if (entry?.message.text !== text || entry.message.version !== version) return;
        entry.state = { status: "error", error, automatic };
        entry.considered = true;
    }

    async tick(): Promise<void> {
        if (this.pause && this.pause.until !== null && this.clock() >= this.pause.until)
            this.pause = null;
        if (
            !this.active ||
            this.stopped ||
            this.checking ||
            this.manualWaiting ||
            this.running >= this.config.concurrency ||
            this.pause
        )
            return;
        this.checking = true;
        try {
            const eligible = [...this.entries.entries()].filter(
                ([, entry]) =>
                    !entry.considered &&
                    this.eligible(entry) &&
                    !["loading", "error", "done"].includes(entry.state.status) &&
                    resolveRule(this.config, entry.message).enabled,
            );
            for (const [key, entry] of eligible) {
                if (entry.message.text.length > this.config.maxChars) {
                    this.fail(
                        key,
                        entry.message.text,
                        "Message exceeds batch character limit; translate a shorter selection",
                        entry.message.version,
                    );
                }
            }
            const candidates = eligible.filter(
                ([, entry]) => entry.message.text.length <= this.config.maxChars,
            );
            const missing = candidates.filter(
                ([, entry]) => !this.detectionCache.get(entry.message.text),
            );
            if (missing.length) {
                const inputs = missing.map(([, entry]) => entry.message.text);
                for (let offset = 0; offset < inputs.length; offset += 50) {
                    const chunk = inputs.slice(offset, offset + 50);
                    const result = await this.detector.detect(chunk);
                    if (result.length !== chunk.length)
                        throw new Error("Local detection returned incomplete results");
                    chunk.forEach((text, i) => this.detectionCache.set(text, result[i]!));
                }
            }
            const targets = candidates.flatMap(([, entry]) => {
                if (!this.eligible(entry)) return [];
                const detection = classify(
                    entry.message.text,
                    this.detectionCache.get(entry.message.text) ?? [],
                );
                const target = translationTarget(
                    resolveRule(this.config, entry.message),
                    detection,
                );
                return target ? [{ message: entry.message, target }] : [];
            });
            if (this.persistent) await this.hydrate(targets);
            if (this.stopped || !this.active || this.pause) return;
            for (const [key, snapshot] of candidates) {
                const entry = this.entries.get(key);
                if (
                    !entry ||
                    entry.message.text !== snapshot.message.text ||
                    entry.message.version !== snapshot.message.version ||
                    !this.eligible(entry)
                )
                    continue;
                if (entry.retryAt > this.clock()) continue;
                const detection = classify(
                    entry.message.text,
                    this.detectionCache.get(entry.message.text) ?? [],
                );
                entry.detection = detection;
                entry.state.detection = detection;
                const target = translationTarget(
                    resolveRule(this.config, entry.message),
                    detection,
                );
                const cached =
                    target && this.translations.get(this.cacheKey(entry.message, target));
                if (cached) {
                    entry.state = { status: "done", translation: cached, detection };
                    entry.considered = true;
                } else if (this.config.skipReplies.includes(entry.message.text.trim()) || !target) {
                    entry.considered = true;
                } else entry.state.status = "queued";
            }
            while (
                !this.stopped &&
                this.active &&
                !this.pause &&
                !this.manualWaiting &&
                this.running < this.config.concurrency
            ) {
                const prepared = this.prepare();
                if (!prepared) break;
                this.running++;
                for (const item of prepared.entries) {
                    const entry = this.entries.get(item.key)!;
                    entry.state.status = "loading";
                    entry.state.automatic = true;
                    entry.attempts++;
                }
                void this.dispatch(prepared).finally(() => this.releaseSlot());
            }
            this.emit();
        } catch {
            // Detector failures remain local and never silently enable a cloud fallback.
            this.pause = { kind: "local", until: null };
            for (const [key, entry] of this.entries) {
                if (!entry.considered && this.eligible(entry) && entry.state.status !== "loading") {
                    this.fail(
                        key,
                        entry.message.text,
                        "Local language detection failed",
                        entry.message.version,
                    );
                }
            }
            this.emit();
        } finally {
            this.checking = false;
        }
    }

    private prepare(): Prepared | null {
        const queued = [...this.entries.entries()]
            .filter(
                ([, e]) =>
                    e.state.status === "queued" && this.eligible(e) && e.retryAt <= this.clock(),
            )
            .sort((a, b) => a[1].message.timestamp - b[1].message.timestamp);
        const first = queued[0]?.[1];
        if (!first?.detection) return null;
        const target = translationTarget(resolveRule(this.config, first.message), first.detection)!;
        const selected: Array<[string, Entry]> = [];
        let chars = 0;
        for (const pair of queued) {
            const [key, entry] = pair;
            if (
                entry.message.channelId !== first.message.channelId ||
                !entry.detection ||
                translationTarget(resolveRule(this.config, entry.message), entry.detection) !==
                    target
            )
                continue;
            if (entry.message.text.length > this.config.maxChars) {
                this.fail(
                    key,
                    entry.message.text,
                    "Message exceeds batch character limit; translate a shorter selection",
                    entry.message.version,
                );
                continue;
            }
            if (
                selected.length >= this.config.maxItems ||
                chars + entry.message.text.length > this.config.maxChars
            )
                break;
            selected.push(pair);
            chars += entry.message.text.length;
        }
        if (!selected.length) return null;
        const selectedKeys = new Set(selected.map(([key]) => key));
        const nearby = [...this.entries.entries()]
            .filter(
                ([key, entry]) =>
                    !selectedKeys.has(key) &&
                    this.eligible(entry) &&
                    entry.message.channelId === first.message.channelId &&
                    (entry.state.status === "done" || entry.detection?.kind === "chinese"),
            )
            .sort(
                (a, b) =>
                    Math.abs(a[1].message.timestamp - first.message.timestamp) -
                    Math.abs(b[1].message.timestamp - first.message.timestamp),
            );
        const context: Array<[string, Entry]> = [];
        for (const pair of nearby) {
            if (
                context.length >= this.config.maxContext ||
                selected.length + context.length >= this.config.maxItems
            )
                break;
            if (chars + pair[1].message.text.length > this.config.maxChars) continue;
            context.push(pair);
            chars += pair[1].message.text.length;
        }
        const ordered = [...selected, ...context].sort(
            (a, b) => a[1].message.timestamp - b[1].message.timestamp,
        );
        const speakers = new Map<string, string>();
        const ids = new Map(ordered.map(([key], i) => [key, `m${i}`]));
        const restore = new Map<string, (text: string) => string>();
        const entries: Prepared["entries"] = [];
        const items = ordered.map(([key, entry]): TranslationItem => {
            const id = ids.get(key)!;
            const isTarget = selectedKeys.has(key);
            const protectedText = protectText(
                entry.message.text,
                this.config.preserveTerms,
                isTarget &&
                    entry.detection?.kind === "mixed" &&
                    target.toLowerCase().startsWith("zh"),
            );
            if (isTarget) {
                restore.set(id, protectedText.restore);
                entries.push({
                    key,
                    text: entry.message.text,
                    version: entry.message.version,
                    cacheKey: this.cacheKey(entry.message, target),
                });
            }
            if (!speakers.has(entry.message.speaker))
                speakers.set(entry.message.speaker, `a${speakers.size}`);
            const replyTo = entry.message.replyTo
                ? ids.get(`${entry.message.channelId}:${entry.message.replyTo}`)
                : undefined;
            return {
                id,
                text: protectedText.text,
                speaker: speakers.get(entry.message.speaker)!,
                mode: isTarget ? "translate" : "context",
                source:
                    entry.detection?.kind === "foreign"
                        ? (entry.detection.language ?? "auto")
                        : "auto",
                ...(replyTo ? { replyTo } : {}),
            };
        });
        return { request: { target, items, glossary: this.config.glossary }, restore, entries };
    }

    private async dispatch(prepared: Prepared): Promise<void> {
        const controller = new AbortController();
        this.controllers.add(controller);
        try {
            this.budget.reserve(JSON.stringify(prepared.request).length);
            const results = validateResults(
                await this.translator.translate(prepared.request, controller.signal),
                prepared.request,
            );
            if (this.stopped) return;
            const persisted: Array<{ key: string; original: string; text: string }> = [];
            let index = 0;
            for (const item of prepared.request.items) {
                if (item.mode !== "translate") continue;
                const entryRef = prepared.entries[index++]!;
                const result = results.find((r) => r.id === item.id);
                if (!result) {
                    this.fail(
                        entryRef.key,
                        entryRef.text,
                        "This item was missing from the batch response; retry manually",
                        entryRef.version,
                    );
                    continue;
                }
                try {
                    const text = prepared.restore.get(item.id)!(result.text);
                    this.translations.set(entryRef.cacheKey, text);
                    persisted.push({
                        key: entryRef.cacheKey,
                        original: entryRef.text,
                        text,
                    });
                    const entry = this.entries.get(entryRef.key);
                    if (
                        entry?.message.text === entryRef.text &&
                        entry.message.version === entryRef.version
                    ) {
                        entry.state = {
                            status: "done",
                            translation: text,
                            ...(entry.detection ? { detection: entry.detection } : {}),
                        };
                        entry.considered = true;
                    }
                } catch {
                    this.fail(
                        entryRef.key,
                        entryRef.text,
                        "Protected text changed; retry manually",
                        entryRef.version,
                    );
                }
            }
            await this.persist(persisted, prepared.request);
        } catch (error) {
            if (!this.stopped) {
                const reason = error instanceof Error ? error.message : "Translation failed";
                const retryable =
                    error instanceof ProviderError &&
                    (error.retryable || error.pause === "rateLimit");
                if (error instanceof ProviderError && error.pause === "credentials")
                    this.pause = { kind: "credentials", until: null };
                else if (error instanceof ProviderError && !retryable)
                    this.pause = { kind: "service", until: null };
                if (reason === "Daily character budget reached") {
                    const now = new Date();
                    const midnight = Date.UTC(
                        now.getUTCFullYear(),
                        now.getUTCMonth(),
                        now.getUTCDate() + 1,
                    );
                    this.pause = { kind: "budget", until: this.clock() + midnight - now.getTime() };
                }
                let nextRetry = 0;
                let exhausted = false;
                for (const item of prepared.entries) {
                    const entry = this.entries.get(item.key);
                    if (
                        !entry ||
                        entry.message.text !== item.text ||
                        entry.message.version !== item.version
                    )
                        continue;
                    if (retryable && entry.attempts <= this.config.autoRetryCount) {
                        const delay = Math.max(
                            entry.attempts === 1 ? 2000 : 5000,
                            error instanceof ProviderError ? error.retryAfterMs : 0,
                        );
                        entry.retryAt = this.clock() + delay;
                        nextRetry = Math.max(nextRetry, entry.retryAt);
                        entry.state = { status: "queued", error: reason, automatic: true };
                        entry.considered = false;
                    } else {
                        this.fail(item.key, item.text, reason, item.version);
                        if (retryable) exhausted = true;
                    }
                }
                if (exhausted) this.pause = { kind: "service", until: null };
                else if (nextRetry && this.pause?.until !== null)
                    this.pause = {
                        kind:
                            error instanceof ProviderError && error.pause === "rateLimit"
                                ? "rateLimit"
                                : "service",
                        until: nextRetry,
                    };
            }
        } finally {
            this.controllers.delete(controller);
            this.emit();
        }
    }

    private releaseSlot(): void {
        this.running--;
        for (const listener of this.slotListeners) listener();
    }
    private async acquireManualSlot(): Promise<void> {
        this.manualWaiting++;
        try {
            while (this.running >= this.config.concurrency && !this.stopped) {
                await new Promise<void>((resolve) => {
                    const listener = () => {
                        this.slotListeners.delete(listener);
                        resolve();
                    };
                    this.slotListeners.add(listener);
                });
            }
            if (this.stopped) throw new Error("Plugin stopped");
            this.running++;
        } finally {
            this.manualWaiting--;
        }
    }
    async translateText(text: string, target: string, persistKey?: string): Promise<string> {
        await this.acquireManualSlot();
        const controller = new AbortController();
        this.controllers.add(controller);
        try {
            if (!/^[a-zA-Z-]{2,20}$/.test(target)) throw new Error("Invalid target language");
            if (!text.trim() || text.length > this.config.maxChars)
                throw new Error("Draft is empty or too long");
            const protectedText = protectText(text, this.config.preserveTerms);
            const request: TranslationRequest = {
                target,
                glossary: this.config.glossary,
                items: [
                    {
                        id: "draft",
                        text: protectedText.text,
                        speaker: "a0",
                        mode: "translate",
                        source: "auto",
                    },
                ],
            };
            this.budget.reserve(JSON.stringify(request).length);
            const result = validateResults(
                await this.translator.translate(request, controller.signal),
                request,
            );
            if (this.stopped) throw new Error("Plugin stopped");
            if (!result[0]) throw new Error("Translation response was empty");
            const translation = protectedText.restore(result[0].text);
            if (persistKey)
                await this.persist(
                    [{ key: persistKey, original: text, text: translation }],
                    request,
                );
            return translation;
        } finally {
            this.controllers.delete(controller);
            this.releaseSlot();
        }
    }
    async manual(message: MessageInput, target: string, force = false): Promise<void> {
        this.upsert(message);
        const key = messageKey(message);
        const cacheKey = this.cacheKey(message, target);
        if (!force && this.persistent) {
            this.manualWaiting++;
            try {
                await this.hydrate([{ message, target }]);
            } finally {
                this.manualWaiting--;
            }
        }
        const current = this.entries.get(key);
        if (
            this.stopped ||
            current?.message.text !== message.text ||
            current.message.version !== message.version
        )
            return;
        const cached = !force && this.translations.get(cacheKey);
        if (cached) {
            this.entries.get(key)!.state = { status: "done", translation: cached };
            this.emit();
            return;
        }
        if (this.entries.get(key)?.state.status === "loading") return;
        this.entries.get(key)!.state = { status: "loading" };
        this.emit();
        try {
            const translation = await this.translateText(message.text, target, cacheKey);
            this.translations.set(cacheKey, translation);
            const entry = this.entries.get(key);
            if (
                entry?.message.text === message.text &&
                entry.message.version === message.version &&
                !this.stopped
            ) {
                entry.state = { status: "done", translation };
                entry.considered = true;
            }
        } catch (error) {
            this.fail(
                key,
                message.text,
                error instanceof Error ? error.message : "Translation failed",
                message.version,
                false,
            );
        } finally {
            this.emit();
        }
    }
    clearCache(): void {
        this.cacheEpoch++;
        this.translations.clear();
        this.detectionCache.clear();
        for (const entry of this.entries.values()) {
            entry.considered = entry.state.status === "loading";
            if (entry.state.status !== "loading") {
                entry.state = { status: "idle" };
                entry.attempts = 0;
                entry.retryAt = 0;
            }
        }
        this.emit();
    }
    failureSummary(channelId: string) {
        const visible = [...this.entries.values()].filter(
            (entry) =>
                entry.message.channelId === channelId &&
                entry.visibleSince !== null &&
                entry.state.automatic,
        );
        return {
            failed: visible.filter((entry) => entry.state.status === "error").length,
            retrying: visible.filter(
                (entry) => entry.state.error && ["queued", "loading"].includes(entry.state.status),
            ).length,
            pause: this.pause
                ? {
                      kind: this.pause.kind,
                      remainingMs:
                          this.pause.until === null
                              ? null
                              : Math.max(0, this.pause.until - this.clock()),
                  }
                : null,
        };
    }
    retryVisible(channelId: string): void {
        if (this.stopped || this.pause?.kind === "budget") return;
        if (
            this.pause?.kind === "rateLimit" &&
            this.pause.until !== null &&
            this.clock() < this.pause.until
        )
            return;
        this.pause = null;
        for (const entry of this.entries.values()) {
            if (
                entry.message.channelId !== channelId ||
                entry.visibleSince === null ||
                !entry.state.automatic ||
                !["error", "queued"].includes(entry.state.status)
            )
                continue;
            entry.considered = false;
            entry.attempts = 0;
            entry.retryAt = 0;
            entry.state = { status: "queued", automatic: true };
        }
        this.emit();
        void this.tick();
    }
    async stop(preserveTranslations = false): Promise<void> {
        this.stopped = true;
        for (const controller of this.controllers) controller.abort();
        for (const listener of this.slotListeners) listener();
        this.listeners.clear();
        this.entries.clear();
        if (!preserveTranslations) this.translations.clear();
        this.detectionCache.clear();
        await this.detector.close();
    }
}
