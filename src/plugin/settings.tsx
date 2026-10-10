// SPDX-License-Identifier: GPL-3.0-or-later
import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { React, useState } from "@webpack/common";
import type { JSX } from "react";
import { defaultConfig, presetRule, validateConfig } from "../core/config";
import type { AppConfig, Preset, ProviderConfig, ScopeOverride } from "../core/types";

let changed: (() => void) | undefined;
export function onSettingsChange(callback?: () => void): void {
    changed = callback;
}
const onChange = () => changed?.();

function ApiKeyField({ setValue }: { setValue(value: string): void }): JSX.Element {
    const [value, setLocal] = useState(settings.store.apiKey ?? "");
    return (
        <label>
            翻译接口密钥
            <input
                className="ct-input"
                type="password"
                autoComplete="off"
                value={value}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={() => setValue(value)}
            />
            <small>保存在本机 Vencord 设置中；分享设置前请删除密钥。</small>
        </label>
    );
}

export const settings = definePluginSettings({
    autoEnabled: {
        type: OptionType.BOOLEAN,
        description: "全局自动翻译（也可只在指定服务器或频道开启）",
        default: false,
        onChange,
    },
    preset: {
        type: OptionType.SELECT,
        description: "默认阅读预设",
        options: [
            { label: "中英阅读", value: "bilingual", default: true },
            { label: "英文频道", value: "english" },
            { label: "中文频道", value: "chinese" },
        ],
        onChange,
    },
    target: {
        type: OptionType.STRING,
        description: "收到消息的目标语言",
        default: "zh-CN",
        onChange,
    },
    mode: {
        type: OptionType.SELECT,
        description: "自动翻译规则",
        options: [
            { label: "非中文就翻译", value: "nonChinese", default: true },
            { label: "只翻指定语言", value: "selected" },
            { label: "按语言对应表翻译", value: "mappings" },
            { label: "全部自然语言", value: "all" },
        ],
        onChange,
    },
    sources: {
        type: OptionType.STRING,
        description: "指定源语言，以逗号分隔，例如 en,es",
        default: "en",
        onChange,
    },
    mappings: {
        type: OptionType.STRING,
        description: '语言对应表 JSON，例如 {"en":"zh-CN","zh":"en"}',
        default: "{}",
        onChange,
    },
    mixed: {
        type: OptionType.BOOLEAN,
        description: "翻译中英混合消息的外语片段",
        default: true,
        onChange,
    },
    endpoint: {
        type: OptionType.STRING,
        description: "兼容接口的完整 chat/completions 地址",
        default: "",
        onChange,
    },
    model: { type: OptionType.STRING, description: "翻译模型名称", default: "", onChange },
    apiKey: { type: OptionType.COMPONENT, component: ApiKeyField, default: "", onChange },
    outputTarget: {
        type: OptionType.STRING,
        description: "草稿按需翻译的目标语言（空白时按频道预设）",
        default: "",
        onChange,
    },
    maxChars: {
        type: OptionType.NUMBER,
        description: "每批原文字符上限（包含上下文）",
        default: 12000,
        onChange,
    },
    dailyChars: {
        type: OptionType.NUMBER,
        description: "每日请求内容字符上限（非费用估算，重启后重置）",
        default: 100000,
        onChange,
    },
    timeoutMs: {
        type: OptionType.NUMBER,
        description: "翻译请求超时，毫秒",
        default: 30000,
        onChange,
    },
    outputTokens: {
        type: OptionType.NUMBER,
        description: "每次请求的最大输出 token",
        default: 6000,
        onChange,
    },
}).withPrivateSettings<{
    servers?: Record<string, ScopeOverride>;
    channels?: Record<string, ScopeOverride>;
}>();

export function appConfig(): AppConfig {
    const config = defaultConfig();
    config.global = {
        ...presetRule(settings.store.preset as Preset),
        enabled: settings.store.autoEnabled,
        target: settings.store.target,
        mode: settings.store.mode as AppConfig["global"]["mode"],
        mixed: settings.store.mixed,
        sourceLanguages: settings.store.sources
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        mappings: JSON.parse(settings.store.mappings),
    };
    config.servers = structuredClone(settings.store.servers ?? {});
    config.channels = structuredClone(settings.store.channels ?? {});
    config.maxChars = settings.store.maxChars;
    config.maxDailyChars = settings.store.dailyChars;
    validateConfig(config);
    return config;
}

export function providerConfig(): ProviderConfig {
    return {
        endpoint: settings.store.endpoint,
        model: settings.store.model,
        apiKey: settings.store.apiKey,
        timeoutMs: settings.store.timeoutMs,
        maxOutputTokens: settings.store.outputTokens,
    };
}
