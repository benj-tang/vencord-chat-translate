// SPDX-License-Identifier: GPL-3.0-or-later
import { PROTECTED_PATTERN } from "./language";

export interface MentionNames {
    user(id: string): string | undefined;
    role(id: string): string | undefined;
    channel(id: string): string | undefined;
}

const IS_MENTION = /^<(@[!&]?|#)(\d+)>$/u;

export function readableMentions(
    translated: string,
    original: string,
    names: MentionNames,
): string {
    // Only resolve original standalone tokens, excluding code blocks and URLs.
    const allowed = new Set(
        (original.match(PROTECTED_PATTERN) ?? []).filter((token) => IS_MENTION.test(token)),
    );
    return translated.replace(PROTECTED_PATTERN, (token) => {
        if (!allowed.has(token)) return token;
        const [, kind, id] = token.match(IS_MENTION)!;
        if (kind === "#") return `#${names.channel(id!) || "频道"}`;
        if (kind === "@&") return `@${names.role(id!) || "身份组"}`;
        return `@${names.user(id!) || "用户"}`;
    });
}
