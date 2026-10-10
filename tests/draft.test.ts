// SPDX-License-Identifier: GPL-3.0-or-later
import assert from "node:assert/strict";
import test from "node:test";
import { TripleSpaceShortcut, waitForDraftConfirmation } from "../src/core/draft";

const original = { channelId: "c0", text: "Synthetic original" };
const replacement = "Synthetic translation";

test("draft application waits for the debounced store to catch up to the visible editor", async () => {
    const start = Date.now();
    let reads = 0;
    await waitForDraftConfirmation(
        original,
        replacement,
        () => {
            reads++;
            return {
                channelId: "c0",
                text: Date.now() - start >= 50 ? replacement : original.text,
                editorText: replacement,
            };
        },
        300,
    );
    assert.ok(reads > 1);
});
test("user edits and channel changes cancel confirmation even if the store looks correct", async () => {
    for (const current of [
        { channelId: "c1", text: replacement, editorText: replacement },
        { channelId: "c0", text: replacement, editorText: "User continued typing" },
        { channelId: "c0", text: "User continued typing", editorText: replacement },
    ])
        await assert.rejects(
            waitForDraftConfirmation(original, replacement, () => current),
            /changed during replacement/,
        );
});
test("a store that never saves fails within a bounded time", async () => {
    await assert.rejects(
        waitForDraftConfirmation(
            original,
            replacement,
            () => ({ ...original, editorText: replacement }),
            30,
        ),
        /saving was not confirmed/,
    );
});

const space = { key: " ", repeat: false, isComposing: false, modified: false };
test("three consecutive spaces trigger once; slow typing and other keys reset the gesture", () => {
    const trigger = new TripleSpaceShortcut();
    assert.equal(trigger.press(space, 0, 500), false);
    assert.equal(trigger.press(space, 100, 500), false);
    assert.equal(trigger.press(space, 200, 500), true);
    assert.equal(trigger.press(space, 300, 500), false);
    assert.equal(trigger.press(space, 1000, 500), false);
    assert.equal(trigger.press({ ...space, key: "a" }, 1100, 500), false);
    assert.equal(trigger.press(space, 1200, 500), false);
    assert.equal(trigger.press(space, 1300, 500), false);
    assert.equal(trigger.press(space, 1400, 500), true);
});
test("held spaces, IME, modifier shortcuts and focus resets cannot trigger translation", () => {
    for (const interruption of [
        { ...space, repeat: true },
        { ...space, isComposing: true },
        { ...space, modified: true },
    ]) {
        const trigger = new TripleSpaceShortcut();
        trigger.press(space, 0, 500);
        trigger.press(space, 100, 500);
        assert.equal(trigger.press(interruption, 200, 500), false);
        assert.equal(trigger.press(space, 300, 500), false);
        assert.equal(trigger.press(space, 400, 500), false);
        trigger.reset();
        assert.equal(trigger.press(space, 450, 500), false);
    }
});
