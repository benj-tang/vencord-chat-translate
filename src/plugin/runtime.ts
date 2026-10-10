// SPDX-License-Identifier: GPL-3.0-or-later
import type { PluginNative } from "@utils/types";
import { ChannelStore, SelectedChannelStore, showToast } from "@webpack/common";
import type { Message } from "@vencord/discord-types";
import { TranslationEngine } from "../core/scheduler";
import { cleanForDetection } from "../core/language";
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
const notify = () => {
    for (const listener of listeners) listener();
};
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
export function viewState(key: string): ViewState {
    return engine?.state(key) ?? { status: "idle" };
}
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
        showToast(error instanceof Error ? error.message : "翻译失败", "failure");
    }
}

export function startRuntime(): void {
    desired = true;
    onSettingsChange(reloadRuntime);
    try {
        const config = appConfig();
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
                        if (!response.ok) throw new Error(response.error);
                        return response.results;
                    } finally {
                        signal?.removeEventListener("abort", cancel);
                    }
                },
            },
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
        showToast("ChatTranslate 设置有误，请检查语言规则和批次限制。", "failure");
    }
}
async function cleanupRuntime(): Promise<void> {
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
    const old = engine;
    engine = null;
    await old?.stop();
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
            await cleanupRuntime();
            if (desired) startRuntime();
        })
        .catch(() => showToast("翻译设置更新失败，请重新启用插件。", "failure"));
}
