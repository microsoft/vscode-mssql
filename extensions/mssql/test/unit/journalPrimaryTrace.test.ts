/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Journal-primary mechanics (WI-2.7) and export canaries (WI-2.8):
 * - the deactivate decision ladder (legacy save skipped ONLY for a provably
 *   healthy journal epoch; every doubt keeps the legacy save);
 * - v2 export assembly from a repository snapshot (flush barrier → journal
 *   read → phase merge → projection → serializeFeatureTraceV2);
 * - reduce-only export fidelity: content-redacted streams export redacted
 *   (privacy canary), redactPrompts applies on top and drops the replay
 *   claim, mid-epoch policy rolls demote the whole export;
 * - journal gaps surface as an explicit truncation block;
 * - the v2 export round-trips through the strict parser into a store;
 * - default-off byte parity: the v1 serializer output is golden-fixture
 *   stable (the flag-off path writes exactly this).
 */

import { expect } from "chai";
import {
    FeatureCaptureJournalBinding,
    FeatureCaptureJournalBindingOptions,
} from "../../src/diagnostics/featureCapture/captureJournalBinding";
import { FeatureCaptureStore } from "../../src/diagnostics/featureCapture/captureStore";
import { FeatureCaptureJournalWriter } from "../../src/diagnostics/featureCapture/journal/journalWriter";
import { deepEqual } from "../../src/diagnostics/featureCapture/journal/journalReducer";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import {
    COMPLETIONS_ACCEPTANCE_MUTATION_KIND,
    COMPLETIONS_JOURNAL_EVENT_SCHEMA,
    COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
    buildCompletionsCapturePolicy,
    createCompletionAcceptanceValue,
    isTerminalCompletionResult,
    redactCompletionEventForJournal,
} from "../../src/copilot/inlineCompletionDebug/completionsJournalProjection";
import {
    AssembleJournalPrimaryTraceInput,
    CompletionsJournalSource,
    assembleJournalPrimaryV2Trace,
    resolveJournalPrimaryDeactivateDecision,
} from "../../src/copilot/inlineCompletionDebug/journalPrimaryTrace";
import { normalizeTraceFile } from "../../src/copilot/inlineCompletionDebug/traceLoader";
import { serializeSessionTrace } from "../../src/copilot/inlineCompletionDebug/traceSerializer";
import { inlineCompletionDebugDefaultOverrides } from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import {
    FEATURE_TRACE_SCHEMA_V2,
    RichCapturePolicySnapshot,
} from "../../src/sharedInterfaces/featureTrace";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventResult,
    InlineCompletionDebugOverrides,
} from "../../src/sharedInterfaces/inlineCompletionDebug";
import { ObservabilityLinkV1 } from "../../src/sharedInterfaces/observabilityLink";
import { ManualClock, MemJournalFs } from "./support/memJournalFs";

const STORE_ROOT = "C:/journal-primary-store";
const HOST_SESSION = diag.sessionId;
const SENTINEL = "SENTINEL_JP_PROMPT_7c2e";

type TestStore = FeatureCaptureStore<InlineCompletionDebugEvent, InlineCompletionDebugOverrides>;

function makeStore(): TestStore {
    return new FeatureCaptureStore<InlineCompletionDebugEvent, InlineCompletionDebugOverrides>({
        logName: "JournalPrimaryTest",
        featureId: "completions",
        defaultOverrides: { ...inlineCompletionDebugDefaultOverrides },
        normalizeOverrides: (overrides) => ({
            ...inlineCompletionDebugDefaultOverrides,
            ...overrides,
        }),
        normalizePartialOverrides: (overrides) => overrides,
    });
}

function makeBinding(
    store: TestStore,
    fs: MemJournalFs,
    policyProvider: () => RichCapturePolicySnapshot | undefined,
    writerOptions: FeatureCaptureJournalBindingOptions<
        InlineCompletionDebugEvent,
        InlineCompletionDebugOverrides
    >["writerOptions"] = { flushIntervalMs: 60_000 },
): FeatureCaptureJournalBinding<InlineCompletionDebugEvent, InlineCompletionDebugOverrides> {
    return new FeatureCaptureJournalBinding({
        store,
        storeRoot: STORE_ROOT,
        hostSessionId: HOST_SESSION,
        eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
        overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
        policyProvider,
        redactEventValue: redactCompletionEventForJournal,
        isTerminal: (event) => isTerminalCompletionResult(event.result),
        acceptanceValue: (_event, mutationKind) =>
            mutationKind === COMPLETIONS_ACCEPTANCE_MUTATION_KIND
                ? createCompletionAcceptanceValue(99_000)
                : undefined,
        fs,
        clock: new ManualClock(),
        writerOptions,
    });
}

function fullPolicy(): RichCapturePolicySnapshot {
    return buildCompletionsCapturePolicy({
        traceCaptureEnabled: true,
        redactPrompts: false,
        viewerArmed: true,
        activatedAt: 1_000,
    })!;
}

function redactedPolicy(): RichCapturePolicySnapshot {
    return buildCompletionsCapturePolicy({
        traceCaptureEnabled: true,
        redactPrompts: true,
        viewerArmed: true,
        activatedAt: 1_000,
    })!;
}

function makeEvent(
    link: ObservabilityLinkV1,
    result: InlineCompletionDebugEventResult,
    extras: Partial<Omit<InlineCompletionDebugEvent, "id">> = {},
): Omit<InlineCompletionDebugEvent, "id"> {
    return {
        timestamp: 10_000,
        link,
        documentUri: "file:///c/query.sql",
        documentFileName: "query.sql",
        line: 3,
        column: 7,
        triggerKind: "automatic",
        explicitFromUser: false,
        completionCategory: "continuation",
        intentMode: false,
        inferredSystemQuery: false,
        modelFamily: "test-family",
        modelId: "test-model",
        modelVendor: "test-vendor",
        result,
        latencyMs: 42,
        inputTokens: 100,
        outputTokens: 12,
        schemaObjectCount: 2,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 1,
        usedSchemaContext: true,
        overridesApplied: { customSystemPromptUsed: false },
        promptMessages: [{ role: "user", content: SENTINEL }],
        rawResponse: `${SENTINEL}-raw`,
        sanitizedResponse: "sanitized text",
        finalCompletionText: "final text",
        schemaContextFormatted: undefined,
        locals: { linePrefix: "SELECT * FR", effectiveMaxTokens: 128 },
        ...extras,
    };
}

function assembleInput(
    source: CompletionsJournalSource,
    fs: MemJournalFs,
    overrides: Partial<AssembleJournalPrimaryTraceInput> = {},
): AssembleJournalPrimaryTraceInput {
    return {
        source,
        fs,
        ringEventCount: 0,
        ringEvictedCount: 0,
        overrides: { ...inlineCompletionDebugDefaultOverrides },
        recordWhenClosed: true,
        extensionVersion: "1.45.0-test",
        customPromptLastSavedAt: 123_456,
        redactPrompts: false,
        provenance: {
            extensionVersion: "1.45.0-test",
            vscodeVersion: "1.102.0",
            platform: "win32",
            origin: "localProduct",
        },
        exportedAt: 1_752_000_000_000,
        savedAt: "2026-07-16T03:00:00.000Z",
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Decision ladder (WI-2.7)
// ---------------------------------------------------------------------------

suite("Journal-primary deactivate decision ladder (WI-2.7)", () => {
    const healthyBase = {
        journalPrimaryEnabled: true,
        bindingActive: true,
        epochStreamCount: 1,
        ringEventCount: 3,
        ringEvictedCount: 0,
        writerState: "ok" as const,
        epochDroppedRecords: 0,
        linklessSkipped: 0,
    };

    test("flag off always keeps the legacy save (rollback posture)", () => {
        const decision = resolveJournalPrimaryDeactivateDecision({
            ...healthyBase,
            journalPrimaryEnabled: false,
        });
        expect(decision.skipLegacySave).to.equal(false);
        expect(decision.reason).to.contain("flag is off");
    });

    test("inactive binding keeps the legacy save", () => {
        const decision = resolveJournalPrimaryDeactivateDecision({
            ...healthyBase,
            bindingActive: false,
        });
        expect(decision.skipLegacySave).to.equal(false);
    });

    test("linkless (never-journaled) events keep the legacy save", () => {
        const decision = resolveJournalPrimaryDeactivateDecision({
            ...healthyBase,
            linklessSkipped: 1,
        });
        expect(decision.skipLegacySave).to.equal(false);
        expect(decision.reason).to.contain("durable identity");
    });

    test("no stream + empty ring skips (nothing was captured)", () => {
        const decision = resolveJournalPrimaryDeactivateDecision({
            ...healthyBase,
            epochStreamCount: 0,
            ringEventCount: 0,
            ringEvictedCount: 0,
        });
        expect(decision.skipLegacySave).to.equal(true);
    });

    test("no stream + ring events (or evictions) keeps the legacy save", () => {
        for (const ring of [
            { ringEventCount: 2, ringEvictedCount: 0 },
            { ringEventCount: 0, ringEvictedCount: 5 },
        ]) {
            const decision = resolveJournalPrimaryDeactivateDecision({
                ...healthyBase,
                epochStreamCount: 0,
                ...ring,
            });
            expect(decision.skipLegacySave).to.equal(false);
        }
    });

    test("any epoch drop keeps the legacy save", () => {
        const decision = resolveJournalPrimaryDeactivateDecision({
            ...healthyBase,
            epochDroppedRecords: 1,
        });
        expect(decision.skipLegacySave).to.equal(false);
        expect(decision.reason).to.contain("dropped");
    });

    test("failed writer keeps the legacy save", () => {
        const decision = resolveJournalPrimaryDeactivateDecision({
            ...healthyBase,
            writerState: "failed",
        });
        expect(decision.skipLegacySave).to.equal(false);
    });

    test("ok/degraded writer with zero drops skips the legacy save", () => {
        for (const writerState of ["ok", "degraded"] as const) {
            const decision = resolveJournalPrimaryDeactivateDecision({
                ...healthyBase,
                writerState,
            });
            expect(decision.skipLegacySave).to.equal(true);
        }
        // Every stream closed cleanly (no open writer) is also healthy.
        expect(
            resolveJournalPrimaryDeactivateDecision({
                journalPrimaryEnabled: true,
                bindingActive: true,
                epochStreamCount: 1,
                ringEventCount: 3,
                ringEvictedCount: 0,
                epochDroppedRecords: 0,
                linklessSkipped: 0,
            }).skipLegacySave,
        ).to.equal(true);
    });

    test("binding accumulates epoch drops in health (decision input)", () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        // Queue cap 1: the header fills the queue, every event record drops.
        const binding = makeBinding(store, fs, fullPolicy, {
            flushIntervalMs: 60_000,
            maxQueueRecords: 1,
        });
        const link = store.createEventLink();
        store.addEvent(makeEvent(link, "success"));
        expect(binding.health().epochDroppedRecords).to.be.greaterThan(0);
        const decision = resolveJournalPrimaryDeactivateDecision({
            journalPrimaryEnabled: true,
            bindingActive: binding.isActive,
            epochStreamCount: binding.currentEpochStreamDirectories.length,
            ringEventCount: store.getEvents().length,
            ringEvictedCount: store.evictedEventCount,
            writerState: binding.health().writer!.state,
            epochDroppedRecords: binding.health().epochDroppedRecords,
            linklessSkipped: binding.health().linklessSkipped,
        });
        expect(decision.skipLegacySave).to.equal(false);
        return binding.dispose();
    });
});

// ---------------------------------------------------------------------------
// v2 export assembly (WI-2.7) + export canaries (WI-2.8)
// ---------------------------------------------------------------------------

suite("Journal-primary v2 export assembly (WI-2.7/2.8)", () => {
    test("assembles the v2 envelope from a flushed journal snapshot", async () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        const binding = makeBinding(store, fs, fullPolicy);

        const link1 = store.createEventLink();
        const pending = store.addEvent(makeEvent(link1, "pending"));
        store.updateEvent(pending.id, makeEvent(link1, "success"));
        const link2 = store.createEventLink();
        store.addEvent(makeEvent(link2, "skipped"));
        const ringEvents = store.getEvents();

        const result = await assembleJournalPrimaryV2Trace(
            assembleInput(binding, fs, { ringEventCount: ringEvents.length }),
        );
        expect(result.kind).to.equal("v2");
        if (result.kind !== "v2") {
            return;
        }
        const envelope = result.envelope;
        expect(envelope.schema).to.equal(FEATURE_TRACE_SCHEMA_V2);
        expect(envelope.featureId).to.equal("completions");
        expect(envelope.captureSessionId).to.equal(store.captureSessionId);
        expect(envelope.hostSessionId).to.equal(HOST_SESSION);
        expect(envelope.eventSchema).to.equal(COMPLETIONS_JOURNAL_EVENT_SCHEMA);
        expect(envelope.overridesSchema).to.equal(COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA);
        expect(envelope.exportedAt).to.equal(1_752_000_000_000);
        expect(envelope.savedAt).to.equal("2026-07-16T03:00:00.000Z");
        expect(envelope.extensionVersion).to.equal("1.45.0-test");
        expect(envelope.capturePolicy?.fidelity).to.equal("fullLocal");
        expect(envelope.capturePolicy?.replayPayloadAvailable).to.equal(true);
        expect(envelope.provenance).to.deep.equal({
            extensionVersion: "1.45.0-test",
            vscodeVersion: "1.102.0",
            platform: "win32",
            origin: "localProduct",
        });
        // Extras ride the envelope like today (v1 parity fields).
        expect(envelope.recordWhenClosed).to.equal(true);
        expect(envelope.customPromptLastSavedAt).to.equal(123_456);
        // Events are the journal projection = the ring, exactly.
        expect(envelope.events).to.have.length(2);
        expect(deepEqual(envelope.events[0], ringEvents[0])).to.equal(true);
        expect(deepEqual(envelope.events[1], ringEvents[1])).to.equal(true);
        expect(envelope.truncation).to.equal(undefined);
        await binding.dispose();
    });

    test("journaled acceptance flips success → accepted in the export", async () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        const binding = makeBinding(store, fs, fullPolicy);
        const link = store.createEventLink();
        const pending = store.addEvent(makeEvent(link, "pending"));
        store.updateEvent(pending.id, makeEvent(link, "success"));
        store.mutateEvent(
            pending.id,
            (event) => {
                event.result = "accepted";
                return true;
            },
            COMPLETIONS_ACCEPTANCE_MUTATION_KIND,
        );
        const result = await assembleJournalPrimaryV2Trace(
            assembleInput(binding, fs, { ringEventCount: 1 }),
        );
        expect(result.kind).to.equal("v2");
        if (result.kind === "v2") {
            expect(result.envelope.events[0].result).to.equal("accepted");
        }
        await binding.dispose();
    });

    test("canary: contentRedacted stream exports NO sentinel text and no replay claim (§9.2)", async () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        const binding = makeBinding(store, fs, redactedPolicy);
        const link = store.createEventLink();
        store.addEvent(makeEvent(link, "success"));
        const result = await assembleJournalPrimaryV2Trace(
            assembleInput(binding, fs, { ringEventCount: 1 }),
        );
        expect(result.kind).to.equal("v2");
        if (result.kind === "v2") {
            const serialized = JSON.stringify(result.envelope);
            expect(serialized.includes(SENTINEL)).to.equal(false);
            expect(result.envelope.capturePolicy?.fidelity).to.equal("contentRedacted");
            expect(result.envelope.capturePolicy?.replayPayloadAvailable).to.equal(false);
        }
        await binding.dispose();
    });

    test("redactPrompts export option reduces a fullLocal stream on top (§9.2)", async () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        const binding = makeBinding(store, fs, fullPolicy);
        const link = store.createEventLink();
        store.addEvent(makeEvent(link, "success"));
        const result = await assembleJournalPrimaryV2Trace(
            assembleInput(binding, fs, { ringEventCount: 1, redactPrompts: true }),
        );
        expect(result.kind).to.equal("v2");
        if (result.kind === "v2") {
            const event = result.envelope.events[0];
            expect(JSON.stringify(event.promptMessages).includes(SENTINEL)).to.equal(false);
            expect(event.rawResponse?.includes(SENTINEL)).to.equal(false);
            // Capture-time fidelity is reported honestly, but a payload-free
            // export never advertises replayability.
            expect(result.envelope.capturePolicy?.fidelity).to.equal("fullLocal");
            expect(result.envelope.capturePolicy?.replayPayloadAvailable).to.equal(false);
        }
        await binding.dispose();
    });

    test("mid-epoch policy roll demotes the WHOLE export to redacted", async () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        let policy = fullPolicy();
        const binding = makeBinding(store, fs, () => policy);
        const link = store.createEventLink();
        const pending = store.addEvent(makeEvent(link, "pending"));
        policy = redactedPolicy();
        binding.refreshPolicy();
        store.updateEvent(pending.id, makeEvent(link, "success"));
        expect(binding.currentEpochStreamDirectories).to.have.length(2);

        const result = await assembleJournalPrimaryV2Trace(
            assembleInput(binding, fs, { ringEventCount: 1 }),
        );
        expect(result.kind).to.equal("v2");
        if (result.kind === "v2") {
            // One logical event across both phases; content fully redacted.
            expect(result.envelope.events).to.have.length(1);
            expect(result.envelope.events[0].result).to.equal("success");
            expect(JSON.stringify(result.envelope).includes(SENTINEL)).to.equal(false);
            expect(result.envelope.capturePolicy?.fidelity).to.equal("contentRedacted");
        }
        await binding.dispose();
    });

    test("falls back to legacy when the ring holds events the journal never saw", async () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        const link = store.createEventLink();
        store.addEvent(makeEvent(link, "success")); // before the binding hooks
        const binding = makeBinding(store, fs, fullPolicy);
        const result = await assembleJournalPrimaryV2Trace(
            assembleInput(binding, fs, { ringEventCount: store.getEvents().length }),
        );
        expect(result.kind).to.equal("fallbackLegacy");
        if (result.kind === "fallbackLegacy") {
            expect(result.reason).to.contain("no journal stream");
        }
        await binding.dispose();
    });

    test("falls back to legacy when the journal is inactive", async () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        const binding = makeBinding(store, fs, () => undefined);
        const result = await assembleJournalPrimaryV2Trace(assembleInput(binding, fs));
        expect(result.kind).to.equal("fallbackLegacy");
        await binding.dispose();
    });

    test("journal gaps surface as an explicit truncation block", async () => {
        const fs = new MemJournalFs();
        const clock = new ManualClock();
        const directory = `${STORE_ROOT}/sessions/hs-fake/rich/completions/cs-fake`;
        const writer = new FeatureCaptureJournalWriter({
            directory,
            header: {
                featureId: "completions",
                hostSessionId: "hs-fake",
                captureSessionId: "cs-fake",
                eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
                overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
                capturePolicy: fullPolicy(),
            },
            fs,
            clock,
        });
        // An annotation for an id whose created/finalized records were lost:
        // the reducer materializes an honest placeholder with no event body,
        // which the projection must count as an omitted event.
        writer.tryWrite({
            kind: "annotation.added",
            eventRevision: 2,
            captureEventId: "ce-lost",
            at: 50,
            value: { note: "created record was dropped" },
        });
        await writer.close();

        const source: CompletionsJournalSource = {
            isActive: true,
            activePolicy: fullPolicy(),
            epochId: "cs-fake",
            hostSessionId: "hs-fake",
            currentEpochStreamDirectories: [directory],
            flushBarrier: async () => undefined,
        };
        const result = await assembleJournalPrimaryV2Trace(assembleInput(source, fs));
        expect(result.kind).to.equal("v2");
        if (result.kind === "v2") {
            expect(result.envelope.events).to.have.length(0);
            expect(result.envelope.truncation?.occurred).to.equal(true);
            expect(result.envelope.truncation?.omittedEvents).to.equal(1);
        }
    });

    test("canary: the v2 export round-trips through the strict parser into a store", async () => {
        const fs = new MemJournalFs();
        const store = makeStore();
        const binding = makeBinding(store, fs, fullPolicy);
        const link = store.createEventLink();
        store.addEvent(makeEvent(link, "success"));
        const result = await assembleJournalPrimaryV2Trace(
            assembleInput(binding, fs, { ringEventCount: 1 }),
        );
        expect(result.kind).to.equal("v2");
        if (result.kind !== "v2") {
            return;
        }
        // Exactly what lands on disk: serialize, then strict-parse as an
        // untrusted import.
        const parsed = normalizeTraceFile(
            JSON.parse(JSON.stringify(result.envelope, undefined, 2)),
            "roundtrip.json",
        ) as ReturnType<typeof normalizeTraceFile> & {
            _sourceSchema?: string;
            _v2?: { captureSessionId: string };
        };
        expect(parsed._sourceSchema).to.equal(FEATURE_TRACE_SCHEMA_V2);
        expect(parsed._v2?.captureSessionId).to.equal(store.captureSessionId);
        expect(parsed.recordWhenClosed).to.equal(true);
        expect(parsed.customPromptLastSavedAt).to.equal(123_456);
        expect(parsed.events).to.have.length(1);
        expect(parsed.events[0].rawResponse).to.equal(`${SENTINEL}-raw`);

        const importTarget = makeStore();
        importTarget.importEvents(parsed.events, parsed.overrides);
        expect(importTarget.getEvents()).to.have.length(1);
        expect(importTarget.getEvents()[0].result).to.equal("success");
        await binding.dispose();
    });
});

// ---------------------------------------------------------------------------
// Default-off byte parity (WI-2.7 rollback posture)
// ---------------------------------------------------------------------------

suite("Legacy v1 trace byte parity (journalPrimary off)", () => {
    test("serializeSessionTrace output matches the golden v1 envelope byte for byte", () => {
        const link: ObservabilityLinkV1 = {
            schema: "mssql.observabilityLink/1",
            featureId: "completions",
            hostSessionId: "hs-golden",
            captureSessionId: "cs-golden",
            captureEventId: "ce-golden",
        };
        const event: InlineCompletionDebugEvent = {
            id: "E-1",
            ...makeEvent(link, "success"),
        } as InlineCompletionDebugEvent;
        const trace = serializeSessionTrace([event], {
            exportedAt: 1_752_000_000_000,
            savedAt: "2026-07-16T03:00:00.000Z",
            extensionVersion: "1.45.0-test",
            overrides: { ...inlineCompletionDebugDefaultOverrides },
            recordWhenClosed: false,
            customPromptLastSavedAt: 42,
        });
        const golden = {
            version: 1,
            exportedAt: 1_752_000_000_000,
            _savedAt: "2026-07-16T03:00:00.000Z",
            _extensionVersion: "1.45.0-test",
            overrides: { ...inlineCompletionDebugDefaultOverrides },
            recordWhenClosed: false,
            customPromptLastSavedAt: 42,
            events: [JSON.parse(JSON.stringify(event))],
        };
        expect(JSON.stringify(trace, undefined, 2)).to.equal(JSON.stringify(golden, undefined, 2));
    });

    test("redactPrompts golden parity: prompt/response/schema keys tokenized, rest untouched", () => {
        const link: ObservabilityLinkV1 = {
            schema: "mssql.observabilityLink/1",
            featureId: "completions",
            hostSessionId: "hs-golden",
            captureSessionId: "cs-golden",
            captureEventId: "ce-golden-2",
        };
        const event: InlineCompletionDebugEvent = {
            id: "E-2",
            ...makeEvent(link, "success", { schemaContextFormatted: "CREATE TABLE secret(x int)" }),
        } as InlineCompletionDebugEvent;
        const trace = serializeSessionTrace(
            [event],
            {
                exportedAt: 1,
                savedAt: "2026-07-16T03:00:00.000Z",
                extensionVersion: "1.45.0-test",
                overrides: { ...inlineCompletionDebugDefaultOverrides },
                recordWhenClosed: false,
            },
            { redactPrompts: true },
        );
        const exported = trace.events[0];
        expect(exported.promptMessages[0].content).to.equal("[REDACTED]");
        expect(exported.rawResponse).to.equal("[REDACTED]");
        expect(exported.finalCompletionText).to.equal("[REDACTED]");
        expect(exported.schemaContextFormatted).to.equal("[REDACTED]");
        // v1 redactPrompts never touched locals — parity preserved.
        expect(exported.locals?.linePrefix).to.equal("SELECT * FR");
        expect(exported.latencyMs).to.equal(42);
    });
});
