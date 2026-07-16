/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions stored-session provider (WI-2.5): manifest-only enumeration
 * (fake fs proves no segment is opened during a scan), bundle-only session
 * directories admitted, current-epoch exclusion, load = journal reader →
 * reducer → compatibility projection equal to what the binding wrote, and
 * the SessionStore.listLocalSessions WI-2.3 gap fix (bundle.json-only
 * session directories are admitted for retention/clear/validation).
 */

import { expect } from "chai";
import * as nodeFs from "fs";
import * as os from "os";
import * as nodePath from "path";
import { FeatureCaptureStore } from "../../src/diagnostics/featureCapture/captureStore";
import { FeatureCaptureJournalBinding } from "../../src/diagnostics/featureCapture/captureJournalBinding";
import { deepEqual } from "../../src/diagnostics/featureCapture/journal/journalReducer";
import {
    FEATURE_CAPTURE_MANIFEST_SCHEMA,
    FEATURE_CAPTURE_STREAM_SCHEMA,
    FeatureCaptureManifestV1,
} from "../../src/diagnostics/featureCapture/journal/journalSchemas";
import { SessionStore } from "../../src/diagnostics/sessionStore";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import {
    COMPLETIONS_JOURNAL_EVENT_SCHEMA,
    COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
    buildCompletionsCapturePolicy,
    isTerminalCompletionResult,
    redactCompletionEventForJournal,
} from "../../src/copilot/inlineCompletionDebug/completionsJournalProjection";
import {
    STORED_SESSION_FILE_KEY_PREFIX,
    configureCompletionsStoredSessions,
    listStoredCompletionSessionEntries,
    loadStoredCompletionSessionTrace,
} from "../../src/copilot/inlineCompletionDebug/storedSessionProvider";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventResult,
} from "../../src/sharedInterfaces/inlineCompletionDebug";
import { ObservabilityLinkV1 } from "../../src/sharedInterfaces/observabilityLink";
import { ManualClock, MemJournalFs } from "./support/memJournalFs";

const STORE_ROOT = "C:/stored-session-store";
const LIVE_EPOCH = "cs-live-epoch";

function manifestJson(
    captureSessionId: string,
    overrides: Partial<FeatureCaptureManifestV1> = {},
): string {
    const manifest: FeatureCaptureManifestV1 = {
        schema: FEATURE_CAPTURE_MANIFEST_SCHEMA,
        streamSchema: FEATURE_CAPTURE_STREAM_SCHEMA,
        stream: {
            featureId: "completions",
            hostSessionId: "hs-old",
            captureSessionId,
            eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
            overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
            capturePolicyId: "completions.trace/1:localJournal:fullLocal",
        },
        status: "closed",
        durability: "checkpointed",
        segments: [
            {
                file: "segment-000001.jsonl",
                firstRecordSeq: 0,
                lastRecordSeq: 4,
                records: 5,
                events: 2,
                bytes: 2_048,
                status: "closed",
                capturePolicyId: "completions.trace/1:localJournal:fullLocal",
            },
        ],
        droppedRanges: [],
        totals: { records: 5, events: 2, bytes: 2_048, droppedRecords: 0 },
        createdUtc: "2026-07-10T10:00:00.000Z",
        updatedUtc: "2026-07-10T10:05:00.000Z",
        closedUtc: "2026-07-10T10:05:00.000Z",
        ...overrides,
    };
    return JSON.stringify(manifest);
}

function configure(fs: MemJournalFs): void {
    configureCompletionsStoredSessions({
        storeRoot: STORE_ROOT,
        isCurrentEpoch: (captureSessionId) => captureSessionId === LIVE_EPOCH,
        fs,
    });
}

function makeEvent(
    link: ObservabilityLinkV1,
    result: InlineCompletionDebugEventResult,
): Omit<InlineCompletionDebugEvent, "id"> {
    return {
        timestamp: 20_000,
        link,
        documentUri: "file:///c/query.sql",
        documentFileName: "query.sql",
        line: 1,
        column: 1,
        triggerKind: "invoke",
        explicitFromUser: true,
        completionCategory: "continuation",
        intentMode: false,
        inferredSystemQuery: false,
        modelFamily: "fam",
        modelId: "model",
        modelVendor: "vendor",
        result,
        latencyMs: 33,
        inputTokens: 50,
        outputTokens: 5,
        schemaObjectCount: 0,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 0,
        usedSchemaContext: false,
        overridesApplied: { customSystemPromptUsed: false },
        promptMessages: [{ role: "user", content: "SELECT 1" }],
        rawResponse: "raw",
        sanitizedResponse: undefined,
        finalCompletionText: "final",
        schemaContextFormatted: undefined,
        locals: {},
    };
}

suite("Completions stored session provider (WI-2.5)", () => {
    teardown(() => {
        configureCompletionsStoredSessions(undefined);
    });

    test("manifest-only enumeration: entries come from manifests, segments are never opened", async () => {
        const fs = new MemJournalFs();
        fs.files.set(
            `${STORE_ROOT}/sessions/hs-old/rich/completions/cs-old/manifest.json`,
            manifestJson("cs-old"),
        );
        fs.files.set(
            `${STORE_ROOT}/sessions/hs-old/rich/completions/cs-old/segment-000001.jsonl`,
            '{"never":"parsed during scan"}\n',
        );
        // Bundle-only session directory: no diag manifest.json, only rich/.
        fs.files.set(`${STORE_ROOT}/sessions/hs-bundle-only/bundle.json`, "{}");
        fs.files.set(
            `${STORE_ROOT}/sessions/hs-bundle-only/rich/completions/cs-bundle/manifest.json`,
            manifestJson("cs-bundle", {
                totals: { records: 3, events: 1, bytes: 512, droppedRecords: 0 },
            }),
        );
        // The LIVE epoch's stream: excluded (it is the ring's data).
        fs.files.set(
            `${STORE_ROOT}/sessions/hs-live/rich/completions/${LIVE_EPOCH}/manifest.json`,
            manifestJson(LIVE_EPOCH),
        );
        // A policy-phase sibling of the live epoch: also excluded (manifest
        // carries the epoch id even though the directory name differs).
        fs.files.set(
            `${STORE_ROOT}/sessions/hs-live/rich/completions/${LIVE_EPOCH}--2/manifest.json`,
            manifestJson(LIVE_EPOCH),
        );
        configure(fs);

        const entries = await listStoredCompletionSessionEntries();
        expect(entries.map((entry) => entry.sessionId).sort()).to.deep.equal([
            "cs-bundle",
            "cs-old",
        ]);

        const oldEntry = entries.find((entry) => entry.sessionId === "cs-old")!;
        expect(oldEntry.fileKey).to.equal(`${STORED_SESSION_FILE_KEY_PREFIX}hs-old/cs-old`);
        expect(oldEntry.sourceKind).to.equal("storedSession");
        expect(oldEntry.eventCount).to.equal(2);
        expect(oldEntry.recordCount).to.equal(5);
        expect(oldEntry.fileSizeBytes).to.equal(2_048);
        expect(oldEntry.capturePolicyId).to.equal("completions.trace/1:localJournal:fullLocal");
        expect(oldEntry.savedAt).to.equal("2026-07-10T10:05:00.000Z");
        expect(oldEntry.dateRange).to.equal(undefined); // no segment parse
        expect(oldEntry.included).to.equal(false); // opt-in by default
        expect(oldEntry.imported).to.equal(false);

        // The manifest-only guarantee: no read op ever touched a segment.
        const readPaths = fs.ops.filter((op) => op.op === "read").map((op) => op.path);
        expect(readPaths.length).to.be.greaterThan(0);
        expect(readPaths.every((path) => path.endsWith("/manifest.json"))).to.equal(true);
    });

    test("include state survives refresh via includedFileKeys", async () => {
        const fs = new MemJournalFs();
        fs.files.set(
            `${STORE_ROOT}/sessions/hs-old/rich/completions/cs-old/manifest.json`,
            manifestJson("cs-old"),
        );
        configure(fs);
        const fileKey = `${STORED_SESSION_FILE_KEY_PREFIX}hs-old/cs-old`;
        const entries = await listStoredCompletionSessionEntries({
            includedFileKeys: new Set([fileKey]),
            hadExistingIndex: true,
        });
        expect(entries[0].included).to.equal(true);
    });

    test("unconfigured provider lists nothing (Sessions dataset unaffected)", async () => {
        configureCompletionsStoredSessions(undefined);
        expect(await listStoredCompletionSessionEntries()).to.deep.equal([]);
    });

    test("stored-session load projects exactly what the binding wrote", async () => {
        const fs = new MemJournalFs();
        const store = new FeatureCaptureStore<InlineCompletionDebugEvent, { note: string | null }>({
            logName: "StoredSessionTest",
            featureId: "completions",
            defaultOverrides: { note: null },
            normalizeOverrides: (overrides) => ({ note: overrides.note ?? null }),
            normalizePartialOverrides: (overrides) => overrides,
        });
        const binding = new FeatureCaptureJournalBinding<
            InlineCompletionDebugEvent,
            { note: string | null }
        >({
            store,
            storeRoot: STORE_ROOT,
            // Must match the links createEventLink stamps (diag.sessionId),
            // exactly as the production wiring does.
            hostSessionId: diag.sessionId,
            eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
            overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
            policyProvider: () =>
                buildCompletionsCapturePolicy({
                    traceCaptureEnabled: true,
                    redactPrompts: false,
                    viewerArmed: true,
                    activatedAt: 1_000,
                }),
            redactEventValue: redactCompletionEventForJournal,
            isTerminal: (event) => isTerminalCompletionResult(event.result),
            fs,
            clock: new ManualClock(),
            writerOptions: { flushIntervalMs: 60_000 },
        });

        const link1 = store.createEventLink();
        const pending = store.addEvent(makeEvent(link1, "pending"));
        store.updateEvent(pending.id, makeEvent(link1, "success"));
        const link2 = store.createEventLink();
        store.addEvent(makeEvent(link2, "skipped"));
        const ringEvents = store.getEvents();
        const streamDir =
            binding.currentEpochStreamDirectories[0] ?? binding.currentStreamDirectory;
        await binding.dispose(); // flush + close = a finished stored session

        configureCompletionsStoredSessions({
            storeRoot: STORE_ROOT,
            isCurrentEpoch: () => false, // the writing epoch is over
            fs,
        });
        const entries = await listStoredCompletionSessionEntries();
        expect(entries).to.have.length(1);
        expect(entries[0].path).to.equal(streamDir);
        expect(entries[0].eventCount).to.equal(2);

        const trace = await loadStoredCompletionSessionTrace(entries[0]);
        expect(trace.version).to.equal(1);
        expect(trace.events).to.have.length(2);
        expect(deepEqual(trace.events[0], ringEvents[0])).to.equal(true);
        expect(deepEqual(trace.events[1], ringEvents[1])).to.equal(true);
    });
});

suite("Stored session store admission (WI-2.5 / WI-2.3 gap fix)", () => {
    test("listLocalSessions admits bundle.json-only session directories", () => {
        const root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "mssql-store-gap-"));
        try {
            const diagSession = nodePath.join(root, "sessions", "hs-diag");
            nodeFs.mkdirSync(diagSession, { recursive: true });
            nodeFs.writeFileSync(
                nodePath.join(diagSession, "manifest.json"),
                JSON.stringify({
                    schemaVersion: "mssql.diag.sessionManifest/1",
                    sessionId: "hs-diag",
                    createdUtc: "2026-07-12T00:00:00.000Z",
                    updatedUtc: "2026-07-12T00:01:00.000Z",
                    source: "live",
                    captureMode: "redacted",
                    policyId: "default/1",
                    eventCount: 3,
                    gapCount: 0,
                    segments: [],
                    provenance: {},
                    status: "closed",
                }),
            );

            const bundleOnly = nodePath.join(root, "sessions", "hs-bundle-only");
            nodeFs.mkdirSync(nodePath.join(bundleOnly, "rich", "completions", "cs-b"), {
                recursive: true,
            });
            nodeFs.writeFileSync(
                nodePath.join(bundleOnly, "bundle.json"),
                JSON.stringify({
                    schema: "mssql.observability.bundle/1",
                    bundleId: "ob-test",
                    hostSessionId: "hs-bundle-only",
                    createdUtc: "2026-07-13T00:00:00.000Z",
                    updatedUtc: "2026-07-13T00:02:00.000Z",
                    status: "closed",
                    provenance: {},
                    artifacts: [],
                    totals: { artifacts: 1, bytes: 4_096, gaps: 0, truncations: 0 },
                }),
            );

            // Neither manifest nor bundle: stays invisible (never delete silently).
            nodeFs.mkdirSync(nodePath.join(root, "sessions", "hs-junk"), { recursive: true });

            const store = new SessionStore(root);
            const sessions = store.listLocalSessions();
            expect(sessions.map((session) => session.manifest.sessionId).sort()).to.deep.equal([
                "hs-bundle-only",
                "hs-diag",
            ]);
            const synthesized = sessions.find(
                (session) => session.manifest.sessionId === "hs-bundle-only",
            )!;
            expect(synthesized.manifest.source).to.equal("bundle");
            expect(synthesized.manifest.eventCount).to.equal(0);
            expect(synthesized.manifest.sizeBytes).to.equal(4_096);
            expect(synthesized.manifest.status).to.equal("closed");
        } finally {
            nodeFs.rmSync(root, { recursive: true, force: true });
        }
    });
});
