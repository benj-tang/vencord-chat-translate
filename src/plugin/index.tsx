// SPDX-License-Identifier: GPL-3.0-or-later
import "./styles.css";
import { findGroupChildrenByChildId, type NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, React } from "@webpack/common";
import { presetRule, resolveRule } from "../core/config";
import type { Preset, ScopeOverride } from "../core/types";
import { input, manual, startRuntime, stopRuntime, forget, reloadRuntime } from "./runtime";
import { settings, appConfig } from "./settings";
import {
    clearCache,
    DraftButton,
    hideMessage,
    MessageTranslation,
    openManualModal,
    TranslateIcon,
} from "./ui";

function setScope(kind: "servers" | "channels", id: string, override: ScopeOverride | null) {
    const values = { ...settings.store[kind] };
    if (override) values[id] = override;
    else delete values[id];
    settings.store[kind] = values;
    // Private settings do not have an onChange callback.
    reloadRuntime();
}
function scopeMenu(kind: "servers" | "channels", id: string) {
    return (
        <Menu.MenuItem
            id={`ct-scope-${kind}`}
            label={kind === "servers" ? "服务器翻译预设" : "频道翻译预设"}
        >
            {(["bilingual", "english", "chinese"] as Preset[]).map((preset, i) => (
                <Menu.MenuItem
                    key={preset}
                    id={`ct-${kind}-${preset}`}
                    label={["中英阅读", "英文频道", "中文频道"][i]}
                    action={() => setScope(kind, id, presetRule(preset))}
                />
            ))}
            <Menu.MenuItem
                id={`ct-${kind}-off`}
                label="关闭此范围自动翻译"
                action={() => setScope(kind, id, { enabled: false })}
            />
            <Menu.MenuItem
                id={`ct-${kind}-inherit`}
                label="继承上级设置"
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
        children.push(<Menu.MenuGroup>{scopeMenu("channels", channel.id)}</Menu.MenuGroup>);
};
const guildMenu: NavContextMenuPatchCallback = (children, { guild }: any) => {
    if (guild?.id) children.push(<Menu.MenuGroup>{scopeMenu("servers", guild.id)}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "ChatTranslate",
    description: "本地识别语种，翻译视窗内消息，并预览草稿译文。",
    authors: [{ name: "ChatTranslate contributors", id: 0n }],
    tags: ["Chat", "Utility", "Accessibility"],
    settings,
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
    toolboxActions: { 清空翻译缓存: clearCache },
    flux: {
        MESSAGE_DELETE({ id, channelId }: { id: string; channelId: string }) {
            forget(`${channelId}:${id}`);
        },
    },
});
