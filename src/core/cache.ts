// SPDX-License-Identifier: GPL-3.0-or-later
import type { TranslationRequest } from "./types";

export interface PersistentTranslations {
    get(keys: string[]): Promise<Record<string, string>>;
    set(values: Record<string, string>, request: TranslationRequest): Promise<void>;
    clear(): Promise<void>;
}

export class Lru<T> {
    private data = new Map<string, T>();
    constructor(private readonly max = 1000) {}
    get(key: string): T | undefined {
        const value = this.data.get(key);
        if (value !== undefined) {
            this.data.delete(key);
            this.data.set(key, value);
        }
        return value;
    }
    set(key: string, value: T): void {
        this.data.delete(key);
        this.data.set(key, value);
        while (this.data.size > this.max) this.data.delete(this.data.keys().next().value!);
    }
    clear(): void {
        this.data.clear();
    }
}

export class DailyBudget {
    private day = "";
    private used = 0;
    constructor(
        private limit: number,
        private readonly now = () => new Date(),
    ) {}
    setLimit(limit: number): void {
        this.limit = limit;
    }
    reserve(chars: number): void {
        const day = this.now().toISOString().slice(0, 10);
        if (day !== this.day) {
            this.day = day;
            this.used = 0;
        }
        if (this.used + chars > this.limit) throw new Error("Daily character budget reached");
        this.used += chars;
    }
}
