// SPDX-License-Identifier: GPL-3.0-or-later
import { Worker } from "node:worker_threads";
import type { Candidate, LocalDetector } from "../core/types";

export class WorkerDetector implements LocalDetector {
    private worker: Worker | null = null;
    private sequence = 0;
    private pending = new Map<
        number,
        {
            resolve(value: Candidate[][]): void;
            reject(error: Error): void;
            timeout: ReturnType<typeof setTimeout>;
        }
    >();
    constructor(private readonly source: string) {}
    private initialize(): Worker {
        if (this.worker) return this.worker;
        const worker = new Worker(this.source, { eval: true });
        this.worker = worker;
        worker.on(
            "message",
            (message: { id?: number; error?: string; results?: Candidate[][]; type?: string }) => {
                if (message.type === "error") {
                    this.rejectAll();
                    void this.close();
                    return;
                }
                const job = this.pending.get(message.id ?? -1);
                if (!job) return;
                clearTimeout(job.timeout);
                this.pending.delete(message.id!);
                if (message.error || !message.results)
                    job.reject(new Error("Local language detection failed"));
                else job.resolve(message.results);
            },
        );
        worker.on("error", () => {
            this.rejectAll();
            this.worker = null;
        });
        worker.on("exit", () => {
            if (this.worker === worker) {
                this.rejectAll();
                this.worker = null;
            }
        });
        return worker;
    }
    detect(texts: string[]): Promise<Candidate[][]> {
        if (!texts.length) return Promise.resolve([]);
        const worker = this.initialize();
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error("Local language detection timed out"));
                void this.close();
            }, 10000);
            this.pending.set(id, { resolve, reject, timeout });
            worker.postMessage({ id, texts });
        });
    }
    private rejectAll(): void {
        for (const job of this.pending.values()) {
            clearTimeout(job.timeout);
            job.reject(new Error("Local language detector stopped"));
        }
        this.pending.clear();
    }
    async close(): Promise<void> {
        this.rejectAll();
        const worker = this.worker;
        this.worker = null;
        if (worker) await worker.terminate();
    }
}
