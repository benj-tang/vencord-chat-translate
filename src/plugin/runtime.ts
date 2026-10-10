// SPDX-License-Identifier: GPL-3.0-or-later
import type { PluginNative } from "@utils/types";
import { ChannelStore, SelectedChannelStore, Toasts } from "@webpack/common";
import type { Message } from "@vencord/discord-types";
import { TranslationEngine } from "../core/scheduler";
import { cleanForDetection } from "../core/language";
import { ProviderError } from "../core/provider";
import { DailyBudget, Lru } from "../core/cache";
import type { MessageInput, ViewState } from "../core/types";
import { appConfig, onSettingsChange, providerConfig } from "./settings";

const Native = VencordNative.pluginHelpers.ChatTranslate as PluginNative<typeof import("./native")>;
let engine: TranslationEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let sequence = 0;
let runtimeRevision = 0;
let desired = false;
let restartChain = Promise.resolve();
const watched = new Map<string, Set<Element>>();
const viewportObservers = new Map<Element, IntersectionObserver>();
const elements = new Map<Element, { key: string; root: Element; visible: boolean }>();
const nodeRefs = new Map<Element, number>();
const listeners = new Set<() => void>();
let lastStatusKey: string | null = null;
const sessionTranslations = new Lru<string>(1000);
const sessionBudget = new DailyBudget(100000);
let cachedProvider = "";
const notify = () => {
    for (const listener of listeners) listener();
};
export function notifyUser(message: string, type: "success" | "failure"): void {
    Toasts.show({
        text: message,
        variant: type === "failure" ? "critical" : "success",
        duration: 6000,
    });
}
export function revision(): number {
    return runtimeRevision;
}

export function subscribe(callback: () => void): () => void {
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}
export function currentEngine(): TranslationEngine {
    if (!engine) throw new Error("ChatTranslate is not running or its settings are invalid");
    return engine;
}
export async function diagnostics() {
    const native = await Native.getDiagnostics();
    return {
        ...native,
        active: activity(),
        observed: watched.size,
        visible: [...watched.values()].filter((nodes) =>
            [...nodes].some((node) => elements.get(node)?.visible),
        ).length,
    };
}
export function viewState(key: string): ViewState {
    return engine?.state(key) ?? { status: "idle" };
}
export function failureSummary(channelId: string) {
    return engine?.failureSummary(channelId) ?? { failed: 0, retrying: 0, pause: null };
}
export function retryVisible(channelId: string): void {
    engine?.retryVisible(channelId);
}
export function statusKey(channelId: string): string | null {
    if (channelId !== SelectedChannelStore.getChannelId()) return null;
    return (
        [...watched.entries()]
            .filter(
                ([key, nodes]) =>
                    key.startsWith(`${channelId}:`) &&
                    [...nodes].some((node) => elements.get(node)?.visible),
            )
            .map(([key]) => key)
            .sort()[0] ?? null
    );
}
export function statusHost(channelId: string): Element | null {
    const key = statusKey(channelId);
    const node =
        key && [...(watched.get(key) ?? [])].find((candidate) => elements.get(candidate)?.visible);
    return node ? (elements.get(node)?.root.parentElement ?? null) : null;
}
export function runtimeReady(): boolean {
    return !!engine;
}
export const runtimeActive = () => activity();
export function input(message: Message): MessageInput {
    const channel = ChannelStore.getChannel(message.channel_id);
    const guildId = channel?.guild_id;
    const parentId = channel?.isThread?.() ? channel.parent_id : undefined;
    const replyTo = message.messageReference?.message_id;
    const version = message.editedTimestamp?.valueOf().toString();
    return {
        id: message.id,
        channelId: message.channel_id,
        text: message.content ?? "",
        speaker: message.author?.id ?? "unknown",
        timestamp: Number(BigInt(message.id) >> 22n),
        ...(guildId ? { guildId } : {}),
        ...(parentId ? { parentId } : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(version ? { version } : {}),
    };
}
export function attach(message: MessageInput): void {
    engine?.upsert(message);
}
export function detach(key: string): void {
    if (!watched.has(key)) engine?.remove(key);
}
export function hide(key: string): void {
    engine?.hide(key);
}
export function forget(key: string): void {
    engine?.remove(key);
}

function activity(): boolean {
    return document.visibilityState === "visible" && document.hasFocus();
}
function synchronize(): void {
    engine?.setActive(activity());
    for (const [key, nodes] of watched) {
        const sameChannel = key.startsWith(`${SelectedChannelStore.getChannelId()}:`);
        engine?.setVisible(
            key,
            activity() && sameChannel && [...nodes].some((node) => elements.get(node)?.visible),
        );
    }
    const key = statusKey(SelectedChannelStore.getChannelId());
    if (key !== lastStatusKey) {
        lastStatusKey = key;
        notify();
    }
}
function scrollRoot(node: Element): Element | null {
    let parent = node.parentElement;
    while (parent && parent !== document.body) {
        const { overflowY } = getComputedStyle(parent);
        if (/(auto|scroll)/u.test(overflowY) && parent.scrollHeight > parent.clientHeight)
            return parent;
        parent = parent.parentElement;
    }
    return null;
}
export function observe(key: string, node: Element): () => void {
    const messageNode = node.closest('[id^="chat-messages-"],[data-list-item-id^="chat-messages"]');
    const root = messageNode && scrollRoot(messageNode);
    if (!messageNode || !root) return () => {};
    let observer = viewportObservers.get(root);
    if (!observer) {
        observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const info = elements.get(entry.target);
                    if (!info) continue;
                    info.visible = entry.isIntersecting && entry.intersectionRect.height > 0;
                }
                synchronize();
            },
            { root, threshold: 0 },
        );
        viewportObservers.set(root, observer);
    }
    // Observe the whole message: a long message can be readable while its accessory is below the fold.
    const count = nodeRefs.get(messageNode) ?? 0;
    nodeRefs.set(messageNode, count + 1);
    if (!count) elements.set(messageNode, { key, root, visible: false });
    const nodes = watched.get(key) ?? new Set<Element>();
    nodes.add(messageNode);
    watched.set(key, nodes);
    observer.observe(messageNode);
    return () => {
        const remaining = (nodeRefs.get(messageNode) ?? 1) - 1;
        if (remaining > 0) {
            nodeRefs.set(messageNode, remaining);
            return;
        }
        nodeRefs.delete(messageNode);
        nodes.delete(messageNode);
        if (!nodes.size) watched.delete(key);
        observer!.unobserve(messageNode);
        elements.delete(messageNode);
        if (![...elements.values()].some((info) => info.root === root)) {
            observer!.disconnect();
            viewportObservers.delete(root);
        }
        synchronize();
    };
}

export async function manual(
    message: MessageInput,
    target = "zh-CN",
    force = false,
): Promise<void> {
    try {
        await currentEngine().manual(message, target, force);
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : "翻译失败", "failure");
    }
}

export function startRuntime(): void {
    desired = true;
    onSettingsChange(reloadRuntime);
    try {
        const config = appConfig();
        sessionBudget.setLimit(config.maxDailyChars);
        const provider = JSON.stringify(providerConfig());
        if (provider !== cachedProvider) {
            sessionTranslations.clear();
            cachedProvider = provider;
        }
        engine = new TranslationEngine(
            config,
            {
                detect: (texts) => Native.detectLanguages(texts.map(cleanForDetection)),
                close: () => Native.stopNative(),
            },
            {
                async translate(request, signal) {
                    const id = `ct-${++sequence}`;
                    const cancel = () => {
                        void Native.cancelRequest(id);
                    };
                    signal?.addEventListener("abort", cancel, { once: true });
                    try {
                        if (signal?.aborted) throw new Error("Translation cancelled");
                        const response = await Native.translateBatch(id, providerConfig(), request);
                        if (!response.ok)
                            throw new ProviderError(
                                response.error,
                                response.retryable,
                                response.retryAfterMs,
                                response.pause,
                            );
                        return response.results;
                    } finally {
                        signal?.removeEventListener("abort", cancel);
                    }
                },
            },
            () => performance.now(),
            sessionTranslations,
            sessionBudget,
        );
        engine.subscribe(notify);
        runtimeRevision++;
        timer = setInterval(() => {
            synchronize();
            void engine?.tick();
        }, 100);
        document.addEventListener("visibilitychange", synchronize);
        window.addEventListener("focus", synchronize);
        window.addEventListener("blur", synchronize);
        synchronize();
        notify();
    } catch {
        notifyUser("ChatTranslate 设置有误，请检查语言规则和批次限制。", "failure");
    }
}
async function cleanupRuntime(preserveTranslations = false): Promise<void> {
    onSettingsChange();
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", synchronize);
    window.removeEventListener("focus", synchronize);
    window.removeEventListener("blur", synchronize);
    for (const observer of viewportObservers.values()) observer.disconnect();
    viewportObservers.clear();
    watched.clear();
    elements.clear();
    nodeRefs.clear();
    lastStatusKey = null;
    const old = engine;
    engine = null;
    await old?.stop(preserveTranslations);
    runtimeRevision++;
    notify();
}
export async function stopRuntime(): Promise<void> {
    desired = false;
    await cleanupRuntime();
}
export function reloadRuntime(): void {
    restartChain = restartChain
        .then(async () => {
            if (!desired) return;
            await cleanupRuntime(true);
            if (desired) startRuntime();
        })
        .catch(() => notifyUser("翻译设置更新失败，请重新启用插件。", "failure"));
}
