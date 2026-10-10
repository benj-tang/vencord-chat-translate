// SPDX-License-Identifier: GPL-3.0-or-later
import type { AppConfig, MessageInput, Preset, Rule, ScopeOverride } from "./types";

export function presetRule(preset: Preset): Rule {
    return {
        preset,
        enabled: preset !== "chinese",
        target: "zh-CN",
        mode: "nonChinese",
        sourceLanguages: ["en"],
        mappings: {},
        mixed: true,
    };
}

export function defaultConfig(): AppConfig {
    return {
        global: { ...presetRule("bilingual"), enabled: false },
        servers: {},
        channels: {},
        visibleMs: 1000,
        maxItems: 50,
        maxContext: 5,
        concurrency: 2,
        maxChars: 12000,
        maxDailyChars: 100000,
        skipReplies: [],
        preserveTerms: ["ES", "NQ", "MES", "MNQ", "VWAP"],
        glossary: { payout: "出金", drawdown: "回撤" },
    };
}

function apply(base: Rule, override?: ScopeOverride): Rule {
    if (!override) return base;
    return { ...base, ...(override.preset ? presetRule(override.preset) : {}), ...override };
}

export function resolveRule(config: AppConfig, message: MessageInput): Rule {
    let rule = config.global;
    if (message.guildId) rule = apply(rule, config.servers[message.guildId]);
    if (message.parentId) rule = apply(rule, config.channels[message.parentId]);
    return apply(rule, config.channels[message.channelId]);
}

export function validateConfig(config: AppConfig): void {
    const integer = (value: number, min: number, max: number, name: string) => {
        if (!Number.isInteger(value) || value < min || value > max) {
            throw new Error(`Invalid ${name}: expected ${min}..${max}`);
        }
    };
    integer(config.visibleMs, 1000, 60000, "visibleMs");
    integer(config.maxItems, 1, 50, "maxItems");
    integer(config.maxContext, 0, 5, "maxContext");
    integer(config.concurrency, 1, 4, "concurrency");
    integer(config.maxChars, 100, 50000, "maxChars");
    integer(config.maxDailyChars, 100, 10000000, "maxDailyChars");
    for (const rule of [
        config.global,
        ...Object.values(config.servers).map((v) => apply(config.global, v)),
        ...Object.values(config.channels).map((v) => apply(config.global, v)),
    ]) {
        if (
            !["bilingual", "english", "chinese"].includes(rule.preset) ||
            !["nonChinese", "selected", "mappings", "all"].includes(rule.mode) ||
            typeof rule.enabled !== "boolean" ||
            typeof rule.mixed !== "boolean" ||
            !/^[a-zA-Z-]{2,20}$/.test(rule.target) ||
            !Array.isArray(rule.sourceLanguages) ||
            !rule.sourceLanguages.every((v) => typeof v === "string") ||
            !rule.mappings ||
            typeof rule.mappings !== "object" ||
            !Object.entries(rule.mappings).every(
                ([k, v]) => /^[a-zA-Z-]{2,20}$/.test(k) && /^[a-zA-Z-]{2,20}$/.test(v),
            )
        ) {
            throw new Error("Invalid language rule");
        }
    }
    for (const values of [config.skipReplies, config.preserveTerms]) {
        if (
            !Array.isArray(values) ||
            values.length > 100 ||
            !values.every((v) => typeof v === "string" && v.length > 0 && v.length <= 100)
        ) {
            throw new Error("Invalid text rules");
        }
    }
}
