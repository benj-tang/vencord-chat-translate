// SPDX-License-Identifier: GPL-3.0-or-later
import "./styles.css";
import { findGroupChildrenByChildId, type NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, ContextMenuApi, Menu, React } from "@webpack/common";
import { presetRule, resolveRule, updateScopes } from "../core/config";
import type { Preset, ScopeOverride } from "../core/types";
import {
    input,
    manual,
    startRuntime,
    stopRuntime,
    forget,
    reloadRuntime,
    notifyUser,
} from "./runtime";
import { settings, appConfig } from "./settings";
import {
    clearCache,
    DraftButton,
    hideMessage,
    MessageTranslation,
    openManualModal,
    TranslateIcon,
    openDiagnostics,
    scopeMessage,
} from "./ui";

function setScope(kind: "servers" | "channels", id: string, override: ScopeOverride | null) {
    try {
        settings.store[kind] = updateScopes(settings.store[kind], id, override);
        ContextMenuApi.closeContextMenu();
        // Private settings do not have an onChange callback.
        reloadRuntime();
        notifyUser("翻译范围设置已保存", "success");
    } catch {
        notifyUser("翻译范围设置未保存，请重新选择。", "failure");
    }
}
function scopeMenu(kind: "servers" | "channels", id: string) {
    let config;
    try {
        config = appConfig();
    } catch {
        return (
            <Menu.MenuItem
                id={`ct-${kind}-invalid`}
                label="翻译设置有误 · 查看状态"
                action={openDiagnostics}
            />
        );
    }
    const override = config[kind][id];
    const rule =
        kind === "channels"
            ? resolveRule(config, scopeMessage(id))
            : resolveRule(config, { ...scopeMessage("0"), guildId: id });
    const presetName = { bilingual: "中英阅读", english: "英文频道", chinese: "中文频道" };
    return (
        <Menu.MenuItem
            id={`ct-scope-${kind}`}
            label={`${kind === "servers" ? "服务器" : "频道"}翻译：${rule.enabled ? presetName[rule.preset] : "关闭"}${!override ? "（继承）" : ""}`}
        >
            <Menu.MenuItem
                id={`ct-${kind}-current`}
                label={`当前：${rule.enabled ? "自动翻译" : "自动关闭"} · ${{ nonChinese: "非中文", selected: "指定语言", mappings: "对应表", all: "全部" }[rule.mode]} → ${rule.target}`}
                disabled
            />
            {(["bilingual", "english", "chinese"] as Preset[]).map((preset, i) => (
                <Menu.MenuRadioItem
                    group={`ct-${kind}-preset`}
                    key={preset}
                    id={`ct-${kind}-${preset}`}
                    label={`${["中英阅读", "英文频道", "中文频道"][i]} · ${preset === "chinese" ? "自动关闭" : "自动开启"}`}
                    checked={override?.preset === preset}
                    action={() => setScope(kind, id, presetRule(preset))}
                />
            ))}
            <Menu.MenuRadioItem
                group={`ct-${kind}-preset`}
                id={`ct-${kind}-off`}
                label="关闭此范围自动翻译"
                checked={!!override && override.enabled === false && !override.preset}
                action={() => setScope(kind, id, { enabled: false })}
            />
            <Menu.MenuRadioItem
                group={`ct-${kind}-preset`}
                id={`ct-${kind}-inherit`}
                label="继承上级设置"
                checked={!override}
                action={() => setScope(kind, id, null)}
            />
        </Menu.MenuItem>
    );
}
const messageMenu: NavContextMenuPatchCallback = (children, { message }: { message: Message }) => {
    if (!message?.content) return;
    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;
    group.push(
        <Menu.MenuItem id="ct-translate-menu" label="消息翻译" icon={TranslateIcon}>
            <Menu.MenuItem
                id="ct-translate-zh"
                label="翻译为中文"
                action={() => void manual(input(message))}
            />
            <Menu.MenuItem
                id="ct-translate-language"
                label="选择目标语言"
                action={() => openManualModal(message)}
            />
            <Menu.MenuItem
                id="ct-retranslate"
                label="重新翻译"
                action={() =>
                    void manual(
                        input(message),
                        resolveRule(appConfig(), input(message)).target,
                        true,
                    )
                }
            />
            <Menu.MenuItem id="ct-hide" label="隐藏译文" action={() => hideMessage(message)} />
            {scopeMenu("channels", message.channel_id)}
            {ChannelStore.getChannel(message.channel_id)?.guild_id &&
                scopeMenu("servers", ChannelStore.getChannel(message.channel_id).guild_id)}
        </Menu.MenuItem>,
    );
};
const channelMenu: NavContextMenuPatchCallback = (children, { channel }: any) => {
    if (channel?.id)
        children.push(
            <Menu.MenuGroup>
                {scopeMenu("channels", channel.id)}
                <Menu.MenuItem id="ct-status" label="查看翻译状态" action={openDiagnostics} />
            </Menu.MenuGroup>,
        );
};
const guildMenu: NavContextMenuPatchCallback = (children, { guild }: any) => {
    if (guild?.id) children.push(<Menu.MenuGroup>{scopeMenu("servers", guild.id)}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "ChatTranslate",
    description: "本地识别语种，翻译视窗内消息，按需翻译并替换草稿。",
    authors: [{ name: "ChatTranslate contributors", id: 0n }],
    tags: ["Chat", "Utility", "Accessibility"],
    settings,
    settingsAboutComponent: () => (
        <div className="ct-panel">
            <button onClick={openDiagnostics}>查看翻译状态</button>
            <button onClick={clearCache}>清空翻译缓存</button>
        </div>
    ),
    start: startRuntime,
    stop: () => {
        void stopRuntime();
    },
    contextMenus: {
        message: messageMenu,
        "channel-context": channelMenu,
        "guild-context": guildMenu,
    },
    renderMessageAccessory: (props) => <MessageTranslation message={props.message} />,
    messagePopoverButton: {
        icon: TranslateIcon,
        render(message: Message) {
            if (!message.content) return null;
            return {
                label: "翻译消息",
                icon: TranslateIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: () =>
                    void manual(input(message), resolveRule(appConfig(), input(message)).target),
            };
        },
    },
    chatBarButton: { icon: TranslateIcon, render: DraftButton },
    toolboxActions: { 查看翻译状态: openDiagnostics, 清空翻译缓存: clearCache },
    flux: {
        MESSAGE_DELETE({ id, channelId }: { id: string; channelId: string }) {
            forget(`${channelId}:${id}`);
        },
    },
});
