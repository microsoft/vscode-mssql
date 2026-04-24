/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { logger2 } from "../../models/logger2";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugExportData,
} from "../../sharedInterfaces/inlineCompletionDebug";

const DEFAULT_EVENT_CAPACITY = 500;
const MAX_PROMPT_AND_SCHEMA_CHARS = 64 * 1024;
const TRUNCATION_SUFFIX_PREFIX = "... [truncated, ";
const TRUNCATION_SUFFIX_SUFFIX = " more chars]";

const defaultOverrides: InlineCompletionDebugOverrides = {
    modelFamily: null,
    useSchemaContext: null,
    debounceMs: null,
    maxTokens: null,
    forceIntentMode: null,
    customSystemPrompt: null,
    allowAutomaticTriggers: null,
};

class InlineCompletionDebugStore {
    private readonly _logger = logger2.withPrefix("InlineCompletionDebug");
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private _events: InlineCompletionDebugEvent[] = [];
    private _overrides: InlineCompletionDebugOverrides = { ...defaultOverrides };
    private _eventCounter = 0;
    private _panelOpen = false;

    public readonly onDidChange = this._onDidChange.event;

    public getOverrides(): InlineCompletionDebugOverrides {
        return { ...this._overrides };
    }

    public updateOverrides(overrides: Partial<InlineCompletionDebugOverrides>): void {
        this._overrides = {
            ...this._overrides,
            ...normalizePartialOverrides(overrides),
        };
        this._onDidChange.fire();
    }

    public replaceOverrides(overrides: InlineCompletionDebugOverrides): void {
        this._overrides = normalizeOverrides(overrides);
        this._onDidChange.fire();
    }

    public getEvents(): InlineCompletionDebugEvent[] {
        return [...this._events];
    }

    public getEvent(eventId: string): InlineCompletionDebugEvent | undefined {
        return this._events.find((event) => event.id === eventId);
    }

    public addEvent(event: Omit<InlineCompletionDebugEvent, "id">): InlineCompletionDebugEvent {
        const storedEvent: InlineCompletionDebugEvent = {
            ...event,
            id: `E-${++this._eventCounter}`,
        };

        this.applyPromptAndSchemaBudget(storedEvent);
        this._events.push(storedEvent);
        if (this._events.length > DEFAULT_EVENT_CAPACITY) {
            this._events.splice(0, this._events.length - DEFAULT_EVENT_CAPACITY);
        }

        this._onDidChange.fire();
        return storedEvent;
    }

    public markAccepted(eventId: string): void {
        const event = this.getEvent(eventId);
        if (!event || event.result !== "success") {
            return;
        }

        event.result = "accepted";
        this._onDidChange.fire();
    }

    public clearEvents(): void {
        if (this._events.length === 0) {
            return;
        }

        this._events = [];
        this._onDidChange.fire();
    }

    public importSession(data: InlineCompletionDebugExportData): void {
        const importedEvents = [...(data.events ?? [])]
            .slice(-DEFAULT_EVENT_CAPACITY)
            .map((event) => {
                const importedEvent = {
                    ...event,
                    promptMessages: [...(event.promptMessages ?? [])],
                };
                this.applyPromptAndSchemaBudget(importedEvent);
                return importedEvent;
            });

        this._events = importedEvents;
        this._eventCounter = this.getHighestImportedCounter(importedEvents);
        this._overrides = normalizeOverrides(data.overrides ?? defaultOverrides);
        this._logger.info(
            `Imported ${importedEvents.length} inline completion debug events into the store.`,
        );
        this._onDidChange.fire();
    }

    public exportSession(
        recordWhenClosed: boolean,
        customPromptLastSavedAt?: number,
    ): InlineCompletionDebugExportData {
        return {
            version: 1,
            exportedAt: Date.now(),
            overrides: this.getOverrides(),
            recordWhenClosed,
            customPromptLastSavedAt,
            events: this.getEvents(),
        };
    }

    public setPanelOpen(isOpen: boolean): void {
        this._panelOpen = isOpen;
    }

    public isPanelOpen(): boolean {
        return this._panelOpen;
    }

    public shouldCapture(recordWhenClosed: boolean): boolean {
        return this._panelOpen || recordWhenClosed;
    }

    private applyPromptAndSchemaBudget(event: InlineCompletionDebugEvent): void {
        const promptMessages = event.promptMessages ?? [];
        const promptLength = promptMessages.reduce(
            (sum, message) => sum + message.content.length,
            0,
        );

        if (promptLength > MAX_PROMPT_AND_SCHEMA_CHARS) {
            let remainingBudget = MAX_PROMPT_AND_SCHEMA_CHARS;
            event.promptMessages = promptMessages.map((message) => {
                const truncated = truncateToBudget(message.content, remainingBudget);
                remainingBudget = Math.max(0, remainingBudget - truncated.originalLengthKept);
                return {
                    role: message.role,
                    content: truncated.text,
                };
            });
            event.schemaContextFormatted = undefined;
            return;
        }

        const remainingBudget = MAX_PROMPT_AND_SCHEMA_CHARS - promptLength;
        if (
            !event.schemaContextFormatted ||
            event.schemaContextFormatted.length <= remainingBudget
        ) {
            return;
        }

        event.schemaContextFormatted = truncateToBudget(
            event.schemaContextFormatted,
            remainingBudget,
        ).text;
    }

    private getHighestImportedCounter(events: InlineCompletionDebugEvent[]): number {
        return events.reduce((highest, event) => {
            const match = /^E-(\d+)$/.exec(event.id);
            if (!match) {
                return highest;
            }

            const parsed = Number(match[1]);
            return Number.isFinite(parsed) ? Math.max(highest, parsed) : highest;
        }, 0);
    }
}

function normalizeOverrides(
    overrides: Partial<InlineCompletionDebugOverrides>,
): InlineCompletionDebugOverrides {
    return {
        modelFamily: normalizeNullableString(overrides.modelFamily),
        useSchemaContext: normalizeNullableBoolean(overrides.useSchemaContext),
        debounceMs: normalizeNullableNumber(overrides.debounceMs),
        maxTokens: normalizeNullableNumber(overrides.maxTokens),
        forceIntentMode: normalizeNullableBoolean(overrides.forceIntentMode),
        customSystemPrompt: normalizeNullableString(overrides.customSystemPrompt, true),
        allowAutomaticTriggers: normalizeNullableBoolean(overrides.allowAutomaticTriggers),
    };
}

function normalizePartialOverrides(
    overrides: Partial<InlineCompletionDebugOverrides>,
): Partial<InlineCompletionDebugOverrides> {
    const normalized: Partial<InlineCompletionDebugOverrides> = {};

    if (Object.prototype.hasOwnProperty.call(overrides, "modelFamily")) {
        normalized.modelFamily = normalizeNullableString(overrides.modelFamily);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "useSchemaContext")) {
        normalized.useSchemaContext = normalizeNullableBoolean(overrides.useSchemaContext);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "debounceMs")) {
        normalized.debounceMs = normalizeNullableNumber(overrides.debounceMs);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "maxTokens")) {
        normalized.maxTokens = normalizeNullableNumber(overrides.maxTokens);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "forceIntentMode")) {
        normalized.forceIntentMode = normalizeNullableBoolean(overrides.forceIntentMode);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "customSystemPrompt")) {
        normalized.customSystemPrompt = normalizeNullableString(overrides.customSystemPrompt, true);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "allowAutomaticTriggers")) {
        normalized.allowAutomaticTriggers = normalizeNullableBoolean(
            overrides.allowAutomaticTriggers,
        );
    }

    return normalized;
}

function normalizeNullableString(
    value: string | null | undefined,
    preserveWhitespace: boolean = false,
): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = preserveWhitespace ? value : value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeNullableBoolean(value: boolean | null | undefined): boolean | null {
    return typeof value === "boolean" ? value : null;
}

function normalizeNullableNumber(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncateToBudget(
    text: string,
    budget: number,
): { text: string; originalLengthKept: number } {
    if (budget <= 0) {
        return { text: "", originalLengthKept: 0 };
    }

    if (text.length <= budget) {
        return { text, originalLengthKept: text.length };
    }

    const omittedChars = text.length - budget;
    const suffix = `${TRUNCATION_SUFFIX_PREFIX}${omittedChars}${TRUNCATION_SUFFIX_SUFFIX}`;
    const prefixBudget = Math.max(0, budget - suffix.length);
    return {
        text: `${text.slice(0, prefixBudget)}${suffix}`,
        originalLengthKept: budget,
    };
}

export const inlineCompletionDebugStore = new InlineCompletionDebugStore();
export const inlineCompletionDebugDefaultOverrides = defaultOverrides;
