/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions instantiation of the generic feature-capture store (B7).
 * The ring/pending/capture-gating mechanics live in
 * diagnostics/featureCapture/captureStore.ts; this file supplies the
 * completions-specific override surface, normalization, legacy import
 * migration, and the accepted-flip.
 */

import {
    FeatureCaptureStore,
    isJsonRecord,
    normalizeJsonRecord,
    normalizeNullableBoolean,
    normalizeNullableNumber,
    normalizeNullableString,
} from "../../diagnostics/featureCapture/captureStore";
import {
    InlineCompletionCategory,
    InlineCompletionDebugEvent,
    InlineCompletionDebugOverrides,
    InlineCompletionDebugExportData,
    InlineCompletionDebugProfileId,
    InlineCompletionDebugSchemaContextOverrides,
    inlineCompletionCategories,
} from "../../sharedInterfaces/inlineCompletionDebug";
import { isInlineCompletionDebugProfileId } from "./inlineCompletionDebugProfiles";
import { serializeSessionTrace } from "./traceSerializer";

const defaultOverrides: InlineCompletionDebugOverrides = {
    profileId: null,
    modelSelector: null,
    continuationModelSelector: null,
    useSchemaContext: null,
    includeSqlDiagnostics: null,
    debounceMs: null,
    maxTokens: null,
    enabledCategories: null,
    forceIntentMode: null,
    customSystemPrompt: null,
    allowAutomaticTriggers: null,
    schemaContext: null,
};

class InlineCompletionDebugStore extends FeatureCaptureStore<
    InlineCompletionDebugEvent,
    InlineCompletionDebugOverrides
> {
    constructor() {
        super({
            logName: "InlineCompletionDebug",
            featureId: "completions",
            defaultOverrides,
            normalizeOverrides,
            normalizePartialOverrides,
            normalizeImportedOverrides,
            prepareImportedEvent: (event) => ({
                ...event,
                promptMessages: [...(event.promptMessages ?? [])],
            }),
        });
    }

    public setSchemaContextOverride(
        value: InlineCompletionDebugSchemaContextOverrides | null | undefined,
    ): void {
        this.updateOverrides({ schemaContext: value ?? null });
    }

    public markAccepted(eventId: string): void {
        this.mutateEvent(eventId, (event) => {
            if (event.result !== "success") {
                return false;
            }

            event.result = "accepted";
            return true;
        });
    }

    public importSession(data: InlineCompletionDebugExportData): void {
        this.importEvents(data.events, data.overrides);
    }

    public exportSession(
        recordWhenClosed: boolean,
        extensionVersion: string,
        customPromptLastSavedAt?: number,
        options?: {
            redactPrompts?: boolean;
            maxFileSizeMB?: number;
        },
    ): InlineCompletionDebugExportData {
        return serializeSessionTrace(
            this.getEvents(),
            {
                extensionVersion,
                overrides: this.getOverrides(),
                recordWhenClosed,
                customPromptLastSavedAt,
            },
            options,
        );
    }
}

function normalizeOverrides(
    overrides: Partial<InlineCompletionDebugOverrides>,
): InlineCompletionDebugOverrides {
    return {
        profileId: normalizeNullableProfileId(overrides.profileId),
        modelSelector: normalizeNullableString(overrides.modelSelector),
        continuationModelSelector: normalizeNullableString(overrides.continuationModelSelector),
        useSchemaContext: normalizeNullableBoolean(overrides.useSchemaContext),
        includeSqlDiagnostics: normalizeNullableBoolean(overrides.includeSqlDiagnostics),
        debounceMs: normalizeNullableNumber(overrides.debounceMs),
        maxTokens: normalizeNullableNumber(overrides.maxTokens),
        enabledCategories: normalizeNullableCompletionCategories(overrides.enabledCategories),
        forceIntentMode: normalizeNullableBoolean(overrides.forceIntentMode),
        customSystemPrompt: normalizeNullableString(overrides.customSystemPrompt, true),
        allowAutomaticTriggers: normalizeNullableBoolean(overrides.allowAutomaticTriggers),
        schemaContext: normalizeNullableObject(overrides.schemaContext),
    };
}

function normalizePartialOverrides(
    overrides: Partial<InlineCompletionDebugOverrides>,
): Partial<InlineCompletionDebugOverrides> {
    const normalized: Partial<InlineCompletionDebugOverrides> = {};

    if (Object.prototype.hasOwnProperty.call(overrides, "profileId")) {
        normalized.profileId = normalizeNullableProfileId(overrides.profileId);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "modelSelector")) {
        normalized.modelSelector = normalizeNullableString(overrides.modelSelector);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "continuationModelSelector")) {
        normalized.continuationModelSelector = normalizeNullableString(
            overrides.continuationModelSelector,
        );
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "useSchemaContext")) {
        normalized.useSchemaContext = normalizeNullableBoolean(overrides.useSchemaContext);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "includeSqlDiagnostics")) {
        normalized.includeSqlDiagnostics = normalizeNullableBoolean(
            overrides.includeSqlDiagnostics,
        );
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "debounceMs")) {
        normalized.debounceMs = normalizeNullableNumber(overrides.debounceMs);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "maxTokens")) {
        normalized.maxTokens = normalizeNullableNumber(overrides.maxTokens);
    }
    if (Object.prototype.hasOwnProperty.call(overrides, "enabledCategories")) {
        normalized.enabledCategories = normalizeNullableCompletionCategories(
            overrides.enabledCategories,
        );
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
    if (Object.prototype.hasOwnProperty.call(overrides, "schemaContext")) {
        normalized.schemaContext = normalizeNullableObject(overrides.schemaContext);
    }

    return normalized;
}

function normalizeImportedOverrides(
    overrides: InlineCompletionDebugOverrides | undefined,
): InlineCompletionDebugOverrides | undefined {
    if (!overrides) {
        return undefined;
    }

    if (overrides.modelSelector !== undefined && overrides.modelSelector !== null) {
        return overrides;
    }

    const legacy = (overrides as unknown as { modelFamily?: string | null }).modelFamily;
    if (typeof legacy === "string") {
        return { ...overrides, modelSelector: legacy };
    }

    return overrides;
}

function normalizeNullableProfileId(
    value: InlineCompletionDebugProfileId | string | null | undefined,
): InlineCompletionDebugProfileId | null {
    if (!isInlineCompletionDebugProfileId(value)) {
        return null;
    }

    return value;
}

function normalizeNullableCompletionCategories(
    value: InlineCompletionCategory[] | null | undefined,
): InlineCompletionCategory[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const enabled = new Set<InlineCompletionCategory>();
    for (const category of value) {
        if (inlineCompletionCategories.includes(category)) {
            enabled.add(category);
        }
    }

    return inlineCompletionCategories.filter((category) => enabled.has(category));
}

function normalizeNullableObject(
    value: unknown,
): InlineCompletionDebugSchemaContextOverrides | null {
    if (!isJsonRecord(value)) {
        return null;
    }

    return normalizeJsonRecord(value);
}

export const inlineCompletionDebugStore = new InlineCompletionDebugStore();
export const inlineCompletionDebugDefaultOverrides = defaultOverrides;
