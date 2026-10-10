// SPDX-License-Identifier: GPL-3.0-or-later
export interface DraftSnapshot {
    channelId: string;
    text: string;
}

export class TripleSpaceShortcut {
    private previous = 0;
    private count = 0;
    reset(): void {
        this.count = 0;
    }
    press(
        event: {
            key: string;
            repeat: boolean;
            isComposing: boolean;
            modified: boolean;
        },
        now: number,
        intervalMs: number,
    ): boolean {
        if (event.key !== " " || event.repeat || event.isComposing || event.modified) {
            this.reset();
            return false;
        }
        this.count = this.count && now - this.previous <= intervalMs ? this.count + 1 : 1;
        this.previous = now;
        if (this.count < 3) return false;
        this.reset();
        return true;
    }
}

export async function waitForDraftConfirmation(
    original: DraftSnapshot,
    replacement: string,
    read: () => DraftSnapshot & { editorText: string },
    timeoutMs = 1500,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        const current = read();
        if (
            current.channelId !== original.channelId ||
            current.editorText !== replacement ||
            (current.text !== original.text && current.text !== replacement)
        )
            throw new Error("The channel or draft changed during replacement.");
        if (current.text === replacement) return;
        if (Date.now() >= deadline)
            throw new Error("Draft saving was not confirmed. Check the input before continuing.");
        // Discord saves editor changes to DraftStore after a debounce.
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
}

export class DraftSession {
    private applied: string | null = null;
    constructor(readonly original: DraftSnapshot) {}
    apply(current: DraftSnapshot, translated: string): string {
        if (current.channelId !== this.original.channelId || current.text !== this.original.text) {
            throw new Error("The channel or draft changed. Translate the current draft again.");
        }
        return translated;
    }
    confirmApplied(translated: string): void {
        this.applied = translated;
    }
    restore(current: DraftSnapshot): string {
        if (
            this.applied === null ||
            current.channelId !== this.original.channelId ||
            current.text !== this.applied
        ) {
            throw new Error("The draft changed after translation. Restore was cancelled.");
        }
        return this.original.text;
    }
    confirmRestored(): void {
        this.applied = null;
    }
}
