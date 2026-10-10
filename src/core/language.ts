// SPDX-License-Identifier: GPL-3.0-or-later
import type { Candidate, Detection, Rule } from "./types";

export const PROTECTED_PATTERN =
    /```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s<>]+|<a?:\w+:\d+>|<[@#][!&]?\d+>|<\/[^>]+:\d+>/gu;
const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CHINESE = new Set(["zh", "yue", "wuu", "zh-cn", "zh-tw", "zh-hans", "zh-hant"]);
const CHINESE_HINT =
    /(?:已经|已經|到账|到賬|什么时候|什麼時候|谢谢|謝謝|请问|請問|收到|今天|这个|這個|吗|嗎)/u;
const TERMS = new Set(["ES", "NQ", "MES", "MNQ", "VWAP", "API", "USD", "USDT", "BTC", "ETH"]);

export const isChinese = (language: string | null) =>
    !!language && CHINESE.has(language.toLowerCase());
export const cleanForDetection = (text: string) =>
    text.replace(PROTECTED_PATTERN, " ").replace(/\s+/gu, " ").trim();

function hasLatinNatural(text: string): boolean {
    return (text.match(/\p{Script=Latin}+/gu) ?? []).some((word) => !TERMS.has(word));
}

export function classify(text: string, candidates: Candidate[]): Detection {
    const clean = cleanForDetection(text);
    const latinNatural = hasLatinNatural(clean);
    const result = (kind: Detection["kind"], language: string | null): Detection => ({
        kind,
        language,
        candidates,
        latinNatural,
    });
    if (!/\p{Letter}/u.test(clean)) return result("nonlinguistic", null);
    const words = clean.match(/\p{Letter}+/gu) ?? [];
    if (words.length && words.every((word) => TERMS.has(word)))
        return result("nonlinguistic", null);
    const han = HAN.test(clean);
    const kana = KANA.test(clean);
    if (han && !kana && latinNatural) return result("mixed", candidates[0]?.language ?? null);
    const best = candidates[0];
    if (han && !kana && CHINESE_HINT.test(clean) && !latinNatural) return result("chinese", "zh");
    // Scores are gating heuristics, not calibrated probabilities of correctness.
    const certain = best && best.score >= 0.65 && best.score - (candidates[1]?.score ?? 0) >= 0.15;
    if (certain && isChinese(best.language) && !kana) return result("chinese", best.language);
    if (han && !kana) return result("unknown", best?.language ?? null);
    if (certain) return result("foreign", best.language);
    return result("unknown", best?.language ?? null);
}

export function translationTarget(rule: Rule, detection: Detection): string | null {
    if (detection.kind === "nonlinguistic") return null;
    if (rule.mode === "all") return rule.target;
    if (rule.mode === "mappings") {
        if (detection.kind === "unknown" || detection.kind === "mixed") return null;
        return rule.mappings[detection.language ?? ""] ?? null;
    }
    if (rule.mode === "selected") {
        if (detection.kind === "unknown") return null;
        if (detection.kind === "mixed")
            return rule.mixed && rule.sourceLanguages.includes("en") && detection.latinNatural
                ? rule.target
                : null;
        return rule.sourceLanguages.includes(detection.language ?? "") ? rule.target : null;
    }
    if (detection.kind === "chinese") return null;
    if (detection.kind === "mixed") return rule.mixed ? rule.target : null;
    if (detection.kind === "foreign") return rule.target;
    return detection.latinNatural && rule.preset !== "chinese" ? rule.target : null;
}
