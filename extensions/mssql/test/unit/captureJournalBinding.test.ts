/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Feature-capture journal binding (WI-2.4): lifecycle-record mapping over the
 * store's typed hooks, append-time fidelity enforcement, epoch/policy stream
 * rolls, settings gating, linkless skip accounting, failure isolation, and
 * the ring-vs-journal reconciliation round trip (WI-2.6). Plus the WI-2.4
 * privacy canary proving the central-upload session projection never sweeps
 * rich/ journal files.
 */

import { expect } from "chai";
import * as nodeFs from "fs";
import * as os from "os";
import * as nodePath from "path";
import {
    FeatureCaptureJournalBinding,
    defaultClassifyCapturePolicy,
} from "../../src/diagnostics/featureCapture/captureJournalBinding";
import { FeatureCaptureStore } from "../../src/diagnostics/featureCapture/captureStore";
import { readFeatureCaptureJournal } from "../../src/diagnostics/featureCapture/journal/journalReader";
import { deepEqual } from "../../src/diagnostics/featureCapture/journal/journalReducer";
import { FeatureCaptureManifestV1 } from "../../src/diagnostics/featureCapture/journal/journalSchemas";
import { reconcileCaptureSession } from "../../src/diagnostics/featureCapture/journalReconciliation";
import { loadDiagSessionSource, projectSource } from "../../src/diagnostics/centralUpload";
import {
    COMPLETIONS_ACCEPTANCE_MUTATION_KIND,
    COMPLETIONS_JOURNAL_EVENT_SCHEMA,
    COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
    buildCompletionsCapturePolicy,
    completionsReconciliationAdapter,
    createCompletionAcceptanceValue,
    isTerminalCompletionResult,
    projectJournalToCompletionEvents,
    redactCompletionEventForJournal,
} from "../../src/copilot/inlineCompletionDebug/completionsJournalProjection";
import { RichCapturePolicySnapshot } from "../../src/sharedInterfaces/featureTrace";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventResult,
} from "../../src/sharedInterfaces/inlineCompletionDebug";
import { ObservabilityLinkV1 } from "../../src/sharedInterfaces/observabilityLink";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import { ManualClock, MemJournalFs } from "./support/memJournalFs";

const STORE_ROOT = "C:/store-root";
// The store's createEventLink stamps diag.sessionId into every link; the
// binding must use the SAME host session (as production wiring does) or the
// reducer's identity guard would rightly reject the records as foreign.
const HOST_SESSION = diag.sessionId;
const SENTINEL = "SENTINEL_PROMPT_TEXT_9f4a";

interface TestOverrides {
    note: string | null;
}

type TestStore = FeatureCaptureStore<InlineCompletionDebugEvent, TestOverrides>;

function makeStore(capacity?: number): TestStore {
    return new FeatureCaptureStore<InlineCompletionDebugEvent, TestOverrides>({
        logName: "JournalBindingTest",
        featureId: "completions",
        ...(capacity !== undefined ? { capacity } : {}),
        defaultOverrides: { note: null },
        normalizeOverrides: (overrides) => ({ note: overrides.note ?? null }),
        normalizePartialOverrides: (overrides) => overrides,
    });
}

function makePolicy(fidelity: "fullLocal" | "contentRedacted"): RichCapturePolicySnapshot {
    return buildCompletionsCapturePolicy({
        traceCaptureEnabled: true,
        redactPrompts: fidelity === "contentRedacted",
        viewerArmed: true,
        activatedAt: 1_000,
    })!;
}

function makeEvent(
    link: ObservabilityLinkV1 | undefined,
    result: InlineCompletionDebugEventResult,
    extras: Partial<Omit<InlineCompletionDebugEvent, "id">> = {},
): Omit<InlineCompletionDebugEvent, "id"> {
    return {
        timestamp: 10_000,
        ...(link ? { link } : {}),
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
        promptMessages: [{ role: "user", content: "SELECT * FROM dbo.T" }],
        rawResponse: "raw model text",
        sanitizedResponse: "sanitized text",
        finalCompletionText: "final text",
        schemaContextFormatted: undefined,
        locals: { linePrefix: "SELECT * FR", effectiveMaxTokens: 128 },
        ...extras,
    };
}

interface BundleCall {
    method: "register" | "close";
    artifactId: string;
    status?: string;
}

function makeBundleRecorder(calls: BundleCall[]) {
    return {
        registerArtifact: async (
            _hostSessionId: string,
            input: { artifactId: string; status: "active" | "closed" | "partial" },
        ) => {
            calls.push({ method: "register", artifactId: input.artifactId, status: input.status });
        },
        closeArtifact: async (
            _hostSessionId: string,
            artifactId: string,
            patch?: { status?: string; bytes: number; gaps: number },
        ) => {
            calls.push({ method: "close", artifactId, status: patch?.status });
            return true;
        },
        flushBarrier: async () => undefined,
    };
}

function makeBinding(
    store: TestStore,
    fs: MemJournalFs,
    policyRef: { current: RichCapturePolicySnapshot | undefined },
    bundleCalls?: BundleCall[],
) {
    return new FeatureCaptureJournalBinding<InlineCompletionDebugEvent, TestOverrides>({
        store,
        storeRoot: STORE_ROOT,
        hostSessionId: HOST_SESSION,
        eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
        overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
        policyProvider: () => policyRef.current,
        redactEventValue: redactCompletionEventForJournal,
        isTerminal: (event) => isTerminalCompletionResult(event.result),
        acceptanceValue: (_event, mutationKind) =>
            mutationKind === COMPLETIONS_ACCEPTANCE_MUTATION_KIND
                ? createCompletionAcceptanceValue(10_200)
                : undefined,
        ...(bundleCalls ? { bundleRegistrar: makeBundleRecorder(bundleCalls) } : {}),
        fs,
        clock: new ManualClock(),
        writerOptions: { flushIntervalMs: 60_000 },
    });
}

function segmentContents(fs: MemJournalFs): string {
    return [...fs.files.entries()]
        .filter(([path]) => /segment-\d{6}\.jsonl$/.test(path))
        .map(([, content]) => content)
        .join("\n");
}

function manifestAt(fs: MemJournalFs, directory: string): FeatureCaptureManifestV1 {
    const raw = fs.files.get(`${directory}/manifest.json`);
    expect(raw, `manifest.json should exist in ${directory}`).to.not.equal(undefined);
    return JSON.parse(raw!) as FeatureCaptureManifestV1;
}

suite("Feature capture journal binding (WI-2.4)", () => {
    test("pending -> finalized -> accepted round trip: journal projection matches the ring", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const policyRef = { current: makePolicy("fullLocal") };
        const binding = makeBinding(store, fs, policyRef);

        const link = store.createEventLink();
        const pending = store.addEvent(makeEvent(link, "pending"));
        store.updateEvent(pending.id, makeEvent(link, "success", { latencyMs: 77 }));
        store.mutateEvent(
            pending.id,
            (event) => {
                if (event.result !== "success") {
                    return false;
                }
                event.result = "accepted";
                return true;
            },
            "acceptance",
        );
        await binding.flushBarrier();

        const directory = binding.currentEpochStreamDirectories[0];
        const read = await readFeatureCaptureJournal(directory, { fs });
        expect(
            read.issues.filter((issue) => issue.severity === "error"),
            JSON.stringify(read.issues),
        ).to.have.length(0);

        const projected = projectJournalToCompletionEvents(read.state);
        expect(projected).to.have.length(1);
        expect(projected[0].result).to.equal("accepted");
        expect(deepEqual(projected[0], store.getEvents()[0])).to.equal(true);

        const report = await reconcileCaptureSession(
            store.getEvents(),
            read,
            completionsReconciliationAdapter,
            { ringEvictedCount: store.evictedEventCount, expectedFidelity: "fullLocal" },
        );
        expect(report.mismatches, report.mismatches.join("; ")).to.have.length(0);
        expect(report.matches).to.equal(true);
        expect(report.digest.compared).to.equal(1);

        await binding.dispose();
    });

    test("eviction-then-finalize keeps ONE logical journal event per captureEventId", async () => {
        const store = makeStore(1); // ring capacity 1: the pending gets evicted
        const fs = new MemJournalFs();
        const binding = makeBinding(store, fs, { current: makePolicy("fullLocal") });

        const link1 = store.createEventLink();
        const link2 = store.createEventLink();
        const pending1 = store.addEvent(makeEvent(link1, "pending"));
        store.addEvent(makeEvent(link2, "pending")); // evicts pending1
        expect(store.evictedEventCount).to.equal(1);

        // Provider fallback path: updateEvent misses (evicted) → addEvent with
        // the SAME link (final plan WI-0.1 identity preservation).
        const updated = store.updateEvent(pending1.id, makeEvent(link1, "success"));
        expect(updated).to.equal(undefined);
        store.addEvent(makeEvent(link1, "success"));

        await binding.flushBarrier();
        const read = await readFeatureCaptureJournal(binding.currentEpochStreamDirectories[0], {
            fs,
        });
        expect(read.state.events.size).to.equal(2);
        const logical = read.state.events.get(link1.captureEventId)!;
        expect(logical.createdValue, "created survives").to.not.equal(undefined);
        expect(logical.finalizedValue, "finalized joined the SAME logical event").to.not.equal(
            undefined,
        );
        expect(
            read.issues.filter((issue) => issue.code === "event.duplicateCreated"),
        ).to.have.length(0);
        await binding.dispose();
    });

    test("contentRedacted policy: sentinel content never reaches segment files (append-time canary)", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const binding = makeBinding(store, fs, { current: makePolicy("contentRedacted") });

        const link = store.createEventLink();
        const pending = store.addEvent(
            makeEvent(link, "pending", {
                promptMessages: [{ role: "user", content: SENTINEL }],
                rawResponse: SENTINEL,
                sanitizedResponse: SENTINEL,
                finalCompletionText: SENTINEL,
                schemaContextFormatted: SENTINEL,
                locals: { linePrefix: SENTINEL, statementPrefix: SENTINEL, tokens: 42 },
            }),
        );
        store.updateEvent(
            pending.id,
            makeEvent(link, "error", {
                promptMessages: [{ role: "user", content: SENTINEL }],
                rawResponse: SENTINEL,
                locals: { linePrefix: SENTINEL },
                error: { message: SENTINEL, name: "TestError", stack: `stack ${SENTINEL}` },
            }),
        );
        await binding.flushBarrier();

        expect(segmentContents(fs)).to.not.include(SENTINEL);

        // The reducer's resurrection guard agrees: nothing was rejected.
        const read = await readFeatureCaptureJournal(binding.currentEpochStreamDirectories[0], {
            fs,
        });
        expect(
            read.issues.filter((issue) => issue.code === "redaction.resurrection"),
        ).to.have.length(0);
        const projected = projectJournalToCompletionEvents(read.state);
        expect(projected[0].rawResponse).to.equal("[REDACTED]");
        expect(projected[0].locals.linePrefix).to.equal("[REDACTED]");
        expect(projected[0].locals.tokens ?? projected[0].locals["tokens"]).to.not.equal(SENTINEL);
        expect(projected[0].error?.message).to.equal("[REDACTED]");

        // Metric-shaped fields survive redaction for reconciliation.
        const report = await reconcileCaptureSession(
            store.getEvents(),
            read,
            completionsReconciliationAdapter,
            { expectedFidelity: "contentRedacted" },
        );
        expect(report.matches, report.mismatches.join("; ")).to.equal(true);
        await binding.dispose();
    });

    test("fullLocal policy keeps full content (control for the canary)", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const binding = makeBinding(store, fs, { current: makePolicy("fullLocal") });
        const link = store.createEventLink();
        store.addEvent(makeEvent(link, "success", { rawResponse: SENTINEL }));
        await binding.flushBarrier();
        expect(segmentContents(fs)).to.include(SENTINEL);
        await binding.dispose();
    });

    test("epoch change (clear) closes the stream; the next epoch opens lazily in a new directory", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const binding = makeBinding(store, fs, { current: makePolicy("fullLocal") });

        store.addEvent(makeEvent(store.createEventLink(), "success"));
        await binding.flushBarrier();
        const firstDir = binding.currentEpochStreamDirectories[0];
        const firstEpoch = binding.epochId;

        store.clearEvents();
        await binding.flushBarrier(); // settles the close chain
        expect(manifestAt(fs, firstDir).status).to.equal("closed");
        expect(binding.epochId).to.not.equal(firstEpoch);
        expect(binding.currentEpochStreamDirectories).to.have.length(0);

        store.addEvent(makeEvent(store.createEventLink(), "success"));
        await binding.flushBarrier();
        const secondDir = binding.currentEpochStreamDirectories[0];
        expect(secondDir).to.not.equal(firstDir);
        expect(manifestAt(fs, secondDir).stream.captureSessionId).to.equal(store.captureSessionId);
        await binding.dispose();
    });

    test("import renews the epoch and imported events are NOT journaled", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const binding = makeBinding(store, fs, { current: makePolicy("fullLocal") });

        store.addEvent(makeEvent(store.createEventLink(), "success"));
        await binding.flushBarrier();
        const firstDir = binding.currentEpochStreamDirectories[0];

        const foreignLink: ObservabilityLinkV1 = {
            schema: "mssql.observabilityLink/1",
            featureId: "completions",
            hostSessionId: "hs-foreign",
            captureSessionId: "cs-foreign",
            captureEventId: "ce-foreign-1",
        };
        store.importEvents(
            [{ ...makeEvent(foreignLink, "success"), id: "E-1" } as InlineCompletionDebugEvent],
            undefined,
        );
        await binding.flushBarrier();
        expect(manifestAt(fs, firstDir).status).to.equal("closed");
        expect(segmentContents(fs)).to.not.include("ce-foreign-1");
        expect(binding.currentEpochStreamDirectories).to.have.length(0);
        await binding.dispose();
    });

    test("policy change rolls the stream into a sibling phase directory (a policy never mutates mid-stream)", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const policyRef: { current: RichCapturePolicySnapshot | undefined } = {
            current: makePolicy("fullLocal"),
        };
        const binding = makeBinding(store, fs, policyRef);

        store.addEvent(makeEvent(store.createEventLink(), "success"));
        await binding.flushBarrier();
        const firstDir = binding.currentEpochStreamDirectories[0];

        policyRef.current = makePolicy("contentRedacted");
        binding.refreshPolicy();
        store.addEvent(makeEvent(store.createEventLink(), "success", { rawResponse: SENTINEL }));
        await binding.flushBarrier();

        const directories = binding.currentEpochStreamDirectories;
        expect(directories).to.have.length(2);
        expect(directories[1]).to.equal(`${firstDir}--2`);
        expect(manifestAt(fs, firstDir).status).to.equal("closed");
        const rolled = manifestAt(fs, directories[1]);
        expect(rolled.stream.captureSessionId).to.equal(store.captureSessionId);
        expect(rolled.stream.capturePolicyId).to.include("contentRedacted");
        expect(fs.files.get(`${directories[1]}/segment-000001.jsonl`)).to.not.include(SENTINEL);
        await binding.dispose();
    });

    test("gating: no policy -> no filesystem activity; enabling starts, disabling closes", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const policyRef: { current: RichCapturePolicySnapshot | undefined } = {
            current: undefined,
        };
        const binding = makeBinding(store, fs, policyRef);

        store.addEvent(makeEvent(store.createEventLink(), "success"));
        await binding.flushBarrier();
        expect(binding.isActive).to.equal(false);
        expect(fs.ops).to.have.length(0);
        expect(fs.files.size).to.equal(0);

        policyRef.current = makePolicy("fullLocal");
        binding.refreshPolicy();
        store.addEvent(makeEvent(store.createEventLink(), "success"));
        await binding.flushBarrier();
        const directory = binding.currentEpochStreamDirectories[0];
        expect(manifestAt(fs, directory).status).to.equal("active");

        policyRef.current = undefined;
        binding.refreshPolicy();
        await binding.flushBarrier();
        expect(binding.isActive).to.equal(false);
        expect(manifestAt(fs, directory).status).to.equal("closed");

        // Events while gated off go nowhere (and never throw).
        store.addEvent(makeEvent(store.createEventLink(), "success"));
        await binding.flushBarrier();
        expect(binding.currentEpochStreamDirectories).to.have.length(1);
        await binding.dispose();
    });

    test("events without a link block are skipped and counted (no durable identity)", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const binding = makeBinding(store, fs, { current: makePolicy("fullLocal") });

        store.addEvent(makeEvent(undefined, "success"));
        store.addEvent(makeEvent(undefined, "pending"));
        await binding.flushBarrier();
        expect(binding.health().linklessSkipped).to.equal(2);
        expect(fs.files.size).to.equal(0);
        await binding.dispose();
    });

    test("journal failure isolation: a failing filesystem degrades health, never the ring", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        fs.failAppend = () => new Error("disk full");
        fs.failWrite = () => new Error("disk full");
        const binding = makeBinding(store, fs, { current: makePolicy("fullLocal") });

        for (let index = 0; index < 5; index++) {
            const link = store.createEventLink();
            const pending = store.addEvent(makeEvent(link, "pending"));
            store.updateEvent(pending.id, makeEvent(link, "success"));
        }
        await binding.flushBarrier();

        expect(store.getEvents()).to.have.length(5); // ring unaffected
        const health = binding.health();
        expect(health.writer, "writer health is surfaced").to.not.equal(undefined);
        expect(health.writer!.state).to.not.equal("ok");
        expect(health.writer!.failureDetail).to.include("disk full");
        await binding.dispose();
    });

    test("bundle catalog: descriptor registered on open, closed with honest status on roll/close", async () => {
        const store = makeStore();
        const fs = new MemJournalFs();
        const calls: BundleCall[] = [];
        const binding = makeBinding(store, fs, { current: makePolicy("fullLocal") }, calls);

        store.addEvent(makeEvent(store.createEventLink(), "success"));
        await binding.flushBarrier();
        const dirName = binding.currentEpochStreamDirectories[0].split("/").pop()!;
        expect(calls.some((call) => call.method === "register")).to.equal(true);
        expect(calls[0].artifactId).to.equal(`fc-${dirName}`);

        await binding.dispose();
        const close = calls.find((call) => call.method === "close");
        expect(close, "closeArtifact on stream close").to.not.equal(undefined);
        expect(close!.artifactId).to.equal(`fc-${dirName}`);
        expect(close!.status).to.equal("closed");
    });

    test("classification defaults are honest per fidelity", () => {
        expect(defaultClassifyCapturePolicy(makePolicy("fullLocal"))).to.deep.equal({
            containsRichPayload: true,
            maximumClass: "model.response",
            replayPayloadAvailable: true,
        });
        expect(defaultClassifyCapturePolicy(makePolicy("contentRedacted"))).to.deep.equal({
            containsRichPayload: false,
            maximumClass: "source.path",
            replayPayloadAvailable: false,
        });
    });
});

suite(
    "Central upload privacy canary: rich journals never ride the session projection (WI-2.4)",
    () => {
        test("loadDiagSessionSource + projectDiagSession ignore rich/ and replay/ files", async () => {
            const sessionDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "mssql-rich-canary-"));
            try {
                const manifest = {
                    schemaVersion: "mssql.diag.sessionManifest/1",
                    sessionId: "hs-canary",
                    createdUtc: "2026-07-01T00:00:00.000Z",
                    updatedUtc: "2026-07-01T00:10:00.000Z",
                    source: "live",
                    captureMode: "redacted",
                    policyId: "default/1",
                    eventCount: 1,
                    gapCount: 0,
                    segments: [{ file: "seg-000001.jsonl", firstSeq: 1, lastSeq: 1, events: 1 }],
                    provenance: {},
                    status: "closed",
                };
                nodeFs.mkdirSync(nodePath.join(sessionDir, "events"), { recursive: true });
                nodeFs.writeFileSync(
                    nodePath.join(sessionDir, "manifest.json"),
                    JSON.stringify(manifest),
                );
                nodeFs.writeFileSync(
                    nodePath.join(sessionDir, "events", "seg-000001.jsonl"),
                    JSON.stringify({
                        schemaVersion: "mssql.diag.event/1",
                        eventId: "evt-1",
                        sessionId: "hs-canary",
                        seq: 1,
                        epochMs: 1_751_000_000_000,
                        process: "extensionHost",
                        feature: "completions",
                        kind: "event",
                        type: "completions.result",
                        status: "ok",
                        payload: {},
                        cls: {
                            max: "diagnostic.metadata",
                            redactedFields: 0,
                            policyId: "default/1",
                        },
                    }) + "\n",
                );
                // The rich journal lives INSIDE the session dir — with a sentinel.
                const richDir = nodePath.join(sessionDir, "rich", "completions", "cs-canary");
                nodeFs.mkdirSync(richDir, { recursive: true });
                nodeFs.writeFileSync(
                    nodePath.join(richDir, "segment-000001.jsonl"),
                    JSON.stringify({ kind: "event.created", value: { rawResponse: SENTINEL } }) +
                        "\n",
                );
                const replayDir = nodePath.join(sessionDir, "replay", "rr-canary");
                nodeFs.mkdirSync(replayDir, { recursive: true });
                nodeFs.writeFileSync(nodePath.join(replayDir, "items.jsonl"), SENTINEL);

                const source = await loadDiagSessionSource(sessionDir);
                expect(
                    source.files.every(
                        (file) =>
                            !file.relativePath.startsWith("rich/") &&
                            !file.relativePath.startsWith("replay/"),
                    ),
                    "source file list is manifest + events segments only",
                ).to.equal(true);

                const projection = projectSource("diagSession", source, "team-default.v1");
                expect(JSON.stringify(projection)).to.not.include(SENTINEL);
            } finally {
                nodeFs.rmSync(sessionDir, { recursive: true, force: true });
            }
        });
    },
);
