// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderConfig } from "../core/types";

export interface CacheOptions {
    ttlDays: number;
    maxEntries: number;
}
interface StoredTranslation {
    key: string;
    text: string;
    createdAt: number;
    lastAccessAt: number;
}
const MAX_BYTES = 10 * 1024 * 1024;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const persistentCachePath = () =>
    join(homedir(), ".cache", "chat-translate", "translations-v1.json");

export function providerNamespace(config: ProviderConfig): string {
    return digest(
        JSON.stringify([
            "ct-translation-v1",
            config.endpoint,
            config.model,
            config.reasoningEffort,
        ]),
    );
}

export class PersistentTranslationCache {
    private entries = new Map<string, StoredTranslation>();
    private loaded = false;
    private pending: Promise<unknown> = Promise.resolve();
    private hits = 0;
    private misses = 0;
    private bytes = 0;
    private status: "ready" | "unavailable" | "rebuilt" = "ready";

    constructor(
        private readonly path = persistentCachePath(),
        private options: CacheOptions = { ttlDays: 30, maxEntries: 5000 },
        private readonly clock = () => Date.now(),
    ) {}

    stats() {
        return {
            entries: this.entries.size,
            bytes: this.bytes,
            hits: this.hits,
            misses: this.misses,
            status: this.status,
        };
    }

    private run<T>(action: () => Promise<T>): Promise<T> {
        const operation = this.pending.catch(() => {}).then(action);
        this.pending = operation;
        return operation.catch((error) => {
            this.status = "unavailable";
            throw error;
        });
    }

    private configure(options?: CacheOptions) {
        if (options) this.options = options;
        if (
            !Number.isInteger(this.options.ttlDays) ||
            this.options.ttlDays < 1 ||
            this.options.ttlDays > 365 ||
            !Number.isInteger(this.options.maxEntries) ||
            this.options.maxEntries < 1 ||
            this.options.maxEntries > 20000
        )
            throw new Error("Invalid persistent cache limits");
    }

    private prune(): boolean {
        const before = this.entries.size;
        const cutoff = this.clock() - this.options.ttlDays * 86400000;
        for (const [key, entry] of this.entries)
            if (entry.createdAt <= cutoff) this.entries.delete(key);
        while (this.entries.size > this.options.maxEntries)
            this.entries.delete(this.entries.keys().next().value!);
        return this.entries.size !== before;
    }

    private async load(): Promise<void> {
        if (this.loaded) return;
        const directory = dirname(this.path);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const dirStat = await lstat(directory);
        if (
            !dirStat.isDirectory() ||
            dirStat.isSymbolicLink() ||
            (process.platform !== "win32" && (dirStat.mode & 0o077) !== 0)
        )
            throw new Error("Check private cache directory permissions");
        let file;
        try {
            const info = await lstat(this.path);
            if (
                !info.isFile() ||
                info.isSymbolicLink() ||
                (process.platform !== "win32" && (info.mode & 0o077) !== 0)
            )
                throw new Error("Check private cache file permissions");
            file = await open(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (file) {
            try {
                const info = await file.stat();
                if (info.size > MAX_BYTES) throw new Error("Cache exceeds size limit");
                const raw = await file.readFile("utf8");
                const parsed = JSON.parse(raw);
                if (parsed?.version !== 1 || !Array.isArray(parsed.entries))
                    throw new Error("Invalid cache version");
                for (const entry of parsed.entries) {
                    if (
                        !entry ||
                        !/^[a-f0-9]{64}$/.test(entry.key) ||
                        typeof entry.text !== "string" ||
                        !entry.text.trim() ||
                        entry.text.length > 50000 ||
                        !Number.isSafeInteger(entry.createdAt) ||
                        !Number.isSafeInteger(entry.lastAccessAt) ||
                        entry.createdAt < 0 ||
                        entry.lastAccessAt < 0
                    )
                        throw new Error("Invalid cache entry");
                }
                this.entries = new Map(
                    (parsed.entries as StoredTranslation[])
                        .sort((a, b) => a.lastAccessAt - b.lastAccessAt)
                        .map((entry) => [entry.key, entry]),
                );
                this.bytes = Buffer.byteLength(raw);
            } catch {
                this.entries.clear();
                this.status = "rebuilt";
            } finally {
                await file.close();
            }
        }
        this.loaded = true;
    }

    private async flush(): Promise<void> {
        // Exclusive temporary file plus rename keeps interrupted writes from corrupting the cache.
        const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
        let encoded = JSON.stringify({ version: 1, entries: [...this.entries.values()] });
        let size = Buffer.byteLength(encoded);
        while (size > MAX_BYTES && this.entries.size) {
            const key = this.entries.keys().next().value!;
            size -= Buffer.byteLength(JSON.stringify(this.entries.get(key))) + 1;
            this.entries.delete(key);
        }
        encoded = JSON.stringify({ version: 1, entries: [...this.entries.values()] });
        const file = await open(temporary, "wx", 0o600);
        try {
            await file.writeFile(encoded, "utf8");
            await file.sync();
            await file.close();
            await rename(temporary, this.path);
            this.bytes = Buffer.byteLength(encoded);
            this.status = "ready";
        } finally {
            await file.close();
            await rm(temporary, { force: true });
        }
    }

    get(
        namespace: string,
        keys: string[],
        options?: CacheOptions,
    ): Promise<Record<string, string>> {
        return this.run(async () => {
            this.configure(options);
            await this.load();
            if (this.prune()) await this.flush();
            const result: Array<[string, string]> = [];
            for (const key of keys) {
                const hashed = digest(`${namespace}\0${key}`);
                const entry = this.entries.get(hashed);
                if (entry) {
                    this.hits++;
                    entry.lastAccessAt = this.clock();
                    this.entries.delete(hashed);
                    this.entries.set(hashed, entry);
                    result.push([key, entry.text]);
                } else this.misses++;
            }
            return Object.fromEntries(result);
        });
    }

    set(namespace: string, values: Record<string, string>, options?: CacheOptions): Promise<void> {
        return this.run(async () => {
            this.configure(options);
            await this.load();
            for (const [key, text] of Object.entries(values)) {
                if (typeof text !== "string" || !text.trim() || text.length > 50000)
                    throw new Error("Invalid persistent translation");
                const hashed = digest(`${namespace}\0${key}`);
                this.entries.delete(hashed);
                this.entries.set(hashed, {
                    key: hashed,
                    text,
                    createdAt: this.clock(),
                    lastAccessAt: this.clock(),
                });
            }
            this.prune();
            await this.flush();
        });
    }

    clear(): Promise<void> {
        return this.run(async () => {
            await this.load();
            this.entries.clear();
            await this.flush();
        });
    }
}
