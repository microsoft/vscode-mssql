/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * WI-1.2/WI-1.3 (typed, versioned RPC + thin rows/lazy detail): privacy
 * canaries prove prompt/response/schema/locals content never rides a
 * live-rows response or a summary detail slice; cursor paging honors the
 * default/hard-cap limits; revisions are monotonic with accumulated changed
 * domains on the throttled notification; malformed typed commands are
 * rejected before any service runs; and detail lookups resolve by ring id,
 * captureEventId, and loaded-trace fileKey.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
    ConsoleCompletionsDebugHost,
    projectIcDebugStateResult,
    resolveCompletionsDebugLaunchTarget,
} from "../../src/diagnostics/completionsDebugConsoleHost";
import {
    buildCompletionLiveRowsResult,
    resolveCompletionEventDetail,
} from "../../src/diagnostics/completionsDebugRpcHost";
import {
    inlineCompletionDebugDefaultOverrides,
    inlineCompletionDebugStore,
} from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import {
    createInlineCompletionDebugServices,
    InlineCompletionDebugServiceSet,
} from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionDebugCommandHandler";
import { InlineCompletionDebugHostServices } from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionDebugHostServices";
import {
    clampLiveRowsLimit,
    COMPLETION_LIVE_ROWS_DEFAULT_LIMIT,
    COMPLETION_LIVE_ROWS_MAX_LIMIT,
    DcIcDebugChanged2Params,
    DcIcDebugCommandParams,
    IC_DEBUG_PROTOCOL_VERSION,
    validateIcDebugCommand,
} from "../../src/sharedInterfaces/completionsDebugRpc";
import { InlineCompletionDebugEvent } from "../../src/sharedInterfaces/inlineCompletionDebug";

const SENTINELS = {
    systemPrompt: "CANARY_SYSTEM_PROMPT_77aa",
    userPrompt: "CANARY_USER_PROMPT_1f9e",
    rawResponse: "CANARY_RAW_RESPONSE_2b8c",
    sanitizedResponse: "CANARY_SANITIZED_3c7d",
    finalCompletion: "CANARY_FINAL_4d6e",
    schemaContext: "CANARY_SCHEMA_CONTEXT_5e5f",
    locals: "CANARY_LOCALS_6f4a",
    errorMessage: "CANARY_ERROR_MESSAGE_7a3b",
    errorStack: "CANARY_ERROR_STACK_8c2d",
    documentPath: "CANARY_DOCUMENT_PATH_9d1e",
} as const;

function createTestEvent(
    overrides: Partial<Omit<InlineCompletionDebugEvent, "id">> = {},
): Omit<InlineCompletionDebugEvent, "id"> {
    return {
        timestamp: Date.now(),
        documentUri: "file:///test.sql",
        documentFileName: "test.sql",
        line: 4,
        column: 12,
        triggerKind: "invoke",
        explicitFromUser: true,
        completionCategory: "continuation",
        intentMode: false,
        inferredSystemQuery: false,
        modelFamily: "test-family",
        modelId: "test-model",
        modelVendor: "test-vendor",
        result: "success",
        latencyMs: 12,
        inputTokens: 10,
        outputTokens: 5,
        schemaObjectCount: 0,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 0,
        usedSchemaContext: false,
        overridesApplied: { customSystemPromptUsed: false },
        promptMessages: [
            { role: "user", content: "system rules" },
            { role: "user", content: "SELECT * FROM" },
        ],
        rawResponse: "raw response text",
        sanitizedResponse: "sanitized response text",
        finalCompletionText: "final completion text",
        schemaContextFormatted: undefined,
        locals: {},
        ...overrides,
    };
}

function createSentinelEvent(): Omit<InlineCompletionDebugEvent, "id"> {
    return createTestEvent({
        documentUri: `file:///c/${SENTINELS.documentPath}/query.sql`,
        documentFileName: "query.sql",
        promptMessages: [
            { role: "user", content: SENTINELS.systemPrompt },
            { role: "user", content: SENTINELS.userPrompt },
        ],
        rawResponse: SENTINELS.rawResponse,
        sanitizedResponse: SENTINELS.sanitizedResponse,
        finalCompletionText: SENTINELS.finalCompletion,
        schemaContextFormatted: SENTINELS.schemaContext,
        locals: { "debug.note": SENTINELS.locals },
        error: { message: SENTINELS.errorMessage, stack: SENTINELS.errorStack },
    });
}

interface FakeHostRecord {
    infoMessages: string[];
    openDialogUris: vscode.Uri[] | undefined;
}

function createFakeHostServices(record: FakeHostRecord): InlineCompletionDebugHostServices {
    return {
        showSaveDialog: async () => undefined,
        showOpenDialog: async () => record.openDialogUris,
        showInformationMessage: async (message) => {
            record.infoMessages.push(message);
            return undefined;
        },
        showWarningMessage: async () => undefined,
        writeClipboardText: async () => undefined,
        updateConfiguration: async () => undefined,
        readFile: async () => new Uint8Array(),
        writeFile: async () => undefined,
    };
}

function createFakeMemento() {
    const values = new Map<string, unknown>();
    return {
        keys: () => Array.from(values.keys()),
        get: <T>(key: string, defaultValue?: T): T | undefined =>
            values.has(key) ? (values.get(key) as T) : defaultValue,
        update: async (key: string, value: unknown) => {
            if (value === undefined) {
                values.delete(key);
            } else {
                values.set(key, value);
            }
        },
        setKeysForSync: () => undefined,
    };
}

function createFakeExtensionContext() {
    return {
        workspaceState: createFakeMemento(),
        globalState: createFakeMemento(),
        globalStorageUri: vscode.Uri.file(path.join(os.tmpdir(), "mssql-completions-rpc-test")),
        extension: { packageJSON: { version: "0.0.0-test" } },
        languageModelAccessInformation: undefined,
    } as unknown as vscode.ExtensionContext;
}

function resetSingletonStore(): void {
    inlineCompletionDebugStore.clearEvents();
    inlineCompletionDebugStore.updateOverrides({ ...inlineCompletionDebugDefaultOverrides });
}

function liveRows(params?: { cursor?: string; limit?: number }) {
    return buildCompletionLiveRowsResult({
        events: inlineCompletionDebugStore.getEvents(),
        availableModels: [],
        params,
        revision: 7,
        droppedFromRing: inlineCompletionDebugStore.evictedEventCount > 0,
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

suite("completions debug rpc: privacy canary (WI-1.3)", () => {
    setup(resetSingletonStore);
    teardown(resetSingletonStore);

    test("live rows response never carries content sentinels", () => {
        inlineCompletionDebugStore.addEvent(createSentinelEvent());
        const response = liveRows();
        expect(response.rows).to.have.length(1);

        const json = JSON.stringify(response);
        for (const [name, sentinel] of Object.entries(SENTINELS)) {
            expect(json, `live rows leaked ${name}`).to.not.include(sentinel);
        }

        // The row still carries the honest safe metadata subset.
        const row = response.rows[0];
        expect(row.documentFileName).to.equal("query.sql");
        expect(row.error).to.equal(true);
        expect(row.detailAvailable).to.deep.equal({
            prompt: true,
            response: true,
            schema: true,
            locals: true,
            error: true,
        });
    });

    test("summary detail slice is content-free; content sections carry exactly their slice", async () => {
        const event = inlineCompletionDebugStore.addEvent(createSentinelEvent());

        const summary = await resolveCompletionEventDetail(
            { source: { kind: "live" }, eventId: event.id, sections: ["summary", "telemetry"] },
            { revision: 1, availableModels: [] },
        );
        expect(summary.found).to.equal(true);
        const summaryJson = JSON.stringify(summary);
        for (const [name, sentinel] of Object.entries(SENTINELS)) {
            expect(summaryJson, `summary leaked ${name}`).to.not.include(sentinel);
        }

        const detail = await resolveCompletionEventDetail(
            {
                source: { kind: "live" },
                eventId: event.id,
                sections: [
                    "prompt",
                    "rawResponse",
                    "sanitizedResponse",
                    "schemaContext",
                    "locals",
                    "error",
                ],
            },
            { revision: 1, availableModels: [] },
        );
        expect(detail.found).to.equal(true);
        expect(JSON.stringify(detail.sections.prompt)).to.include(SENTINELS.systemPrompt);
        expect(JSON.stringify(detail.sections.prompt)).to.include(SENTINELS.userPrompt);
        expect(detail.sections.rawResponse).to.equal(SENTINELS.rawResponse);
        expect(JSON.stringify(detail.sections.sanitizedResponse)).to.include(
            SENTINELS.sanitizedResponse,
        );
        expect(JSON.stringify(detail.sections.sanitizedResponse)).to.include(
            SENTINELS.finalCompletion,
        );
        expect(detail.sections.schemaContext).to.equal(SENTINELS.schemaContext);
        expect(JSON.stringify(detail.sections.locals)).to.include(SENTINELS.locals);
        expect(JSON.stringify(detail.sections.error)).to.include(SENTINELS.errorMessage);
        // Sections that were not requested are absent — lazy means lazy.
        expect(detail.sections).to.not.have.property("summary");
    });
});

suite("completions debug rpc: live-row paging (WI-1.3)", () => {
    setup(resetSingletonStore);
    teardown(resetSingletonStore);

    test("limit clamps to the default and the hard cap", () => {
        expect(clampLiveRowsLimit(undefined)).to.equal(COMPLETION_LIVE_ROWS_DEFAULT_LIMIT);
        expect(clampLiveRowsLimit(50)).to.equal(50);
        expect(clampLiveRowsLimit(5000)).to.equal(COMPLETION_LIVE_ROWS_MAX_LIMIT);
        expect(clampLiveRowsLimit(0)).to.equal(1);
        expect(clampLiveRowsLimit(-3)).to.equal(1);
        expect(clampLiveRowsLimit(Number.NaN)).to.equal(COMPLETION_LIVE_ROWS_DEFAULT_LIMIT);
    });

    test("500 events: default page is the 200 newest and the cursor walks back", () => {
        const ids: string[] = [];
        for (let index = 0; index < 500; index++) {
            ids.push(inlineCompletionDebugStore.addEvent(createTestEvent({ timestamp: index })).id);
        }

        const page1 = liveRows();
        expect(page1.rows).to.have.length(200);
        expect(page1.totalCount).to.equal(500);
        expect(page1.droppedFromRing).to.equal(false);
        expect(page1.rows[0].eventId).to.equal(ids[499]);
        expect(page1.rows[199].eventId).to.equal(ids[300]);
        expect(page1.nextCursor).to.equal(ids[300]);

        const page2 = liveRows({ cursor: page1.nextCursor });
        expect(page2.rows).to.have.length(200);
        expect(page2.rows[0].eventId).to.equal(ids[299]);
        expect(page2.totalCount).to.equal(500);
        expect(page2.nextCursor).to.equal(ids[100]);

        const page3 = liveRows({ cursor: page2.nextCursor });
        expect(page3.rows).to.have.length(100);
        expect(page3.rows[99].eventId).to.equal(ids[0]);
        expect(page3.nextCursor).to.equal(undefined);

        const seen = new Set([...page1.rows, ...page2.rows, ...page3.rows].map((r) => r.eventId));
        expect(seen.size).to.equal(500);

        // Hard cap: an oversized request cannot exceed 1000 (here: the ring).
        const capped = liveRows({ limit: 5000 });
        expect(capped.rows).to.have.length(500);
        expect(capped.nextCursor).to.equal(undefined);
    });

    test("ring eviction is reported honestly and evicted cursors resolve by ordinal", () => {
        // Ring capacity is 500 — the 501st add evicts the oldest event.
        let oldestId = "";
        for (let index = 0; index < 501; index++) {
            const added = inlineCompletionDebugStore.addEvent(createTestEvent());
            if (index === 0) {
                oldestId = added.id;
            }
        }
        expect(inlineCompletionDebugStore.evictedEventCount).to.equal(1);

        const page = liveRows({ limit: 10 });
        expect(page.droppedFromRing).to.equal(true);
        expect(page.totalCount).to.equal(500);

        // A cursor pointing at the evicted oldest event yields an honest
        // empty page (nothing older remains) instead of restarting at newest.
        const past = liveRows({ cursor: oldestId });
        expect(past.rows).to.have.length(0);
        expect(past.nextCursor).to.equal(undefined);
    });
});

suite("completions debug rpc: revision + typed commands (WI-1.2)", () => {
    let record: FakeHostRecord;
    let host: ConsoleCompletionsDebugHost;

    setup(async () => {
        resetSingletonStore();
        record = { infoMessages: [], openDialogUris: undefined };
        host = new ConsoleCompletionsDebugHost({
            extensionContext: createFakeExtensionContext(),
            hostServices: createFakeHostServices(record),
        });
        // Let construction-time async work (model catalog refresh) settle so
        // its config change does not bleed into the assertions below.
        await sleep(400);
    });

    teardown(() => {
        host.dispose();
        resetSingletonStore();
    });

    test("capabilities: protocol version + the FULL command surface (WI-1.4/1.5)", () => {
        const capabilities = host.getCapabilities();
        expect(capabilities.protocolVersion).to.equal(IC_DEBUG_PROTOCOL_VERSION);
        expect(capabilities.featureGateOn).to.equal(true);
        expect(capabilities.enabledCommands).to.include("clearEvents");
        expect(capabilities.enabledCommands).to.include("updateOverrides");
        // Sessions/replay commands are enabled — the allowlist is gone.
        expect(capabilities.enabledCommands).to.include("queueReplayCart");
        expect(capabilities.enabledCommands).to.include("sessionsRefresh");
        expect(capabilities.enabledCommands).to.include("runReplayMatrix");
        expect(capabilities.enabledCommands).to.include("addEventsToReplayCart");
    });

    test("revision is monotonic and changed domains accumulate through one throttled flush", async () => {
        const notifications: DcIcDebugChanged2Params[] = [];
        const legacyPokes: number[] = [];
        host.onDidChange2((payload) => notifications.push(payload));
        host.onDidChange(() => legacyPokes.push(Date.now()));

        const before = host.revision;
        // Same tick: two live-ring changes and an overrides change — one
        // coalesced notification tagging both store domains.
        inlineCompletionDebugStore.addEvent(createTestEvent());
        inlineCompletionDebugStore.addEvent(createTestEvent());
        inlineCompletionDebugStore.updateOverrides({ debounceMs: 400 });
        expect(host.revision).to.equal(before + 3);

        await sleep(100);
        expect(notifications).to.have.length(1);
        expect(notifications[0].revision).to.equal(host.revision);
        expect(notifications[0].changed).to.deep.equal(["live", "config"]);
        expect(legacyPokes, "legacy dc/icDebugChanged must keep firing").to.have.length(1);

        // A later change flushes separately with a strictly higher revision.
        inlineCompletionDebugStore.addEvent(createTestEvent());
        await sleep(400);
        expect(notifications).to.have.length(2);
        expect(notifications[1].revision).to.be.greaterThan(notifications[0].revision);
        expect(notifications[1].changed).to.deep.equal(["live", "config"]);

        // Live-rows responses are stamped with the current revision.
        expect(host.getLiveRows(undefined).revision).to.equal(host.revision);
    });

    test("unknown command names are rejected", async () => {
        const result = await host.dispatchCommand({
            command: { name: "definitelyNotACommand", payload: {} },
        } as unknown as DcIcDebugCommandParams);
        expect(result.validation?.ok).to.equal(false);
        expect(result.validation?.message).to.include("unknown command name");
    });

    test("malformed payloads are rejected before reaching any service", async () => {
        const selectProfile = await host.dispatchCommand({
            command: { name: "selectProfile", payload: { profileId: 42 } },
        } as unknown as DcIcDebugCommandParams);
        expect(selectProfile.validation?.ok).to.equal(false);
        expect(selectProfile.validation?.message).to.include("profileId");
        // The command never reached the shared handler: overrides untouched.
        expect(inlineCompletionDebugStore.getOverrides().profileId).to.equal(null);

        const queueReplayCart = await host.dispatchCommand({
            command: { name: "queueReplayCart", payload: { configMode: "bogus" } },
        } as unknown as DcIcDebugCommandParams);
        expect(queueReplayCart.validation?.ok).to.equal(false);
        expect(queueReplayCart.validation?.message).to.include("configMode");

        const badOverrides = validateIcDebugCommand({
            name: "updateOverrides",
            payload: { overrides: { enabledCategories: ["bogus"] } },
        });
        expect(badOverrides.ok).to.equal(false);
    });

    test("well-formed commands dispatch through the shared handler", async () => {
        const result = await host.dispatchCommand({
            command: { name: "selectProfile", payload: { profileId: "focused" } },
        });
        expect(result.validation?.ok).to.equal(true);
        expect(result.revision).to.equal(host.revision);
        expect(inlineCompletionDebugStore.getOverrides().profileId).to.equal("focused");
    });

    test("formerly stubbed sessions/replay commands now dispatch (allowlist removed)", async () => {
        const openBuilder = await host.dispatchCommand({
            command: { name: "openReplayBuilder", payload: {} },
        });
        expect(openBuilder.validation?.ok).to.equal(true);
        expect(host.getState().replay.builderOpen).to.equal(true);

        const event = inlineCompletionDebugStore.addEvent(createSentinelEvent());
        const addToCart = await host.dispatchCommand({
            command: {
                name: "addEventsToReplayCart",
                payload: { items: [{ liveEventId: event.id }] },
            },
        });
        expect(addToCart.validation?.ok).to.equal(true);
        expect(host.getState().replay.cart).to.have.length(1);

        const queue = await host.dispatchCommand({
            command: { name: "clearReplayCart", payload: {} },
        });
        expect(queue.validation?.ok).to.equal(true);
        expect(host.getState().replay.cart).to.deep.equal([]);
    });

    test("addEventsToReplayCart validates the event/liveEventId union", () => {
        expect(
            validateIcDebugCommand({
                name: "addEventsToReplayCart",
                payload: { items: [{ liveEventId: "E-1" }] },
            }).ok,
        ).to.equal(true);
        expect(
            validateIcDebugCommand({
                name: "addEventsToReplayCart",
                payload: { items: [{ event: { id: "E-1", timestamp: 1 } }] },
            }).ok,
        ).to.equal(true);
        expect(
            validateIcDebugCommand({
                name: "addEventsToReplayCart",
                payload: { items: [{}] },
            }).ok,
        ).to.equal(false);
        expect(
            validateIcDebugCommand({
                name: "addEventsToReplayCart",
                payload: {
                    items: [{ liveEventId: "E-1", event: { id: "E-1", timestamp: 1 } }],
                },
            }).ok,
        ).to.equal(false);
    });
});

suite("completions debug rpc: omitEvents state projection (WI-1.4)", () => {
    setup(resetSingletonStore);
    teardown(resetSingletonStore);

    function stateWithEvents() {
        inlineCompletionDebugStore.addEvent(createSentinelEvent());
        return {
            events: inlineCompletionDebugStore.getEvents(),
            liveEvictedCount: 0,
            overrides: { ...inlineCompletionDebugDefaultOverrides },
            defaults: {
                useSchemaContext: false,
                includeSqlDiagnostics: true,
                debounceMs: 0,
                continuationMaxTokens: 0,
                intentMaxTokens: 0,
                enabledCategories: [],
                allowAutomaticTriggers: true,
                schemaContext: null,
            },
            profiles: [],
            availableModels: [],
            recordWhenClosed: false,
            customPrompt: { dialogOpen: false, savedValue: null, defaultValue: "" },
            sessions: {
                traceFolder: "c:/traces",
                traceCaptureEnabled: true,
                traceIndex: [],
                loadedTraces: [],
                loading: false,
            },
            replay: { cart: [], runs: [], queueRows: [], builderOpen: true },
        };
    }

    test("omitEvents strips live event bodies and nothing else", () => {
        const state = stateWithEvents();
        const projected = projectIcDebugStateResult(state, { omitEvents: true });
        expect(projected.events).to.deep.equal([]);
        expect(projected.sessions.traceFolder).to.equal("c:/traces");
        expect(projected.replay.builderOpen).to.equal(true);

        const json = JSON.stringify(projected);
        for (const [name, sentinel] of Object.entries(SENTINELS)) {
            expect(json, `omitEvents leaked ${name}`).to.not.include(sentinel);
        }
        // The source state is not mutated.
        expect(state.events).to.have.length(1);
    });

    test("legacy callers (no params / no omitEvents) get the unmodified state", () => {
        const state = stateWithEvents();
        expect(projectIcDebugStateResult(state, undefined)).to.equal(state);
        expect(projectIcDebugStateResult(state, {})).to.equal(state);
        expect(projectIcDebugStateResult(state, { omitEvents: false })).to.equal(state);
    });
});

suite("completions debug deep link routing (WI-1.6)", () => {
    test("flag off routes to the Debug Console Completions page regardless of gate", () => {
        expect(
            resolveCompletionsDebugLaunchTarget({
                standalonePanelFlag: false,
                featureEnabled: true,
            }),
        ).to.deep.equal({ kind: "console", page: "completions" });
        expect(
            resolveCompletionsDebugLaunchTarget({
                standalonePanelFlag: false,
                featureEnabled: false,
            }),
        ).to.deep.equal({ kind: "console", page: "completions" });
    });

    test("flag on keeps the legacy standalone behavior (gated)", () => {
        expect(
            resolveCompletionsDebugLaunchTarget({
                standalonePanelFlag: true,
                featureEnabled: true,
            }),
        ).to.deep.equal({ kind: "standalonePanel" });
        expect(
            resolveCompletionsDebugLaunchTarget({
                standalonePanelFlag: true,
                featureEnabled: false,
            }),
        ).to.deep.equal({ kind: "none" });
    });
});

suite("completions debug rpc: detail lookup (WI-1.3)", () => {
    let tempDir: string;

    setup(() => {
        resetSingletonStore();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-completions-rpc-"));
    });

    teardown(() => {
        resetSingletonStore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test("live events resolve by ring id and by captureEventId", async () => {
        const link = {
            schema: "mssql.observabilityLink/1" as const,
            featureId: "completions",
            hostSessionId: "host-1",
            captureSessionId: "capture-session-1",
            captureEventId: "capture-event-42",
        };
        const event = inlineCompletionDebugStore.addEvent(createTestEvent({ link }));

        const byRingId = await resolveCompletionEventDetail(
            { source: { kind: "live" }, eventId: event.id, sections: ["prompt"] },
            { revision: 5, availableModels: [] },
        );
        expect(byRingId.found).to.equal(true);
        expect(byRingId.revision).to.equal(5);
        expect(byRingId.sections.prompt).to.deep.equal(event.promptMessages);

        const byCaptureEventId = await resolveCompletionEventDetail(
            { source: { kind: "live" }, eventId: "capture-event-42", sections: ["summary"] },
            { revision: 5, availableModels: [] },
        );
        expect(byCaptureEventId.found).to.equal(true);

        const missing = await resolveCompletionEventDetail(
            { source: { kind: "live" }, eventId: "E-does-not-exist", sections: ["prompt"] },
            { revision: 5, availableModels: [] },
        );
        expect(missing.found).to.equal(false);
        expect(missing.sections).to.deep.equal({});
    });

    test("trace events resolve through the repository's loaded-trace cache", async () => {
        const tracePath = path.join(tempDir, "inline-completion-trace-test.json");
        const traceEvent = {
            ...createTestEvent({ rawResponse: "trace raw response" }),
            id: "E-9001",
        };
        fs.writeFileSync(
            tracePath,
            JSON.stringify({
                version: 1,
                exportedAt: Date.now(),
                _savedAt: new Date().toISOString(),
                _extensionVersion: "0.0.0-test",
                overrides: {},
                recordWhenClosed: false,
                events: [traceEvent],
            }),
            "utf8",
        );

        const record: FakeHostRecord = {
            infoMessages: [],
            openDialogUris: [vscode.Uri.file(tracePath)],
        };
        let services: InlineCompletionDebugServiceSet | undefined;
        try {
            services = createInlineCompletionDebugServices({
                extensionContext: createFakeExtensionContext(),
                hostServices: createFakeHostServices(record),
            });
            await services.traceRepository.addSessionTraceFile();
            const fileKey = vscode.Uri.file(tracePath).fsPath;

            const found = await resolveCompletionEventDetail(
                {
                    source: { kind: "trace", fileKey },
                    eventId: "E-9001",
                    sections: ["rawResponse", "summary"],
                },
                {
                    revision: 9,
                    availableModels: [],
                    traceRepository: services.traceRepository,
                },
            );
            expect(found.found).to.equal(true);
            expect(found.sections.rawResponse).to.equal("trace raw response");

            const missingEvent = await resolveCompletionEventDetail(
                { source: { kind: "trace", fileKey }, eventId: "E-nope", sections: ["summary"] },
                {
                    revision: 9,
                    availableModels: [],
                    traceRepository: services.traceRepository,
                },
            );
            expect(missingEvent.found).to.equal(false);

            const missingFile = await resolveCompletionEventDetail(
                {
                    source: { kind: "trace", fileKey: path.join(tempDir, "not-indexed.json") },
                    eventId: "E-9001",
                    sections: ["summary"],
                },
                {
                    revision: 9,
                    availableModels: [],
                    traceRepository: services.traceRepository,
                },
            );
            expect(missingFile.found).to.equal(false);
        } finally {
            services?.dispose();
        }
    });
});
