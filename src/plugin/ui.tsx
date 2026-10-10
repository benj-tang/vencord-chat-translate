// SPDX-License-Identifier: GPL-3.0-or-later
import { ChatBarButton, type ChatBarButtonFactory } from "@api/ChatButtons";
import { copyToClipboard } from "@utils/clipboard";
import type { IconComponent } from "@utils/types";
import type { Message, RenderModalProps } from "@vencord/discord-types";
import {
    DraftStore,
    Modal,
    React,
    SelectedChannelStore,
    openModal,
    showToast,
    useEffect,
    useRef,
    useState,
} from "@webpack/common";
import { resolveRule } from "../core/config";
import { DraftSession, type DraftSnapshot } from "../core/draft";
import { messageKey } from "../core/types";
import { settings, appConfig } from "./settings";
import {
    attach,
    currentEngine,
    detach,
    hide,
    input,
    manual,
    observe,
    revision,
    subscribe,
    viewState,
} from "./runtime";

export const TranslateIcon: IconComponent = ({ width = 20, height = 20, className }) => (
    <svg width={width} height={height} viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            d="M3 5h11M8 3v2m-3 3c1 4 4 7 8 9M12 5c-1 6-4 10-9 12m11 3 4-10 4 10m-6.8-3h5.6"
        />
    </svg>
);

export function MessageTranslation({ message }: { message: Message }) {
    const node = useRef<HTMLDivElement>(null);
    const [, refresh] = useState(0);
    const key = `${message.channel_id}:${message.id}`;
    const currentRevision = revision();
    useEffect(() => subscribe(() => refresh((n) => n + 1)), []);
    useEffect(() => {
        if ((message as any).vencordEmbeddedBy || !message.content || !node.current) return;
        attach(input(message));
        const unobserve = observe(key, node.current);
        return () => {
            unobserve();
            detach(key);
        };
    }, [key, message.content, message.editedTimestamp?.valueOf(), currentRevision]);
    const state = viewState(key);
    return (
        <div ref={node} className={`ct-accessory ${state.status === "idle" ? "ct-idle" : ""}`}>
            {state.status === "loading" && <span role="status">正在翻译…</span>}
            {state.status === "queued" && <span role="status">等待翻译</span>}
            {state.status === "error" && (
                <span role="alert">
                    {state.error}
                    <button
                        onClick={() =>
                            void manual(
                                input(message),
                                resolveRule(appConfig(), input(message)).target,
                                true,
                            )
                        }
                    >
                        重试
                    </button>
                </span>
            )}
            {state.translation && (
                <>
                    <div className="ct-text" dir="auto">
                        {state.translation}
                    </div>
                    <div className="ct-actions">
                        <span>译文</span>
                        <button onClick={() => void copyToClipboard(state.translation!)}>
                            复制
                        </button>
                        <button onClick={() => hide(key)}>隐藏</button>
                        <button
                            onClick={() =>
                                void manual(
                                    input(message),
                                    resolveRule(appConfig(), input(message)).target,
                                    true,
                                )
                            }
                        >
                            重新翻译
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

function readDraft(channelId: string, draftType: number): DraftSnapshot {
    return {
        channelId: SelectedChannelStore.getChannelId(),
        text: DraftStore.getDraft(channelId, draftType) ?? "",
    };
}

async function replacePlainDraft(
    channelId: string,
    draftType: number,
    expected: string,
    text: string,
): Promise<void> {
    const current = readDraft(channelId, draftType);
    if (current.channelId !== channelId || current.text !== expected)
        throw new Error("频道或草稿已变化，请重新翻译。");
    const editors = [
        ...document.querySelectorAll<HTMLElement>(
            '[role="textbox"][contenteditable="true"][data-slate-editor="true"]',
        ),
    ].filter(
        (editor) =>
            editor.getBoundingClientRect().width > 0 && editor.getBoundingClientRect().height > 0,
    );
    if (editors.length !== 1 || /<[@#]|<a?:\w+:\d+>/u.test(expected)) {
        throw new Error("此输入框暂不支持直接替换，请复制译文；原草稿保持不变。");
    }
    const editor = editors[0]!;
    // Restrict the selection to this editor; never synthesize Enter or a send action.
    editor.focus();
    const selection = window.getSelection();
    if (!selection) throw new Error("无法选择当前草稿，请复制译文。");
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("insertText", false, text))
        throw new Error("草稿替换未成功，请复制译文。");
    await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (readDraft(channelId, draftType).text !== text) {
        throw new Error("尚未确认输入框保存了完整译文，请检查草稿后继续。");
    }
}

function DraftModal({
    props,
    channelId,
    draftType,
}: {
    props: RenderModalProps;
    channelId: string;
    draftType: number;
}) {
    const [text, setText] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [session, setSession] = useState<DraftSession | null>(null);
    const [applied, setApplied] = useState(false);
    const channelRule = resolveRule(appConfig(), scopeMessage(channelId));
    const [target, setTarget] = useState(
        settings.store.outputTarget || (channelRule.preset === "chinese" ? "zh-CN" : "en"),
    );
    const mounted = useRef(true);
    useEffect(
        () => () => {
            mounted.current = false;
        },
        [],
    );
    const translate = async () => {
        setError("");
        setLoading(true);
        setText("");
        setApplied(false);
        const draft = readDraft(channelId, draftType);
        setSession(new DraftSession(draft));
        try {
            const translated = await currentEngine().translateText(draft.text, target);
            if (mounted.current) setText(translated);
        } catch (e) {
            if (mounted.current) setError(e instanceof Error ? e.message : "翻译失败");
        } finally {
            if (mounted.current) setLoading(false);
        }
    };
    const apply = async () => {
        if (!session) return;
        try {
            session.apply(readDraft(channelId, draftType), text);
            await replacePlainDraft(channelId, draftType, session.original.text, text);
            session.confirmApplied(text);
            setApplied(true);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "应用失败");
        }
    };
    const restore = async () => {
        if (!session) return;
        try {
            const original = session.restore(readDraft(channelId, draftType));
            await replacePlainDraft(channelId, draftType, text, original);
            session.confirmRestored();
            setApplied(false);
            setError("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "恢复失败");
        }
    };
    return (
        <Modal
            {...props}
            title="草稿按需翻译"
            subtitle="预览后应用，再由你发送。"
            size="md"
            actions={[
                {
                    text: "翻译当前草稿",
                    variant: "primary",
                    onClick: () => void translate(),
                    loading,
                    disabled: applied,
                },
                {
                    text: "应用译文",
                    variant: "secondary",
                    onClick: () => void apply(),
                    disabled: !text || loading || applied,
                },
                {
                    text: "恢复原文",
                    variant: "secondary",
                    onClick: () => void restore(),
                    disabled: !applied,
                },
            ]}
        >
            <div className="ct-panel">
                <label>
                    目标语言
                    <input
                        className="ct-input"
                        value={target}
                        disabled={loading || applied}
                        onChange={(e) => {
                            setTarget(e.target.value);
                            setText("");
                            setSession(null);
                        }}
                    />
                </label>
                {session && (
                    <>
                        <label>原草稿</label>
                        <pre className="ct-preview">{session.original.text}</pre>
                    </>
                )}
                {text && (
                    <>
                        <label>译文</label>
                        <pre className="ct-preview">{text}</pre>
                        <button onClick={() => void copyToClipboard(text)}>复制译文</button>
                    </>
                )}
                {error && <p role="alert">{error}</p>}
            </div>
        </Modal>
    );
}

export const DraftButton: ChatBarButtonFactory = ({ isMainChat, channel, type }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton
            tooltip="翻译当前草稿"
            onClick={() =>
                openModal((props) => (
                    <DraftModal props={props} channelId={channel.id} draftType={type.drafts.type} />
                ))
            }
        >
            <TranslateIcon />
        </ChatBarButton>
    );
};

export function openManualModal(message: Message): void {
    openModal((props) => <ManualModal props={props} message={message} />);
}
function ManualModal({ props, message }: { props: RenderModalProps; message: Message }) {
    const [target, setTarget] = useState("zh-CN");
    return (
        <Modal
            {...props}
            title="选择翻译语言"
            size="sm"
            actions={[
                {
                    text: "翻译",
                    variant: "primary",
                    onClick: () => {
                        void manual(input(message), target);
                        props.onClose();
                    },
                },
            ]}
        >
            <div className="ct-panel">
                <label>
                    目标语言
                    <input
                        className="ct-input"
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                    />
                </label>
            </div>
        </Modal>
    );
}

export function clearCache(): void {
    currentEngine().clearCache();
    showToast("翻译缓存已清空", "success");
}

export function scopeMessage(channelId: string): ReturnType<typeof input> {
    return input({ id: "0", channel_id: channelId, content: "" } as Message);
}

export function hideMessage(message: Message): void {
    hide(messageKey(input(message)));
}
