/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { InlineCompletionDebugExportData } from "../../../src/sharedInterfaces/inlineCompletionDebug";

/** Synthetic capture for exercising Sessions and replay setup without a model or database. */
export const completionDebugTrace: InlineCompletionDebugExportData = {
    version: 1,
    exportedAt: 1000,
    _savedAt: new Date(1000).toISOString(),
    _extensionVersion: "test",
    overrides: {
        profileId: "balanced",
        modelSelector: null,
        continuationModelSelector: null,
        useSchemaContext: false,
        includeSqlDiagnostics: false,
        debounceMs: null,
        maxTokens: null,
        enabledCategories: null,
        forceIntentMode: null,
        customSystemPrompt: null,
        allowAutomaticTriggers: null,
        schemaContext: null,
    },
    recordWhenClosed: false,
    events: [
        {
            id: "render-test-event",
            timestamp: 1000,
            documentUri: "untitled:render-test.sql",
            documentFileName: "render-test.sql",
            line: 1,
            column: 1,
            triggerKind: "invoke",
            explicitFromUser: true,
            completionCategory: "intent",
            intentMode: true,
            inferredSystemQuery: false,
            modelFamily: "test-model",
            modelId: "test-model",
            modelVendor: "test",
            result: "success",
            latencyMs: 100,
            inputTokens: 10,
            outputTokens: 5,
            schemaObjectCount: 0,
            schemaSystemObjectCount: 0,
            schemaForeignKeyCount: 0,
            usedSchemaContext: false,
            overridesApplied: { profileId: "balanced", customSystemPromptUsed: false },
            promptMessages: [{ role: "user", content: "-- return the number one" }],
            rawResponse: "SELECT 1;",
            sanitizedResponse: "SELECT 1;",
            finalCompletionText: "SELECT 1;",
            schemaContextFormatted: undefined,
            locals: { "document.languageId": "sql" },
        },
    ],
};
