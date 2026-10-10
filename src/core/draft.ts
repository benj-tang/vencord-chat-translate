// SPDX-License-Identifier: GPL-3.0-or-later
export interface DraftSnapshot {
    channelId: string;
    text: string;
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
