// SPDX-License-Identifier: GPL-3.0-or-later
import { ChatBarButton, type ChatBarButtonFactory } from "@api/ChatButtons";
import { insertTextIntoChatInputBox } from "@utils/discord";
import type { IconComponent } from "@utils/types";
import type { Message, RenderModalProps } from "@vencord/discord-types";
import {
    DraftStore,
    ComponentDispatch,
    ChannelStore,
    GuildMemberStore,
    GuildRoleStore,
    Modal,
    React,
    ReactDOM,
    SelectedChannelStore,
    UserStore,
    openModal,
    useEffect,
    useRef,
    useState,
    useStateFromStores,
} from "@webpack/common";
import { resolveRule } from "../core/config";
import {
    DraftSession,
    TripleSpaceShortcut,
    waitForDraftConfirmation,
    type DraftSnapshot,
} from "../core/draft";
import { messageKey } from "../core/types";
import { readableMentions } from "../core/mentions";
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
    diagnostics,
    notifyUser,
    failureSummary,
    retryVisible,
    statusKey,
    statusHost,
    runtimeReady,
    runtimeActive,
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

const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="2" />
    </svg>
);
const RetryIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
            d="M20 7v5h-5M20 12a8 8 0 1 0-2 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
        />
    </svg>
);
const RestoreIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
            d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
        />
    </svg>
);
const Spinner = () => <span className="ct-spinner" aria-hidden="true" />;
const targetNames: Record<string, string> = { "zh-CN": "中文", en: "英语", ja: "日语" };

function TranslationText({ message, text }: { message: Message; text: string }) {
    const readable = useStateFromStores(
        [ChannelStore, UserStore, GuildMemberStore, GuildRoleStore],
        () => {
            const guildId = ChannelStore.getChannel(message.channel_id)?.guild_id;
            return readableMentions(text, message.content, {
                user: (id) => {
                    const user = UserStore.getUser(id);
                    return (
                        (guildId ? GuildMemberStore.getMember(guildId, id)?.nick : undefined) ||
                        user?.globalName ||
                        user?.username
                    );
                },
                role: (id) => (guildId ? GuildRoleStore.getRole(guildId, id)?.name : undefined),
                channel: (id) => ChannelStore.getChannel(id)?.name,
            });
        },
        [text, message.content, message.channel_id],
    );
    return <>{readable}</>;
}

export function MessageTranslation({ message }: { message: Message }) {
    const display = settings.use(["translationStyle", "translationFontSize", "translationItalic"]);
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
    const quietFailure = !!state.error && state.automatic;
    return (
        <div
            ref={node}
            className={`ct-accessory ct-style-${display.translationStyle} ${state.status === "idle" || quietFailure ? "ct-idle" : ""}`}
            style={{
                fontSize: `${Math.min(150, Math.max(70, display.translationFontSize || 100))}%`,
                fontStyle: display.translationItalic ? "italic" : "normal",
            }}
        >
            {key === statusKey(message.channel_id) && (
                <ChannelStatusPortal channelId={message.channel_id} />
            )}
            {state.status === "loading" && !quietFailure && (
                <span role="status" className="ct-loading">
                    <Spinner />
                    正在翻译…
                </span>
            )}
            {state.status === "queued" && !quietFailure && <span role="status">等待翻译</span>}
            {state.status === "error" && !quietFailure && (
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
                        <TranslationText message={message} text={state.translation} />
                    </div>
                    <div className="ct-actions">
                        <button
                            aria-label="重新翻译"
                            title="重新翻译"
                            onClick={() =>
                                void manual(
                                    input(message),
                                    resolveRule(appConfig(), input(message)).target,
                                    true,
                                )
                            }
                        >
                            <RetryIcon />
                        </button>
                        <button aria-label="关闭译文" title="关闭译文" onClick={() => hide(key)}>
                            <CloseIcon />
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

function ChannelStatusPortal({ channelId }: { channelId: string }) {
    settings.use();
    const host = statusHost(channelId);
    const [, refresh] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => refresh((value) => value + 1), 1000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        if (!host) return;
        host.classList.add("ct-channel-host");
        return () => host.classList.remove("ct-channel-host");
    }, [host]);
    if (!host) return null;
    let rule;
    try {
        rule = resolveRule(appConfig(), scopeMessage(channelId));
    } catch {
        return ReactDOM.createPortal(
            <div className="ct-channel-status" role="status">
                <button onClick={openDiagnostics}>翻译设置有误 · 查看状态</button>
            </div>,
            host,
        );
    }
    const health = failureSummary(channelId);
    const preset = { bilingual: "中英阅读", english: "英文频道", chinese: "中文频道" }[rule.preset];
    const pause = health.pause;
    const state = !runtimeReady()
        ? "启动中"
        : !rule.enabled
          ? "自动关闭"
          : pause?.kind === "budget"
            ? "达到字符预算"
            : pause
              ? pause.remainingMs === null
                  ? {
                        credentials: "连接需检查",
                        rateLimit: "请求受限",
                        service: "重试已停止",
                        budget: "达到字符预算",
                        local: "本地识别需检查",
                    }[pause.kind]
                  : `等待重试 ${Math.ceil(pause.remainingMs / 1000)} 秒`
              : !runtimeActive()
                ? "后台暂停"
                : "自动开启";
    return ReactDOM.createPortal(
        <div className="ct-channel-status" role="status" aria-label="频道翻译状态">
            <button title="查看翻译状态" onClick={openDiagnostics}>
                <TranslateIcon width={14} height={14} />
                {state} · {preset}（
                {
                    { nonChinese: "非中文", selected: "指定语言", mappings: "对应表", all: "全部" }[
                        rule.mode
                    ]
                }
                ） → {targetNames[rule.target] ?? rule.target}
            </button>
            {(health.failed > 0 || health.retrying > 0 || pause) && (
                <>
                    <span>
                        {health.failed ? `${health.failed} 条未译` : ""}
                        {health.retrying ? ` ${health.retrying} 条待重试` : ""}
                    </span>
                    {pause?.kind !== "budget" && (
                        <button
                            disabled={
                                pause?.kind === "rateLimit" &&
                                pause.remainingMs !== null &&
                                pause.remainingMs > 0
                            }
                            onClick={() => retryVisible(channelId)}
                        >
                            重试当前视窗
                        </button>
                    )}
                </>
            )}
        </div>,
        host,
    );
}

function readDraft(channelId: string, draftType: number): DraftSnapshot {
    return {
        channelId: SelectedChannelStore.getChannelId(),
        text: DraftStore.getDraft(channelId, draftType) ?? "",
    };
}

const editorSelector = '[role="textbox"][contenteditable="true"][data-slate-editor="true"]';
function plainEditor(): HTMLElement | null {
    const editors = [...document.querySelectorAll<HTMLElement>(editorSelector)].filter(
        (editor) =>
            editor.getBoundingClientRect().width > 0 && editor.getBoundingClientRect().height > 0,
    );
    return editors.length === 1 ? editors[0]! : null;
}
function editorText(editor: HTMLElement): string {
    return editor.querySelector("[data-slate-string]")
        ? editor.innerText.replace(/[\u200b\ufeff]/gu, "")
        : "";
}
const paint = () =>
    new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

async function replacePlainDraft(
    channelId: string,
    draftType: number,
    expected: string,
    text: string,
): Promise<void> {
    const current = readDraft(channelId, draftType);
    if (current.channelId !== channelId || current.text !== expected)
        throw new Error("频道或草稿已变化，请重新翻译。");
    const editor = plainEditor();
    if (!editor || /<[@#]|<a?:\w+:\d+>/u.test(expected)) {
        throw new Error("此输入框暂不支持直接替换；原草稿保持不变。");
    }
    const read = () => ({
        ...readDraft(channelId, draftType),
        editorText: editorText(editor),
    });
    if (read().editorText !== expected)
        throw new Error("输入框与草稿记录不一致；不会覆盖现有内容。");
    // Use Discord's editor events so Slate state and DraftStore both change.
    ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");
    try {
        await paint();
        await waitForDraftConfirmation(current, "", read);
        insertTextIntoChatInputBox(text);
        await paint();
        await waitForDraftConfirmation({ ...current, text: "" }, text, read);
    } catch (error) {
        const latest = read();
        if (latest.channelId === channelId && latest.text === "" && latest.editorText === "") {
            insertTextIntoChatInputBox(expected);
            await paint();
            await waitForDraftConfirmation({ ...current, text: "" }, expected, read);
        }
        throw error;
    }
}

function DraftControls({ channelId, draftType }: { channelId: string; draftType: number }) {
    const options = settings.use(["outputTarget", "tripleSpaceEnabled", "tripleSpaceIntervalMs"]);
    const [loading, setLoading] = useState(false);
    const [last, setLast] = useState<{ session: DraftSession; translated: string } | null>(null);
    const [host, setHost] = useState<HTMLElement | null>(null);
    const busy = useRef(false);
    const mounted = useRef(true);
    const current = useStateFromStores([DraftStore, SelectedChannelStore], () =>
        readDraft(channelId, draftType),
    );
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        setLast(null);
    }, [channelId, draftType]);
    useEffect(() => {
        if (!loading) return;
        const editor = plainEditor();
        const parent = editor?.parentElement;
        if (!parent) return;
        parent.classList.add("ct-draft-host");
        editor.classList.add("ct-draft-busy");
        setHost(parent);
        return () => {
            parent.classList.remove("ct-draft-host");
            editor.classList.remove("ct-draft-busy");
            setHost(null);
        };
    }, [loading]);
    const run = async (shortcut = false) => {
        if (busy.current) return;
        const editor = plainEditor();
        if (!editor || SelectedChannelStore.getChannelId() !== channelId) return;
        const expected = editorText(editor);
        const source = shortcut ? expected.replace(/ {2}$/, "") : expected;
        if (!source.trim()) return;
        if (/<[@#]|<a?:\w+:\d+>/u.test(expected)) {
            notifyUser("此草稿包含复杂提及，暂不支持直接替换。", "failure");
            return;
        }
        busy.current = true;
        setLoading(true);
        try {
            const initial = readDraft(channelId, draftType);
            await waitForDraftConfirmation(initial, expected, () => ({
                ...readDraft(channelId, draftType),
                editorText: editorText(editor),
            }));
            const original = readDraft(channelId, draftType);
            const session = new DraftSession(original);
            const rule = resolveRule(appConfig(), scopeMessage(channelId));
            const target =
                options.outputTarget.trim() || (rule.preset === "chinese" ? "zh-CN" : "en");
            const translated = await currentEngine().translateText(source, target);
            if (!mounted.current) return;
            session.apply(readDraft(channelId, draftType), translated);
            await replacePlainDraft(channelId, draftType, original.text, translated);
            session.confirmApplied(translated);
            if (mounted.current) setLast({ session, translated });
        } catch (e) {
            if (mounted.current)
                notifyUser(e instanceof Error ? e.message : "草稿翻译失败", "failure");
        } finally {
            busy.current = false;
            if (mounted.current) setLoading(false);
        }
    };
    const restore = async () => {
        if (!last || busy.current) return;
        busy.current = true;
        setLoading(true);
        try {
            const original = last.session.restore(readDraft(channelId, draftType));
            await replacePlainDraft(channelId, draftType, last.translated, original);
            last.session.confirmRestored();
            if (mounted.current) setLast(null);
        } catch (e) {
            if (mounted.current) notifyUser(e instanceof Error ? e.message : "恢复失败", "failure");
        } finally {
            busy.current = false;
            if (mounted.current) setLoading(false);
        }
    };
    useEffect(() => {
        if (!options.tripleSpaceEnabled) return;
        const shortcut = new TripleSpaceShortcut();
        const reset = () => shortcut.reset();
        const onKey = (event: KeyboardEvent) => {
            const editor = plainEditor();
            if (
                busy.current ||
                !editor ||
                !(event.target instanceof Node) ||
                !editor.contains(event.target) ||
                SelectedChannelStore.getChannelId() !== channelId
            ) {
                reset();
                return;
            }
            const interval = Math.min(2000, Math.max(100, options.tripleSpaceIntervalMs || 500));
            if (
                !shortcut.press(
                    {
                        key: event.key,
                        repeat: event.repeat,
                        isComposing: event.isComposing,
                        modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
                    },
                    performance.now(),
                    interval,
                )
            )
                return;
            event.preventDefault();
            event.stopPropagation();
            void run(true);
        };
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", reset, true);
        document.addEventListener("compositionstart", reset, true);
        window.addEventListener("blur", reset);
        return () => {
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("pointerdown", reset, true);
            document.removeEventListener("compositionstart", reset, true);
            window.removeEventListener("blur", reset);
        };
    }, [
        options.tripleSpaceEnabled,
        options.tripleSpaceIntervalMs,
        options.outputTarget,
        channelId,
        draftType,
    ]);
    const canRestore =
        last &&
        current.channelId === last.session.original.channelId &&
        current.text === last.translated;
    return (
        <>
            <ChatBarButton
                tooltip={loading ? "正在翻译草稿…" : "翻译并替换草稿"}
                onClick={() => void run()}
                buttonProps={{ "aria-disabled": loading, "aria-busy": loading }}
            >
                {loading ? <Spinner /> : <TranslateIcon />}
            </ChatBarButton>
            {canRestore && (
                <ChatBarButton
                    tooltip="恢复翻译前草稿"
                    onClick={() => void restore()}
                    buttonProps={{ "aria-disabled": loading }}
                >
                    <RestoreIcon />
                </ChatBarButton>
            )}
            {loading &&
                host &&
                ReactDOM.createPortal(
                    <div className="ct-draft-wait" role="status">
                        <Spinner />
                        <span>正在翻译…</span>
                    </div>,
                    host,
                )}
        </>
    );
}

export const DraftButton: ChatBarButtonFactory = ({ isMainChat, channel, type }) =>
    isMainChat ? (
        <DraftControls
            key={`${channel.id}:${type.drafts.type}`}
            channelId={channel.id}
            draftType={type.drafts.type}
        />
    ) : null;

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
    notifyUser("翻译缓存已清空", "success");
}

export function openDiagnostics(): void {
    openModal((props) => <DiagnosticsModal props={props} />);
}
function DiagnosticsModal({ props }: { props: RenderModalProps }) {
    const [stats, setStats] = useState<Awaited<ReturnType<typeof diagnostics>> | null>(null);
    useEffect(() => {
        let alive = true;
        const update = () =>
            void diagnostics()
                .then((value) => {
                    if (alive) setStats(value);
                })
                .catch(() => {});
        update();
        const timer = setInterval(update, 1000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);
    return (
        <Modal
            {...props}
            title="翻译运行状态"
            subtitle="本机计数，不记录聊天原文、用户标识或密钥。"
            size="lg"
        >
            <div className="ct-panel">
                {stats && (
                    <>
                        <p>
                            窗口：{stats.active ? "活动" : "暂停"} · 观察消息 {stats.observed} ·
                            视窗相交 {stats.visible}
                        </p>
                        <p>
                            本地识别：{stats.detectionCalls} 次 / {stats.detectionItems}{" "}
                            条；下表为最近 20 次原生翻译调用。
                        </p>
                        <table className="ct-diagnostics">
                            <thead>
                                <tr>
                                    <th>调用</th>
                                    <th>待译</th>
                                    <th>上下文</th>
                                    <th>返回</th>
                                    <th>耗时</th>
                                    <th>思考 token</th>
                                    <th>总生成 token</th>
                                    <th>状态</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.batches.map((batch, i) => (
                                    <tr key={i}>
                                        <td>{batch.kind === "automatic" ? "消息" : "按需"}</td>
                                        <td>{batch.targets}</td>
                                        <td>{batch.context}</td>
                                        <td>{batch.results}</td>
                                        <td>{batch.elapsedMs} ms</td>
                                        <td>{batch.reasoningTokens ?? "未提供"}</td>
                                        <td>{batch.completionTokens ?? "未提供"}</td>
                                        <td>
                                            {
                                                {
                                                    running: "进行中",
                                                    success: "成功",
                                                    error: "失败",
                                                }[batch.status]
                                            }
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </>
                )}
            </div>
        </Modal>
    );
}

export function scopeMessage(channelId: string): ReturnType<typeof input> {
    return input({ id: "0", channel_id: channelId, content: "" } as Message);
}

export function hideMessage(message: Message): void {
    hide(messageKey(input(message)));
}
