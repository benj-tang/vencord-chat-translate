// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { readableMentions, type MentionNames } from "../src/core/mentions";
import { protectText } from "../src/core/protection";

const names: MentionNames = {
    user: (id) => (id === "123456789012345678" ? "小明" : undefined),
    role: (id) => (id === "223456789012345678" ? "管理员" : undefined),
    channel: (id) => (id === "323456789012345678" ? "global-chat" : undefined),
};

test("incoming display resolves original users, nickname mentions, roles and channels", () => {
    const original =
        "Hello <@123456789012345678> <@!123456789012345678> <@&223456789012345678> <#323456789012345678>";
    assert.equal(
        readableMentions(original.replace("Hello", "你好"), original, names),
        "你好 @小明 @小明 @管理员 #global-chat",
    );
});

test("unknown names use readable labels without requesting or displaying numeric IDs", () => {
    const original = "<@999> <@!999> <@&998> <#997> @everyone @here";
    assert.equal(
        readableMentions(original, original, names),
        "@用户 @用户 @身份组 #频道 @everyone @here",
    );
});

test("model-invented tokens, inline code, fenced code and URL tokens stay literal", () => {
    const token = "<@123456789012345678>";
    for (const original of [
        "Hello",
        `\`${token}\``,
        `\`\`\`\n${token}\n\`\`\``,
        "https://example.test/%3C@123456789012345678%3E",
    ]) {
        assert.equal(readableMentions(token, original, names), token);
    }
    assert.equal(
        readableMentions(`<@!123456789012345678>`, token, names),
        "<@!123456789012345678>",
    );
    assert.equal(readableMentions(`\`${token}\``, token, names), `\`${token}\``);
});

test("mention IDs never enter the protected provider text and restoration stays exact", () => {
    const original =
        "Hello <@123456789012345678>, ask <@&223456789012345678> in <#323456789012345678>";
    const protectedText = protectText(original, []);
    assert.equal(protectedText.text, "Hello [[CT0]], ask [[CT1]] in [[CT2]]");
    assert.doesNotMatch(protectedText.text, /\d{17,}/u);
    const restored = protectedText.restore("你好 [[CT0]]，请在 [[CT2]] 询问 [[CT1]]");
    assert.equal(
        restored,
        "你好 <@123456789012345678>，请在 <#323456789012345678> 询问 <@&223456789012345678>",
    );
    assert.equal(
        readableMentions(restored, original, names),
        "你好 @小明，请在 #global-chat 询问 @管理员",
    );
});
