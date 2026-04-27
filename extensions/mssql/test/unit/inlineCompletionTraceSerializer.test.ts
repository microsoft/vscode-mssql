/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { serializeSessionTrace } from "../../src/copilot/inlineCompletionDebug/traceSerializer";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugOverrides,
} from "../../src/sharedInterfaces/inlineCompletionDebug";

suite("Inline completion trace serializer", () => {
    test("keeps prompt and response text when redaction is off", () => {
        const trace = serializeSessionTrace([createEvent()], createMetadata(), {
            redactPrompts: false,
        });

        expect(trace._savedAt).to.equal("2026-04-01T00:00:00.000Z");
        expect(trace._extensionVersion).to.equal("1.43.0-test");
        expect(trace.events[0].promptMessages[0].content).to.equal("system prompt");
        expect(trace.events[0].rawResponse).to.equal("raw sql");
        expect(trace.events[0].schemaContextFormatted).to.equal("schema text");
    });

    test("redacts prompt, schema, and response fields", () => {
        const trace = serializeSessionTrace([createEvent()], createMetadata(), {
            redactPrompts: true,
        });

        expect(trace.overrides.customSystemPrompt).to.equal("[REDACTED]");
        expect(trace.events[0].promptMessages[0].content).to.equal("[REDACTED]");
        expect(trace.events[0].rawResponse).to.equal("[REDACTED]");
        expect(trace.events[0].sanitizedResponse).to.equal("[REDACTED]");
        expect(trace.events[0].finalCompletionText).to.equal("[REDACTED]");
        expect(trace.events[0].schemaContextFormatted).to.equal("[REDACTED]");
        expect(trace.events[0].inputTokens).to.equal(1200);
        expect(trace.events[0].latencyMs).to.equal(250);
    });

    test("handles missing optional fields", () => {
        const event = createEvent({
            inputTokens: undefined,
            outputTokens: undefined,
            sanitizedResponse: undefined,
            finalCompletionText: undefined,
            schemaContextFormatted: undefined,
        });

        const trace = serializeSessionTrace([event], createMetadata(), { redactPrompts: true });

        expect(trace.events[0].inputTokens).to.equal(undefined);
        expect(trace.events[0].sanitizedResponse).to.equal(undefined);
        expect(trace.events[0].schemaContextFormatted).to.equal(undefined);
    });

    test("drops oldest events and marks trace truncated when max size is exceeded", () => {
        const events = [
            createEvent({ id: "E-1", schemaContextFormatted: "x".repeat(4096) }),
            createEvent({ id: "E-2", schemaContextFormatted: "y".repeat(256) }),
        ];

        const trace = serializeSessionTrace(events, createMetadata(), { maxFileSizeMB: 0.004 });

        expect(trace._truncated).to.equal(true);
        expect(trace.events.map((event) => event.id)).to.deep.equal(["E-2"]);
    });
});

function createMetadata() {
    return {
        exportedAt: 1775000000000,
        savedAt: "2026-04-01T00:00:00.000Z",
        extensionVersion: "1.43.0-test",
        overrides: {
            profileId: "balanced",
            modelSelector: null,
            continuationModelSelector: null,
            useSchemaContext: true,
            debounceMs: null,
            maxTokens: null,
            enabledCategories: null,
            forceIntentMode: null,
            customSystemPrompt: "custom system prompt",
            allowAutomaticTriggers: null,
            schemaContext: null,
        } satisfies InlineCompletionDebugOverrides,
        recordWhenClosed: true,
    };
}

function createEvent(
    overrides: Partial<InlineCompletionDebugEvent> = {},
): InlineCompletionDebugEvent {
    return {
        id: "E-1",
        timestamp: 1775000000000,
        documentUri: "file:///query.sql",
        documentFileName: "query.sql",
        line: 1,
        column: 1,
        triggerKind: "automatic",
        explicitFromUser: false,
        completionCategory: "intent",
        intentMode: true,
        inferredSystemQuery: false,
        modelFamily: "claude-sonnet-4-6",
        modelId: "claude-sonnet-4-6",
        modelVendor: "anthropic-api",
        result: "accepted",
        latencyMs: 250,
        inputTokens: 1200,
        outputTokens: 80,
        schemaObjectCount: 4,
        schemaSystemObjectCount: 1,
        schemaForeignKeyCount: 0,
        usedSchemaContext: true,
        overridesApplied: {
            profileId: "balanced",
            customSystemPromptUsed: true,
        },
        promptMessages: [{ role: "user", content: "system prompt" }],
        rawResponse: "raw sql",
        sanitizedResponse: "sanitized sql",
        finalCompletionText: "final sql",
        schemaContextFormatted: "schema text",
        locals: {
            "document.languageId": "sql",
        },
        ...overrides,
    };
}
