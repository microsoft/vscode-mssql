/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    computeInlineCompletionMetrics,
    createFacetCounts,
    filterInlineCompletionEvents,
    getAnalysisResult,
    getEventDimension,
    pivotInlineCompletionEvents,
} from "../../src/sharedInterfaces/inlineCompletionAnalysis";
import { InlineCompletionDebugEvent } from "../../src/sharedInterfaces/inlineCompletionDebug";

suite("Inline completion sessions analysis", () => {
    test("maps raw results to analysis result buckets", () => {
        expect(getAnalysisResult("accepted")).to.equal("accepted");
        expect(getAnalysisResult("cancelled")).to.equal("cancelled");
        expect(getAnalysisResult("success")).to.equal("rejected");
        expect(getAnalysisResult("emptyFromSanitizer")).to.equal("rejected");
        expect(getAnalysisResult("skipped")).to.equal("skipped");
        expect(getAnalysisResult("noModel")).to.equal("error");
        expect(getAnalysisResult("something-new")).to.equal("unknown");
    });

    test("filters by model, profile, schema budget, result, trigger, and latency", () => {
        const events = createEvents();

        const filtered = filterInlineCompletionEvents(events, {
            models: ["claude-sonnet-4-6"],
            profiles: ["balanced"],
            schemaModes: ["balanced"],
            results: ["accepted"],
            triggers: ["automatic"],
            latencyRange: { max: 200 },
        });

        expect(filtered.map((event) => event.id)).to.deep.equal(["E-1"]);
    });

    test("computes latency, token, rate, and schema metrics", () => {
        const metrics = computeInlineCompletionMetrics(createEvents());

        expect(metrics.count).to.equal(4);
        expect(metrics.latencyMean).to.equal(375);
        expect(metrics.latencyP95).to.equal(900);
        expect(metrics.inputTokensSum).to.equal(8000);
        expect(metrics.outputTokensSum).to.equal(400);
        expect(metrics.acceptRate).to.equal(0.25);
        expect(metrics.cancelRate).to.equal(0.25);
        expect(metrics.rejectRate).to.equal(0.25);
        expect(metrics.errorRate).to.equal(0.25);
        expect(metrics.meanSchemaObjectCount).to.equal(8);
    });

    test("pivots by one and two dimensions", () => {
        const rows = pivotInlineCompletionEvents(createEvents(), "model", "profile");

        expect(rows).to.have.lengthOf(2);
        expect(rows[0].label).to.equal("claude-sonnet-4-6");
        expect(rows[0].metrics.count).to.equal(3);
        expect(rows[0].children?.map((child) => child.label)).to.deep.equal([
            "balanced",
            "focused",
        ]);
    });

    test("builds facet counts", () => {
        const counts = createFacetCounts(
            [...createEvents(), createEvent({ id: "E-5", result: "skipped" })],
            "result",
        );

        expect(counts).to.deep.include({ value: "accepted", count: 1 });
        expect(counts).to.deep.include({ value: "rejected", count: 1 });
        expect(counts).to.deep.include({ value: "cancelled", count: 1 });
        expect(counts).to.deep.include({ value: "skipped", count: 1 });
        expect(counts).to.deep.include({ value: "error", count: 1 });
    });

    test("falls back to model selectors for skipped events without model metadata", () => {
        const event = createEvent({
            completionCategory: "continuation",
            modelFamily: undefined,
            modelId: undefined,
            modelVendor: undefined,
            result: "skipped",
            overridesApplied: {
                continuationModelSelector: "copilot/claude-haiku-4.5",
                customSystemPromptUsed: false,
            },
        });

        expect(getEventDimension(event, "model")).to.equal("claude-haiku-4.5");
    });

    test("uses schema budget profile for the schema mode dimension", () => {
        const event = createEvent({
            overridesApplied: {
                schemaContext: {
                    budgetProfile: "generous",
                    columnRepresentation: "compact",
                },
                customSystemPromptUsed: false,
            },
            locals: {
                "document.languageId": "sql",
                schemaBudgetProfile: "balanced",
                schemaColumnRepresentation: "verbose",
            },
        });

        expect(getEventDimension(event, "schemaMode")).to.equal("generous");
    });

    test("falls back to recorded schema budget locals", () => {
        const event = createEvent({
            schemaContextFormatted: undefined,
            locals: {
                "document.languageId": "sql",
                schemaBudgetProfile: "tight",
                schemaColumnRepresentation: "verbose",
            },
        });

        expect(getEventDimension(event, "schemaMode")).to.equal("tight");
    });
});

function createEvents(): InlineCompletionDebugEvent[] {
    return [
        createEvent({
            id: "E-1",
            modelId: "claude-sonnet-4-6",
            result: "accepted",
            latencyMs: 100,
            inputTokens: 2000,
            outputTokens: 100,
            schemaObjectCount: 10,
            overridesApplied: {
                profileId: "balanced",
                schemaContext: { budgetProfile: "balanced", columnRepresentation: "compact" },
                customSystemPromptUsed: false,
            },
        }),
        createEvent({
            id: "E-2",
            modelId: "claude-sonnet-4-6",
            result: "success",
            latencyMs: 200,
            inputTokens: 3000,
            outputTokens: 120,
            schemaObjectCount: 12,
            explicitFromUser: true,
            triggerKind: "invoke",
            overridesApplied: {
                profileId: "balanced",
                schemaContext: { budgetProfile: "balanced", columnRepresentation: "compact" },
                customSystemPromptUsed: false,
            },
        }),
        createEvent({
            id: "E-3",
            modelId: "claude-sonnet-4-6",
            result: "cancelled",
            latencyMs: 300,
            inputTokens: 1500,
            outputTokens: 80,
            schemaObjectCount: 4,
            overridesApplied: {
                profileId: "focused",
                schemaContext: { budgetProfile: "tight", columnRepresentation: "types" },
                customSystemPromptUsed: false,
            },
        }),
        createEvent({
            id: "E-4",
            modelId: "gpt-5.5-mini",
            result: "error",
            latencyMs: 900,
            inputTokens: 1500,
            outputTokens: 100,
            schemaObjectCount: 6,
            overridesApplied: {
                profileId: "focused",
                schemaContext: { budgetProfile: "tight", columnRepresentation: "types" },
                customSystemPromptUsed: false,
            },
        }),
    ];
}

function createEvent(overrides: Partial<InlineCompletionDebugEvent>): InlineCompletionDebugEvent {
    return {
        id: "E-0",
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
        modelFamily: "default",
        modelId: "default",
        modelVendor: "copilot",
        result: "accepted",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        schemaObjectCount: 0,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 0,
        usedSchemaContext: true,
        overridesApplied: {
            customSystemPromptUsed: false,
        },
        promptMessages: [],
        rawResponse: "",
        sanitizedResponse: "",
        finalCompletionText: "",
        schemaContextFormatted: "-- schema budget: profile balanced, size small, columns compact",
        locals: {
            "document.languageId": "sql",
            schemaBudgetProfile: "balanced",
            schemaSizeKind: "small",
        },
        ...overrides,
    };
}
