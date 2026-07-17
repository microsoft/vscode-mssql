/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Explicit completion replay modes (final plan WI-3.4 / addendum §7.7):
 * per-mode prompt/schema source matrix (schema service present/absent),
 * blocked-when-required-unavailable, explicit fallback recorded as
 * provenance, the default mapping (legacy entry points ≡ rebuildCurrentSchema
 * + fallback), Appendix D provenance on result events, queue-time mode
 * freeze, axis-mode incompatibility refusal, and durable item records
 * carrying mode + schema-context source + blocked status.
 */

import * as vscode from "vscode";
import { expect } from "chai";
import {
    CAPTURED_SCHEMA_CELL_LABEL,
    CURRENT_SCHEMA_UNAVAILABLE_REASON,
    InlineCompletionReplayService,
    InlineCompletionReplayServiceDeps,
    compactReplayConfig,
} from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionReplayService";
import { configureCompletionsReplayRunPersistence } from "../../src/copilot/inlineCompletionDebug/completionsReplayRunPersistence";
import { inlineCompletionDebugStore } from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import { InlineCompletionCaptureService } from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionCaptureService";
import { CompletionSchemaContextService } from "../../src/copilot/completionSchemaContextService";
import {
    InlineCompletionDocumentContext,
    INLINE_COMPLETION_SANITIZER_VERSION,
    INLINE_COMPLETION_PROMPT_BUILDER_VERSION,
} from "../../src/copilot/sqlInlineCompletionProvider";
import { sha256OfCanonicalJson } from "../../src/diagnostics/featureCapture/configGroups";
import {
    CompletionReplayMode,
    InlineCompletionDebugEvent,
    InlineCompletionDebugReplayConfig,
    resolveCompletionReplayModePolicy,
} from "../../src/sharedInterfaces/inlineCompletionDebug";
import { ReplayRunItemRecordV1 } from "../../src/diagnostics/featureCapture/replayRunRepository";
import { MemJournalFs } from "./support/memJournalFs";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const TEST_STORE_ROOT = "C:/replay-mode-tests";
const TEST_HOST_SESSION = "hs-replay-modes";

interface FakeModelCall {
    messages: vscode.LanguageModelChatMessage[];
}

function createFakeModel(options: { text?: string } = {}): {
    model: vscode.LanguageModelChat;
    calls: FakeModelCall[];
} {
    const calls: FakeModelCall[] = [];
    const model = {
        id: "fake-model",
        name: "Fake Model",
        vendor: "test-vendor",
        family: "fake-family",
        version: "1.0",
        maxInputTokens: 4000,
        countTokens: async () => 10,
        sendRequest: async (messages: vscode.LanguageModelChatMessage[]) => {
            calls.push({ messages });
            return {
                stream: (async function* () {
                    yield new vscode.LanguageModelTextPart(options.text ?? "SELECT 1");
                })(),
                text: (async function* () {
                    yield options.text ?? "SELECT 1";
                })(),
            } as unknown as vscode.LanguageModelChatResponse;
        },
    };
    return { model: model as unknown as vscode.LanguageModelChat, calls };
}

function createFakeSchemaService(behavior: "ok" | "empty" | "throws"): {
    service: CompletionSchemaContextService;
    calls: Array<{ ownerUri: string }>;
} {
    const calls: Array<{ ownerUri: string }> = [];
    const service = {
        getSchemaContextForOwnerUri: async (ownerUri: string) => {
            calls.push({ ownerUri });
            if (behavior === "throws") {
                throw new Error("schema service unavailable");
            }
            if (behavior === "empty") {
                return undefined;
            }
            return {
                server: "fresh-server",
                database: "fresh-db",
                schemas: [],
                tables: [],
                views: [],
                masterSymbols: [],
            };
        },
    };
    return { service: service as unknown as CompletionSchemaContextService, calls };
}

function createHarness(options: {
    schemaService?: "ok" | "empty" | "throws" | "absent";
    model?: "ok" | "absent";
    liveContext?: InlineCompletionDocumentContext;
    modelText?: string;
}) {
    const fakeModel = createFakeModel({
        ...(options.modelText !== undefined ? { text: options.modelText } : {}),
    });
    const schema =
        options.schemaService === "absent" || options.schemaService === undefined
            ? undefined
            : createFakeSchemaService(options.schemaService);
    const deps: InlineCompletionReplayServiceDeps = {
        extensionContext: {
            languageModelAccessInformation: undefined,
            extension: { packageJSON: { version: "0.0.0-test" } },
        } as unknown as vscode.ExtensionContext,
        schemaContextService: schema?.service,
        captureService: { availableModels: [] } as unknown as InlineCompletionCaptureService,
        selectModel: async () => (options.model === "absent" ? undefined : fakeModel.model),
        getLiveDocumentContext: () => options.liveContext,
    };
    const service = new InlineCompletionReplayService(deps);
    return { service, fakeModel, schemaCalls: schema?.calls ?? [] };
}

function sourceEvent(
    overrides: Partial<InlineCompletionDebugEvent> = {},
): InlineCompletionDebugEvent {
    return {
        id: "SRC-1",
        timestamp: 1_000,
        documentUri: "file:///captured.sql",
        documentFileName: "captured.sql",
        line: 4,
        column: 7,
        triggerKind: "invoke",
        explicitFromUser: true,
        completionCategory: "continuation",
        intentMode: false,
        inferredSystemQuery: false,
        modelFamily: "fake-family",
        modelId: "fake-model",
        modelVendor: "test-vendor",
        result: "success",
        latencyMs: 400,
        inputTokens: 100,
        outputTokens: 10,
        schemaObjectCount: 3,
        schemaSystemObjectCount: 1,
        schemaForeignKeyCount: 2,
        usedSchemaContext: true,
        // useSchemaContext rides overridesApplied so captured cart configs
        // resolve it true regardless of the test host's workspace settings.
        overridesApplied: { customSystemPromptUsed: false, useSchemaContext: true },
        promptMessages: [
            { role: "user", content: "captured rules message" },
            { role: "user", content: "captured data message" },
        ],
        rawResponse: "SELECT captured",
        sanitizedResponse: "SELECT captured",
        finalCompletionText: "SELECT captured",
        schemaContextFormatted: "-- captured schema context",
        locals: {
            linePrefix: "SELECT ",
            lineSuffix: "",
            recentPrefix: "",
            statementPrefix: "SELECT ",
            suffix: "",
        },
        ...overrides,
    };
}

function replayConfig(
    mode?: CompletionReplayMode,
    extra: Partial<InlineCompletionDebugReplayConfig> = {},
): InlineCompletionDebugReplayConfig {
    return {
        profileId: null,
        modelSelector: null,
        continuationModelSelector: null,
        useSchemaContext: true,
        includeSqlDiagnostics: false,
        debounceMs: null,
        maxTokens: null,
        enabledCategories: null,
        forceIntentMode: null,
        customSystemPrompt: null,
        allowAutomaticTriggers: null,
        schemaContext: null,
        ...(mode ? { replayMode: mode } : {}),
        ...extra,
    };
}

const liveDocContext: InlineCompletionDocumentContext = {
    documentUri: "file:///live.sql",
    documentFileName: "live.sql",
    languageId: "sql",
    line: 10,
    column: 3,
    linePrefix: "SELECT liv",
    lineSuffix: "",
    statementPrefix: "SELECT liv",
    recentPrefix: "",
    suffix: "",
    inferredSystemQuery: false,
    detectedIntentMode: false,
    sqlDiagnosticsText: "",
};

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitFor timed out");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

// ---------------------------------------------------------------------------

suite("Completion replay modes (WI-3.4)", () => {
    let memFs: MemJournalFs;

    setup(() => {
        inlineCompletionDebugStore.clearEvents();
        memFs = new MemJournalFs();
        configureCompletionsReplayRunPersistence({
            storeRoot: TEST_STORE_ROOT,
            hostSessionId: TEST_HOST_SESSION,
            fs: memFs,
        });
    });

    teardown(() => {
        configureCompletionsReplayRunPersistence(undefined);
        inlineCompletionDebugStore.clearEvents();
    });

    test("frozenPrompt sends the captured messages verbatim and never touches schema", async () => {
        const harness = createHarness({ schemaService: "ok" });
        const recorded = await harness.service.replaySourceEvent(sourceEvent(), {
            overrides: replayConfig("frozenPrompt"),
        });
        harness.service.dispose();

        expect(recorded?.result).to.equal("success");
        // Exact captured messages, no rebuild.
        expect(harness.fakeModel.calls.length).to.equal(1);
        const sent = harness.fakeModel.calls[0].messages.map((message) =>
            message.content
                .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
                .join(""),
        );
        expect(sent).to.deep.equal(["captured rules message", "captured data message"]);
        expect(recorded?.promptMessages).to.deep.equal(sourceEvent().promptMessages);
        // Schema service NEVER consulted; source schema facts preserved.
        expect(harness.schemaCalls.length).to.equal(0);
        expect(recorded?.schemaContextFormatted).to.equal("-- captured schema context");
        expect(recorded?.schemaObjectCount).to.equal(3);
        // Appendix D provenance: no promptBuilderVersion (nothing was built).
        const provenance = recorded?.replayProvenance;
        expect(provenance?.schema).to.equal("mssql.completionsReplayProvenance/1");
        expect(provenance?.mode).to.equal("frozenPrompt");
        expect(provenance?.promptBuilderVersion).to.equal(undefined);
        expect(provenance?.sanitizerVersion).to.equal(INLINE_COMPLETION_SANITIZER_VERSION);
        expect(provenance?.schemaContextSource).to.equal("captured");
        expect(provenance?.sourcePromptDigest).to.be.a("string").and.not.equal("");
        expect(provenance?.model.resolvedId).to.equal("fake-model");
    });

    test("rebuildCapturedContext rebuilds the prompt over captured schema; no retrieval", async () => {
        const harness = createHarness({ schemaService: "ok" });
        const recorded = await harness.service.replaySourceEvent(sourceEvent(), {
            overrides: replayConfig("rebuildCapturedContext"),
        });
        harness.service.dispose();

        expect(recorded?.result).to.equal("success");
        expect(harness.schemaCalls.length).to.equal(0);
        expect(recorded?.schemaContextFormatted).to.equal("-- captured schema context");
        expect(recorded?.replayProvenance?.mode).to.equal("rebuildCapturedContext");
        expect(recorded?.replayProvenance?.schemaContextSource).to.equal("captured");
        expect(recorded?.replayProvenance?.promptBuilderVersion).to.equal(
            INLINE_COMPLETION_PROMPT_BUILDER_VERSION,
        );
        // Rebuilt with the current builder: not the captured messages.
        expect(recorded?.promptMessages).to.not.deep.equal(sourceEvent().promptMessages);
        const sentText = harness.fakeModel.calls[0].messages
            .map((message) =>
                message.content
                    .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
                    .join(""),
            )
            .join("\n");
        expect(sentText).to.contain("-- captured schema context");
    });

    test("rebuildCurrentSchema uses CURRENT schema when the service delivers", async () => {
        const harness = createHarness({ schemaService: "ok" });
        const recorded = await harness.service.replaySourceEvent(sourceEvent(), {
            overrides: replayConfig("rebuildCurrentSchema", { schemaFallbackToCaptured: false }),
        });
        harness.service.dispose();

        expect(recorded?.result).to.equal("success");
        expect(harness.schemaCalls).to.deep.equal([{ ownerUri: "file:///captured.sql" }]);
        expect(recorded?.replayProvenance?.schemaContextSource).to.equal("current");
        expect(recorded?.schemaContextFormatted).to.contain("fresh-server / fresh-db");
    });

    test("rebuildCurrentSchema without current schema and WITHOUT fallback → blocked", async () => {
        for (const behavior of ["absent", "empty", "throws"] as const) {
            inlineCompletionDebugStore.clearEvents();
            const harness = createHarness({ schemaService: behavior });
            const recorded = await harness.service.replaySourceEvent(sourceEvent(), {
                overrides: replayConfig("rebuildCurrentSchema", {
                    schemaFallbackToCaptured: false,
                }),
            });
            harness.service.dispose();

            expect(recorded?.result).to.equal("blocked", `behavior=${behavior}`);
            expect(recorded?.locals.replayBlockedReason).to.equal(
                CURRENT_SCHEMA_UNAVAILABLE_REASON,
            );
            expect(recorded?.replayProvenance?.schemaContextSource).to.equal("unavailable");
            // Nothing executed: the model was never called.
            expect(harness.fakeModel.calls.length).to.equal(0);
        }
    });

    test("rebuildCurrentSchema with explicit fallback records explicitFallback provenance", async () => {
        const harness = createHarness({ schemaService: "empty" });
        const recorded = await harness.service.replaySourceEvent(sourceEvent(), {
            overrides: replayConfig("rebuildCurrentSchema", { schemaFallbackToCaptured: true }),
        });
        harness.service.dispose();

        expect(recorded?.result).to.equal("success");
        expect(recorded?.replayProvenance?.schemaContextSource).to.equal("explicitFallback");
        expect(recorded?.schemaContextFormatted).to.equal("-- captured schema context");
        expect(recorded?.locals.replaySchemaContextSource).to.equal("explicitFallback");
    });

    test("fallback with nothing captured proceeds as unavailable (legacy behavior preserved)", async () => {
        const harness = createHarness({ schemaService: "empty" });
        const recorded = await harness.service.replaySourceEvent(
            sourceEvent({ schemaContextFormatted: undefined }),
            {
                overrides: replayConfig("rebuildCurrentSchema", {
                    schemaFallbackToCaptured: true,
                }),
            },
        );
        harness.service.dispose();

        expect(recorded?.result).to.equal("success");
        expect(recorded?.replayProvenance?.schemaContextSource).to.equal("unavailable");
        expect(recorded?.usedSchemaContext).to.equal(false);
    });

    test("default mapping: a config with NO mode behaves as rebuildCurrentSchema + fallback", async () => {
        // With a working service → current schema (the legacy refresh path).
        const withService = createHarness({ schemaService: "ok" });
        const fresh = await withService.service.replaySourceEvent(sourceEvent(), {
            overrides: replayConfig(undefined),
        });
        withService.service.dispose();
        expect(fresh?.replayProvenance?.mode).to.equal("rebuildCurrentSchema");
        expect(fresh?.replayProvenance?.schemaContextSource).to.equal("current");

        // Without one → captured text via the now-EXPLICIT fallback policy.
        const withoutService = createHarness({ schemaService: "absent" });
        const fallback = await withoutService.service.replaySourceEvent(sourceEvent(), {
            overrides: replayConfig(undefined),
        });
        withoutService.service.dispose();
        expect(fallback?.result).to.equal("success");
        expect(fallback?.replayProvenance?.mode).to.equal("rebuildCurrentSchema");
        expect(fallback?.replayProvenance?.schemaContextSource).to.equal("explicitFallback");

        // The policy resolver is the single source of the mapping.
        expect(resolveCompletionReplayModePolicy({})).to.deep.equal({
            mode: "rebuildCurrentSchema",
            fallbackToCaptured: true,
        });
    });

    test("liveDocumentScenario rebuilds against the ACTIVE document; blocked without one", async () => {
        const withDoc = createHarness({ schemaService: "ok", liveContext: liveDocContext });
        const recorded = await withDoc.service.replaySourceEvent(sourceEvent(), {
            overrides: replayConfig("liveDocumentScenario"),
        });
        withDoc.service.dispose();
        expect(recorded?.result).to.equal("success");
        expect(recorded?.documentUri).to.equal("file:///live.sql");
        expect(recorded?.documentFileName).to.equal("live.sql");
        expect(recorded?.line).to.equal(10);
        // Current schema fetched for the LIVE document, not the captured one.
        expect(withDoc.schemaCalls).to.deep.equal([{ ownerUri: "file:///live.sql" }]);
        expect(recorded?.replayProvenance?.mode).to.equal("liveDocumentScenario");
        expect(recorded?.replayProvenance?.schemaContextSource).to.equal("current");

        const withoutDoc = createHarness({ schemaService: "ok", liveContext: undefined });
        const blocked = await withoutDoc.service.replaySourceEvent(sourceEvent(), {
            overrides: replayConfig("liveDocumentScenario"),
        });
        withoutDoc.service.dispose();
        expect(blocked?.result).to.equal("blocked");
        expect(withoutDoc.fakeModel.calls.length).to.equal(0);
    });

    test("provenance effectiveConfigDigest equals the frozen compact-config digest", async () => {
        const harness = createHarness({ schemaService: "ok" });
        const config = replayConfig("rebuildCapturedContext");
        const recorded = await harness.service.replaySourceEvent(sourceEvent(), {
            overrides: config,
        });
        harness.service.dispose();
        expect(recorded?.replayProvenance?.effectiveConfigDigest).to.equal(
            sha256OfCanonicalJson(compactReplayConfig(config)),
        );
    });

    test("mode + fallback freeze at queue time and ride the row config digest input", async () => {
        const harness = createHarness({ schemaService: "ok" });
        harness.service.addEventsToCart([{ event: sourceEvent() }]);
        harness.service.queueCart(undefined, {
            replayMode: "frozenPrompt",
        });
        await waitFor(() => harness.service.getState().runs[0]?.status === "completed");
        const state = harness.service.getState();
        expect(state.runs.length).to.equal(1);

        // The frozen config carried the mode explicitly (visible on the
        // recorded event's provenance — the run already drained).
        const results = inlineCompletionDebugStore
            .getEvents()
            .filter((event) => event.replayProvenance !== undefined);
        expect(results.length).to.equal(1);
        expect(results[0].replayProvenance?.mode).to.equal("frozenPrompt");

        // Re-queueing the SAME cart without a mode gets the default mapping —
        // the first run's frozen rows were not affected (frozen-at-queue).
        harness.service.queueCart();
        await waitFor(() => harness.service.getState().runs[1]?.status === "completed");
        const modes = inlineCompletionDebugStore
            .getEvents()
            .filter((event) => event.replayProvenance !== undefined)
            .map((event) => event.replayProvenance?.mode);
        expect(modes).to.deep.equal(["frozenPrompt", "rebuildCurrentSchema"]);
        harness.service.dispose();
    });

    test("matrix under frozenPrompt is refused honestly at queue time (axis-mode data)", async () => {
        const harness = createHarness({ schemaService: "ok" });
        harness.service.addEventsToCart([{ event: sourceEvent() }]);
        harness.service.runMatrix(["focused", "balanced"], ["tight"], {
            replayMode: "frozenPrompt",
        });
        await waitFor(() => harness.service.getState().runs[0]?.status === "failed");
        const run = harness.service.getState().runs[0];
        expect(run.errorMessage).to.contain("frozenPrompt");
        // Nothing executed.
        expect(harness.fakeModel.calls.length).to.equal(0);
        harness.service.dispose();
    });

    test("matrix under rebuildCapturedContext pins the schema axis to captured cells", async () => {
        const harness = createHarness({ schemaService: "ok" });
        harness.service.addEventsToCart([{ event: sourceEvent() }]);
        harness.service.runMatrix(["focused", "balanced"], [], {
            replayMode: "rebuildCapturedContext",
        });
        await waitFor(() => harness.service.getState().runs[0]?.status === "completed");
        const run = harness.service.getState().runs[0];
        expect(run.matrixCells?.length).to.equal(2);
        for (const cell of run.matrixCells ?? []) {
            expect(cell.schemaLabel).to.equal(CAPTURED_SCHEMA_CELL_LABEL);
        }
        // Captured schema replayed — the schema service was never consulted.
        expect(harness.schemaCalls.length).to.equal(0);
        expect(harness.fakeModel.calls.length).to.equal(2);
        harness.service.dispose();
    });

    test("durable item records carry replayMode, schemaContextSource, and blocked status", async () => {
        // No schema service, no captured schema, strict mode → blocked items.
        const harness = createHarness({ schemaService: "absent" });
        harness.service.addEventsToCart([
            { event: sourceEvent({ schemaContextFormatted: undefined }) },
        ]);
        harness.service.queueCart(undefined, {
            replayMode: "rebuildCurrentSchema",
            schemaFallbackToCaptured: false,
        });
        await waitFor(() => {
            const run = harness.service.getState().runs[0];
            return run !== undefined && run.status === "completed";
        });
        const run = harness.service.getState().runs[0];
        expect(run.blockedEvents).to.equal(1);

        // items.jsonl landed with the WI-3.4 dimensions.
        await waitFor(() => [...memFs.files.keys()].some((path) => path.endsWith("items.jsonl")));
        const itemsPath = [...memFs.files.keys()].find((path) => path.endsWith("items.jsonl"))!;
        const records = memFs.files
            .get(itemsPath)!
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line) as ReplayRunItemRecordV1);
        expect(records.length).to.equal(1);
        expect(records[0].status).to.equal("blocked");
        expect(records[0].replayMode).to.equal("rebuildCurrentSchema");
        expect(records[0].schemaContextSource).to.equal("unavailable");
        expect(records[0].errorMessage).to.equal(CURRENT_SCHEMA_UNAVAILABLE_REASON);
        harness.service.dispose();
    });

    test("successful durable item records link the result and carry the mode dimensions", async () => {
        const harness = createHarness({ schemaService: "ok" });
        harness.service.addEventsToCart([{ event: sourceEvent() }]);
        harness.service.queueCart(undefined, { replayMode: "rebuildCapturedContext" });
        await waitFor(() => harness.service.getState().runs[0]?.status === "completed");
        await waitFor(() => [...memFs.files.keys()].some((path) => path.endsWith("items.jsonl")));
        const itemsPath = [...memFs.files.keys()].find((path) => path.endsWith("items.jsonl"))!;
        const records = memFs.files
            .get(itemsPath)!
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line) as ReplayRunItemRecordV1);
        expect(records.length).to.equal(1);
        expect(records[0].status).to.equal("completed");
        expect(records[0].replayMode).to.equal("rebuildCapturedContext");
        expect(records[0].schemaContextSource).to.equal("captured");
        expect(records[0].resultCaptureEventId).to.be.a("string").and.not.equal("");
        harness.service.dispose();
    });
});
