// SPDX-License-Identifier: GPL-3.0-or-later
import { PROTECTED_PATTERN } from "./language";

export interface ProtectedText {
    text: string;
    restore(translated: string): string;
}

export function protectText(text: string, terms: string[], keepChinese = false): ProtectedText {
    let prefix = "[[CT";
    while (text.includes(prefix)) prefix += "X";
    const values: string[] = [];
    const token = (value: string) => {
        const id = `${prefix}${values.length}]]`;
        values.push(value);
        return id;
    };
    let protectedText = text.replace(PROTECTED_PATTERN, token);
    if (terms.length) {
        const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        protectedText = protectedText.replace(
            new RegExp(`\\b(?:${escaped.join("|")})\\b`, "gu"),
            token,
        );
    }
    if (keepChinese) {
        protectedText = protectedText.replace(/[\p{Script=Han}，。！？、；：「」『』]+/gu, token);
    }
    return {
        text: protectedText,
        restore(translated) {
            for (let i = 0; i < values.length; i++) {
                const marker = `${prefix}${i}]]`;
                if (translated.split(marker).length !== 2)
                    throw new Error("Protected text was changed");
            }
            const allowed = new Set(values.map((_, i) => `${prefix}${i}]]`));
            for (const marker of translated.match(/\[\[CTX*\d+\]\]/g) ?? []) {
                if (marker.startsWith(prefix) && !allowed.has(marker))
                    throw new Error("Unexpected protected token");
            }
            return values.reduce(
                (out, value, i) => out.replace(`${prefix}${i}]]`, () => value),
                translated,
            );
        },
    };
}
