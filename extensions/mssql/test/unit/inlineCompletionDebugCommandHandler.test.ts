/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * WI-1.1 (de-fork through domain services): the shared
 * InlineCompletionDebugCommandHandler covers every reducer key (compile-time
 * exhaustive), representative commands drive the singleton store through the
 * services with injected fakes, and the Debug Console adapter's allowlist
 * still stubs replay/sessions commands with the standalone-viewer message.
 */

import { expect } from "chai";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import { ConsoleCompletionsDebugHost } from "../../src/diagnostics/completionsDebugConsoleHost";
import {
    inlineCompletionDebugDefaultOverrides,
    inlineCompletionDebugStore,
} from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import {
    createInlineCompletionDebugServices,
    InlineCompletionDebugServiceSet,
} from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionDebugCommandHandler";
import {
    INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
    INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY,
} from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionDebugConstants";
import { InlineCompletionDebugHostServices } from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionDebugHostServices";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugReducers,
} from "../../src/sharedInterfaces/inlineCompletionDebug";

/**
 * Compile-time exhaustiveness gate: this record fails to compile whenever a
 * reducer key is added without extending it, and the runtime test below then
 * asserts the handler exposes exactly these command names.
 */
const ALL_REDUCER_KEYS: Record<keyof InlineCompletionDebugReducers, true> = {
    clearEvents: true,
    selectEvent: true,
    updateOverrides: true,
    selectProfile: true,
    setRecordWhenClosed: true,
    openCustomPromptDialog: true,
    closeCustomPromptDialog: true,
    saveCustomPrompt: true,
    resetCustomPrompt: true,
    refreshSchemaContext: true,
    importSession: true,
    exportSession: true,
    saveTraceNow: true,
    sessionsActivated: true,
    sessionsRefresh: true,
    sessionsToggleTrace: true,
    sessionsSetAllTraces: true,
    sessionsLoadIncluded: true,
    sessionsAddFile: true,
    sessionsChangeFolder: true,
    sessionsEnableTraceCollection: true,
    sessionsSyncToDatabase: true,
    replayEvent: true,
    replaySessionEvent: true,
    openReplayBuilder: true,
    closeReplayBuilder: true,
    addEventsToReplayCart: true,
    addSessionToReplayCart: true,
    replaySessionNow: true,
    removeFromReplayCart: true,
    reorderReplayCart: true,
    clearReplayCart: true,
    reverseReplayCart: true,
    setReplayCartOverride: true,
    setReplayCartConfigMode: true,
    queueReplayCart: true,
    runReplayMatrix: true,
    cancelReplayRun: true,
    copyEventPayload: true,
};

interface FakeHostRecord {
    infoMessages: string[];
    clipboardWrites: string[];
    configurationWrites: Array<{ section: string; value: unknown }>;
}

function createFakeHostServices(record: FakeHostRecord): InlineCompletionDebugHostServices {
    return {
        showSaveDialog: async () => undefined,
        showOpenDialog: async () => undefined,
        showInformationMessage: async (message) => {
            record.infoMessages.push(message);
            return undefined;
        },
        showWarningMessage: async () => undefined,
        writeClipboardText: async (text) => {
            record.clipboardWrites.push(text);
        },
        updateConfiguration: async (section, value) => {
            record.configurationWrites.push({ section, value });
        },
        readFile: async () => new Uint8Array(),
        writeFile: async () => undefined,
    };
}

function createFakeMemento(initial: Record<string, unknown> = {}) {
    const values = new Map<string, unknown>(Object.entries(initial));
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
        _values: values,
    };
}

function createFakeExtensionContext(workspaceState: ReturnType<typeof createFakeMemento>) {
    return {
        workspaceState,
        globalState: createFakeMemento(),
        globalStorageUri: vscode.Uri.file(
            path.join(os.tmpdir(), "mssql-ic-debug-command-handler-test"),
        ),
        extension: { packageJSON: { version: "0.0.0-test" } },
        languageModelAccessInformation: undefined,
    } as unknown as vscode.ExtensionContext;
}

function createTestEvent(
    overrides: Partial<Omit<InlineCompletionDebugEvent, "id">> = {},
): Omit<InlineCompletionDebugEvent, "id"> {
    return {
        timestamp: Date.now(),
        documentUri: "file:///test.sql",
        documentFileName: "test.sql",
        line: 1,
        column: 1,
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

function resetSingletonStore(): void {
    inlineCompletionDebugStore.clearEvents();
    inlineCompletionDebugStore.updateOverrides({ ...inlineCompletionDebugDefaultOverrides });
}

suite("Inline completion debug command handler (WI-1.1)", () => {
    let record: FakeHostRecord;
    let workspaceState: ReturnType<typeof createFakeMemento>;
    let services: InlineCompletionDebugServiceSet;

    setup(() => {
        resetSingletonStore();
        record = { infoMessages: [], clipboardWrites: [], configurationWrites: [] };
        workspaceState = createFakeMemento();
        services = createInlineCompletionDebugServices({
            extensionContext: createFakeExtensionContext(workspaceState),
            hostServices: createFakeHostServices(record),
        });
    });

    teardown(() => {
        services.dispose();
        resetSingletonStore();
    });

    test("handler covers every reducer key", () => {
        const expected = Object.keys(ALL_REDUCER_KEYS).sort();
        const actual = [...services.commandHandler.commandNames].sort();
        expect(actual).to.deep.equal(expected);
    });

    test("clearEvents empties the store and drops the selection", async () => {
        const event = inlineCompletionDebugStore.addEvent(createTestEvent());
        await services.commandHandler.handle("selectEvent", { eventId: event.id });
        expect(services.commandHandler.viewState.selectedEventId).to.equal(event.id);

        await services.commandHandler.handle("clearEvents", {});
        expect(inlineCompletionDebugStore.getEvents()).to.have.length(0);
        expect(services.commandHandler.viewState.selectedEventId).to.equal(undefined);
    });

    test("selectProfile applies the preset override set", async () => {
        await services.commandHandler.handle("selectProfile", { profileId: "focused" });
        expect(inlineCompletionDebugStore.getOverrides().profileId).to.equal("focused");
    });

    test("updateOverrides on a preset profile materializes to custom", async () => {
        await services.commandHandler.handle("selectProfile", { profileId: "focused" });
        await services.commandHandler.handle("updateOverrides", {
            overrides: { debounceMs: 500 },
        });

        const overrides = inlineCompletionDebugStore.getOverrides();
        expect(overrides.profileId).to.equal("custom");
        expect(overrides.debounceMs).to.equal(500);
    });

    test("setRecordWhenClosed writes through the injected configuration fake", async () => {
        await services.commandHandler.handle("setRecordWhenClosed", { enabled: true });
        expect(record.configurationWrites).to.deep.equal([
            {
                section: Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
                value: true,
            },
        ]);
    });

    test("copyEventPayload writes through the injected clipboard fake", async () => {
        const event = inlineCompletionDebugStore.addEvent(createTestEvent());
        await services.commandHandler.handle("copyEventPayload", {
            eventId: event.id,
            kind: "rawResponse",
        });
        expect(record.clipboardWrites).to.deep.equal(["raw response text"]);

        await services.commandHandler.handle("copyEventPayload", {
            eventId: event.id,
            kind: "systemPrompt",
        });
        expect(record.clipboardWrites[1]).to.equal("system rules");
    });

    test("saveCustomPrompt persists to the memento fakes and the store", async () => {
        await services.commandHandler.handle("openCustomPromptDialog", {});
        expect(services.commandHandler.viewState.customPromptDialogOpen).to.equal(true);

        await services.commandHandler.handle("saveCustomPrompt", { value: "my custom prompt" });
        expect(
            workspaceState.get<string | null>(INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY),
        ).to.equal("my custom prompt");
        expect(
            workspaceState.get<number>(INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_SAVED_AT_MEMENTO_KEY),
        ).to.be.a("number");
        expect(inlineCompletionDebugStore.getOverrides().customSystemPrompt).to.equal(
            "my custom prompt",
        );
        expect(services.commandHandler.viewState.customPromptDialogOpen).to.equal(false);
        expect(services.captureService.savedCustomPromptValue).to.equal("my custom prompt");

        await services.commandHandler.handle("resetCustomPrompt", {});
        expect(
            workspaceState.get<string | null>(
                INLINE_COMPLETION_DEBUG_CUSTOM_PROMPT_MEMENTO_KEY,
                null,
            ),
        ).to.equal(null);
        expect(inlineCompletionDebugStore.getOverrides().customSystemPrompt).to.equal(null);
    });

    test("projector reflects handler view state without forked assembly", async () => {
        const event = inlineCompletionDebugStore.addEvent(createTestEvent());
        await services.commandHandler.handle("selectEvent", { eventId: event.id });

        const state = services.projector.buildState(services.commandHandler.viewState);
        expect(state.selectedEventId).to.equal(event.id);
        expect(state.events).to.have.length(1);
        expect(state.replay.cart).to.deep.equal([]);
        expect(state.sessions.traceIndex).to.deep.equal([]);
    });

    test("addEventsToReplayCart resolves live-ring references host-side (WI-1.4)", async () => {
        const event = inlineCompletionDebugStore.addEvent(createTestEvent());
        await services.commandHandler.handle("addEventsToReplayCart", {
            items: [{ liveEventId: event.id }],
        });

        const state = services.projector.buildState(services.commandHandler.viewState);
        expect(state.replay.cart).to.have.length(1);
        expect(state.replay.cart[0].sourceEventId).to.equal(event.id);
        // Full body resolved from the ring — never round-tripped by the caller.
        expect(state.replay.cart[0].event.rawResponse).to.equal("raw response text");
        expect(record.infoMessages).to.deep.equal([]);
    });

    test("addEventsToReplayCart drops evicted live references honestly", async () => {
        await services.commandHandler.handle("addEventsToReplayCart", {
            items: [{ liveEventId: "E-does-not-exist" }],
        });

        const state = services.projector.buildState(services.commandHandler.viewState);
        expect(state.replay.cart).to.deep.equal([]);
        expect(record.infoMessages).to.have.length(1);
        expect(record.infoMessages[0]).to.include("no longer in the live ring");
    });
});

suite("Debug Console completions command handler full surface (WI-1.4/1.5)", () => {
    let record: FakeHostRecord;
    let host: ConsoleCompletionsDebugHost;

    setup(() => {
        resetSingletonStore();
        record = { infoMessages: [], clipboardWrites: [], configurationWrites: [] };
        host = new ConsoleCompletionsDebugHost({
            extensionContext: createFakeExtensionContext(createFakeMemento()),
            hostServices: createFakeHostServices(record),
        });
    });

    teardown(() => {
        host.dispose();
        resetSingletonStore();
    });

    test("previously stubbed replay commands now dispatch through the shared handler", async () => {
        // openReplayBuilder was stubbed while the console ran the Live-only
        // subset; it now mutates real replay state through the shared service.
        const opened = await host.dispatchAction("openReplayBuilder", {});
        expect(opened.replay.builderOpen).to.equal(true);
        expect(record.infoMessages).to.deep.equal([]);

        const closed = await host.dispatchAction("closeReplayBuilder", { restoreCart: false });
        expect(closed.replay.builderOpen).to.equal(false);
    });

    test("previously stubbed cart commands mutate real replay state", async () => {
        const event = inlineCompletionDebugStore.addEvent(createTestEvent());
        const withItem = await host.dispatchAction("addEventsToReplayCart", {
            items: [{ liveEventId: event.id }],
        });
        expect(withItem.replay.cart).to.have.length(1);

        const cleared = await host.dispatchAction("clearReplayCart", {});
        expect(cleared.replay.cart).to.deep.equal([]);
        expect(record.infoMessages).to.deep.equal([]);
    });

    test("live commands keep riding the shared handler", async () => {
        inlineCompletionDebugStore.addEvent(createTestEvent());
        const state = await host.dispatchAction("clearEvents", {});
        expect(record.infoMessages).to.deep.equal([]);
        expect(state.events).to.have.length(0);
        expect(inlineCompletionDebugStore.getEvents()).to.have.length(0);
    });

    test("unknown commands surface the validation message, never thrown", async () => {
        const state = await host.dispatchAction("definitelyNotACommand", { anything: 1 });
        expect(record.infoMessages).to.have.length(1);
        expect(record.infoMessages[0]).to.include("unknown command name");
        expect(state.customPrompt.dialogOpen).to.equal(false);
    });

    test("malformed payloads on the legacy action path are rejected in-band", async () => {
        const state = await host.dispatchAction("replayEvent", {});
        expect(record.infoMessages).to.have.length(1);
        expect(record.infoMessages[0]).to.include("eventId");
        expect(state.replay.runs).to.deep.equal([]);
    });
});
