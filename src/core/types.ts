// SPDX-License-Identifier: GPL-3.0-or-later
export type Preset = "bilingual" | "english" | "chinese";
export type Kind = "chinese" | "foreign" | "mixed" | "unknown" | "nonlinguistic";
export interface Candidate {
    language: string;
    score: number;
}
export interface Detection {
    kind: Kind;
    language: string | null;
    candidates: Candidate[];
    latinNatural: boolean;
}
export interface LocalDetector {
    detect(texts: string[]): Promise<Candidate[][]>;
    close(): Promise<void>;
}
export interface MessageInput {
    id: string;
    channelId: string;
    guildId?: string;
    parentId?: string;
    text: string;
    version?: string;
    speaker: string;
    timestamp: number;
    replyTo?: string;
}
export interface Rule {
    preset: Preset;
    enabled: boolean;
    target: string;
    mode: "nonChinese" | "selected" | "mappings" | "all";
    sourceLanguages: string[];
    mappings: Record<string, string>;
    mixed: boolean;
}
export type ScopeOverride = Partial<Rule>;
export interface AppConfig {
    global: Rule;
    servers: Record<string, ScopeOverride>;
    channels: Record<string, ScopeOverride>;
    visibleMs: number;
    maxItems: number;
    maxContext: number;
    concurrency: number;
    maxChars: number;
    maxDailyChars: number;
    skipReplies: string[];
    preserveTerms: string[];
    glossary: Record<string, string>;
}
export interface ProviderConfig {
    endpoint: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    maxOutputTokens: number;
    reasoningEffort?: "low" | "high" | "max";
    useLocalProfile?: boolean;
}
export interface TranslationItem {
    id: string;
    text: string;
    speaker: string;
    mode: "translate" | "context";
    source: string;
    replyTo?: string;
}
export interface TranslationRequest {
    target: string;
    items: TranslationItem[];
    glossary: Record<string, string>;
}
export interface TranslationResult {
    id: string;
    text: string;
}
export interface Translator {
    translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult[]>;
}
export type Status = "idle" | "queued" | "loading" | "done" | "error";
export interface ViewState {
    status: Status;
    translation?: string;
    error?: string;
    detection?: Detection;
}
export const messageKey = (m: Pick<MessageInput, "channelId" | "id">) => `${m.channelId}:${m.id}`;
