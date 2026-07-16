/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Ring-vs-journal reconciliation (WI-2.6, addendum §10.3): the green case
 * plus one focused test per mismatch class — created/terminal counts, unique
 * ids (ring-only and journal-only beyond the eviction tolerance), pending at
 * shutdown, accepted, replay-tagged, redaction mode, timestamps, per-event
 * digest after the compatibility projection, and journal dropped ranges.
 */

import { expect } from "chai";
import { FeatureCaptureJournalReadResult } from "../../src/diagnostics/featureCapture/journal/journalReader";
import { reduceJournalRecords } from "../../src/diagnostics/featureCapture/journal/journalReducer";
import {
    FEATURE_CAPTURE_MANIFEST_SCHEMA,
    FEATURE_CAPTURE_RECORD_SCHEMA,
    FEATURE_CAPTURE_STREAM_SCHEMA,
    FeatureCaptureJournalRecordV1,
    FeatureCaptureManifestV1,
} from "../../src/diagnostics/featureCapture/journal/journalSchemas";
import {
    CaptureReconciliationReport,
    canonicalJson,
    digestOfFields,
    reconcileCaptureSession,
} from "../../src/diagnostics/featureCapture/journalReconciliation";
import {
    CompletionAcceptanceLiteV1,
    completionsReconciliationAdapter,
} from "../../src/copilot/inlineCompletionDebug/completionsJournalProjection";
import { RichCapturePolicySnapshot } from "../../src/sharedInterfaces/featureTrace";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugEventResult,
} from "../../src/sharedInterfaces/inlineCompletionDebug";
import { ObservabilityLinkV1 } from "../../src/sharedInterfaces/observabilityLink";

const EPOCH = "cs-reconcile-test";
const HOST = "hs-reconcile-test";

type AnyRecord = FeatureCaptureJournalRecordV1<
    InlineCompletionDebugEvent,
    InlineCompletionDebugEvent,
    CompletionAcceptanceLiteV1,
    Record<string, unknown>
>;

function link(ordinal: number): ObservabilityLinkV1 {
    return {
        schema: "mssql.observabilityLink/1",
        featureId: "completions",
        hostSessionId: HOST,
        captureSessionId: EPOCH,
        captureEventId: `ce-${ordinal}`,
    };
}

function makeEvent(
    ordinal: number,
    result: InlineCompletionDebugEventResult,
    extras: Partial<InlineCompletionDebugEvent> = {},
): InlineCompletionDebugEvent {
    return {
        id: `E-${ordinal}`,
        timestamp: 10_000 + ordinal,
        link: link(ordinal),
        documentUri: "file:///c/query.sql",
        documentFileName: "query.sql",
        line: 1,
        column: 1,
        triggerKind: "automatic",
        explicitFromUser: false,
        completionCategory: "continuation",
        intentMode: false,
        inferredSystemQuery: false,
        modelFamily: "fam",
        modelId: "model",
        modelVendor: "vendor",
        result,
        latencyMs: 20 + ordinal,
        inputTokens: 100,
        outputTokens: 10,
        schemaObjectCount: 0,
        schemaSystemObjectCount: 0,
        schemaForeignKeyCount: 0,
        usedSchemaContext: false,
        overridesApplied: { customSystemPromptUsed: false },
        promptMessages: [],
        rawResponse: "raw",
        sanitizedResponse: undefined,
        finalCompletionText: undefined,
        schemaContextFormatted: undefined,
        locals: {},
        ...extras,
    };
}

function makePolicy(
    fidelity: "fullLocal" | "contentRedacted" = "fullLocal",
): RichCapturePolicySnapshot {
    return {
        schema: "mssql.richCapturePolicy/1",
        policyId: `test/1:${fidelity}`,
        featureId: "completions",
        fidelity,
        persistence: "localJournal",
        source: "test",
        activatedAt: 1_000,
        replayPayloadAvailable: fidelity === "fullLocal",
    };
}

function header(fidelity: "fullLocal" | "contentRedacted" = "fullLocal"): AnyRecord {
    return {
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "stream.header",
        recordSeq: 0,
        featureId: "completions",
        hostSessionId: HOST,
        captureSessionId: EPOCH,
        eventSchema: "mssql.inlineCompletionDebugEvent/1",
        overridesSchema: "mssql.inlineCompletionDebugOverrides/1",
        capturePolicy: makePolicy(fidelity),
        createdUtc: "2026-07-16T00:00:00.000Z",
    };
}

/** The record stream the binding writes for one ring event's lifecycle. */
function recordsForEvent(
    ringEvent: InlineCompletionDebugEvent,
    startSeq: number,
    options: {
        /** Value stored in event.finalized; the ring event by default. */
        journalTerminalValue?: InlineCompletionDebugEvent;
        includeAcceptance?: boolean;
        pendingOnly?: boolean;
    } = {},
): AnyRecord[] {
    const captureEventId = ringEvent.link!.captureEventId;
    const pendingValue: InlineCompletionDebugEvent = { ...ringEvent, result: "pending" };
    const records: AnyRecord[] = [
        {
            schema: FEATURE_CAPTURE_RECORD_SCHEMA,
            kind: "event.created",
            recordSeq: startSeq,
            eventRevision: 1,
            captureEventId,
            at: ringEvent.timestamp,
            value: pendingValue,
        },
    ];
    if (options.pendingOnly) {
        return records;
    }
    const terminal = options.journalTerminalValue ?? {
        ...ringEvent,
        result: ringEvent.result === "accepted" ? "success" : ringEvent.result,
    };
    records.push({
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "event.finalized",
        recordSeq: startSeq + 1,
        eventRevision: 2,
        captureEventId,
        at: ringEvent.timestamp,
        value: terminal,
    });
    if (options.includeAcceptance) {
        records.push({
            schema: FEATURE_CAPTURE_RECORD_SCHEMA,
            kind: "acceptance.changed",
            recordSeq: startSeq + 2,
            eventRevision: 3,
            captureEventId,
            at: ringEvent.timestamp + 5,
            value: {
                state: "accepted",
                changedAt: ringEvent.timestamp + 5,
                source: "vscodeInlineApi",
            },
        });
    }
    return records;
}

function sequenced(records: AnyRecord[]): AnyRecord[] {
    return records.map((record, index) => ({ ...record, recordSeq: index }) as AnyRecord);
}

function readResult(
    records: AnyRecord[],
    manifest?: Partial<FeatureCaptureManifestV1>,
): FeatureCaptureJournalReadResult<unknown, unknown, unknown, Record<string, unknown>> {
    const state = reduceJournalRecords(sequenced(records));
    return {
        state: state as never,
        issues: [...state.issues],
        ...(manifest
            ? {
                  manifest: {
                      schema: FEATURE_CAPTURE_MANIFEST_SCHEMA,
                      streamSchema: FEATURE_CAPTURE_STREAM_SCHEMA,
                      stream: {
                          featureId: "completions",
                          hostSessionId: HOST,
                          captureSessionId: EPOCH,
                          eventSchema: "mssql.inlineCompletionDebugEvent/1",
                          overridesSchema: "mssql.inlineCompletionDebugOverrides/1",
                          capturePolicyId: "test/1:fullLocal",
                      },
                      status: "closed",
                      durability: "checkpointed",
                      segments: [],
                      droppedRanges: [],
                      totals: { records: 0, events: 0, bytes: 0, droppedRecords: 0 },
                      createdUtc: "2026-07-16T00:00:00.000Z",
                      updatedUtc: "2026-07-16T00:00:00.000Z",
                      ...manifest,
                  } as FeatureCaptureManifestV1,
              }
            : {}),
    };
}

/** Ring + matching journal: 1 accepted, 1 error, 1 replay-tagged, 1 pending. */
function greenFixture(): {
    ring: InlineCompletionDebugEvent[];
    journal: FeatureCaptureJournalReadResult<unknown, unknown, unknown, Record<string, unknown>>;
} {
    const accepted = makeEvent(1, "accepted");
    const errored = makeEvent(2, "error");
    const replayTagged = makeEvent(3, "success", {
        tags: { replayRunId: "rr-1", replayMatrixCellId: "cell-1" },
    });
    const pending = makeEvent(4, "pending");
    const records: AnyRecord[] = [
        header(),
        ...recordsForEvent(accepted, 0, { includeAcceptance: true }),
        ...recordsForEvent(errored, 0),
        ...recordsForEvent(replayTagged, 0),
        ...recordsForEvent(pending, 0, { pendingOnly: true }),
    ];
    return {
        ring: [accepted, errored, replayTagged, pending],
        journal: readResult(records),
    };
}

function row(report: CaptureReconciliationReport, field: string) {
    const found = report.rows.find((candidate) => candidate.field === field);
    expect(found, `row ${field} exists`).to.not.equal(undefined);
    return found!;
}

suite("Journal reconciliation (WI-2.6)", () => {
    test("green case: matched ring and journal reconcile exactly", async () => {
        const { ring, journal } = greenFixture();
        const report = await reconcileCaptureSession(
            ring,
            journal,
            completionsReconciliationAdapter,
            { expectedFidelity: "fullLocal" },
        );
        expect(report.mismatches, report.mismatches.join("; ")).to.have.length(0);
        expect(report.matches).to.equal(true);
        expect(row(report, "createdCount").ring).to.equal(4);
        expect(row(report, "terminalCount").ring).to.equal(3);
        expect(row(report, "pendingAtShutdown").ring).to.equal(1);
        expect(row(report, "acceptedCount").ring).to.equal(1);
        expect(row(report, "replayTaggedCount").ring).to.equal(1);
        expect(report.digest.compared).to.equal(3);
        expect(report.captureSessionId).to.equal(EPOCH);
    });

    test("mismatch: ring event missing from the journal (ring-only id)", async () => {
        const { ring, journal } = greenFixture();
        const extra = makeEvent(9, "success");
        const report = await reconcileCaptureSession(
            [...ring, extra],
            journal,
            completionsReconciliationAdapter,
        );
        expect(report.matches).to.equal(false);
        expect(report.digest.ringOnly).to.deep.equal(["ce-9"]);
        expect(row(report, "createdCount").match).to.equal(false);
        expect(row(report, "uniqueCaptureEventIds").match).to.equal(false);
    });

    test("journal-only events within the ring-eviction tolerance still match", async () => {
        const { ring, journal } = greenFixture();
        // Drop one terminal event from the ring, as if evicted.
        const evictedRing = ring.filter((event) => event.link?.captureEventId !== "ce-2");
        const tolerant = await reconcileCaptureSession(
            evictedRing,
            journal,
            completionsReconciliationAdapter,
            { ringEvictedCount: 1 },
        );
        expect(tolerant.matches, tolerant.mismatches.join("; ")).to.equal(true);
        expect(tolerant.digest.journalOnly).to.deep.equal(["ce-2"]);

        const strict = await reconcileCaptureSession(
            evictedRing,
            journal,
            completionsReconciliationAdapter,
            { ringEvictedCount: 0 },
        );
        expect(strict.matches).to.equal(false);
        expect(row(strict, "uniqueCaptureEventIds").match).to.equal(false);
    });

    test("mismatch: terminal state lost (journal holds only the pending record)", async () => {
        const accepted = makeEvent(1, "success");
        const journal = readResult([
            header(),
            ...recordsForEvent(accepted, 0, { pendingOnly: true }),
        ]);
        const report = await reconcileCaptureSession(
            [accepted],
            journal,
            completionsReconciliationAdapter,
        );
        expect(report.matches).to.equal(false);
        expect(row(report, "terminalCount").match).to.equal(false);
        expect(row(report, "pendingAtShutdown").match).to.equal(false);
    });

    test("mismatch: acceptance lost (no acceptance.changed record)", async () => {
        const accepted = makeEvent(1, "accepted");
        const journal = readResult([header(), ...recordsForEvent(accepted, 0)]);
        const report = await reconcileCaptureSession(
            [accepted],
            journal,
            completionsReconciliationAdapter,
        );
        expect(report.matches).to.equal(false);
        expect(row(report, "acceptedCount").match).to.equal(false);
    });

    test("mismatch: replay tag lost from the journal value", async () => {
        const tagged = makeEvent(1, "success", { tags: { replayRunId: "rr-1" } });
        const untaggedValue = { ...tagged };
        delete untaggedValue.tags;
        const journal = readResult([
            header(),
            ...recordsForEvent(tagged, 0, { journalTerminalValue: untaggedValue }),
        ]);
        const report = await reconcileCaptureSession(
            [tagged],
            journal,
            completionsReconciliationAdapter,
        );
        expect(report.matches).to.equal(false);
        expect(row(report, "replayTaggedCount").match).to.equal(false);
    });

    test("mismatch: redaction mode disagrees with the stream header", async () => {
        const event = makeEvent(1, "success");
        const journal = readResult([header("fullLocal"), ...recordsForEvent(event, 0)]);
        const report = await reconcileCaptureSession(
            [event],
            journal,
            completionsReconciliationAdapter,
            { expectedFidelity: "contentRedacted" },
        );
        expect(report.matches).to.equal(false);
        expect(row(report, "redactionMode").match).to.equal(false);
    });

    test("mismatch: per-event digest after compatibility projection", async () => {
        const event = makeEvent(1, "success");
        const tampered = { ...event, latencyMs: event.latencyMs + 1 };
        const journal = readResult([
            header(),
            ...recordsForEvent(event, 0, { journalTerminalValue: tampered }),
        ]);
        const report = await reconcileCaptureSession(
            [event],
            journal,
            completionsReconciliationAdapter,
        );
        expect(report.matches).to.equal(false);
        expect(report.digest.mismatched).to.deep.equal(["ce-1"]);
        expect(row(report, "eventDigest").match).to.equal(false);
    });

    test("mismatch: timestamps disagree", async () => {
        const event = makeEvent(1, "success");
        const shifted = { ...event, timestamp: event.timestamp + 500 };
        const journal = readResult([
            header(),
            ...recordsForEvent(event, 0, { journalTerminalValue: shifted }),
        ]);
        const report = await reconcileCaptureSession(
            [event],
            journal,
            completionsReconciliationAdapter,
        );
        expect(report.matches).to.equal(false);
        expect(row(report, "lastTimestamp").match).to.equal(false);
    });

    test("mismatch: journal dropped ranges block cutover", async () => {
        const { ring, journal: green } = greenFixture();
        const journal = readResult(
            // Rebuild the same records but attach a manifest with a drop.
            [],
            {
                droppedRanges: [
                    { fromRecordSeq: 5, throughRecordSeq: 6, reason: "queueOverflowRecords" },
                ],
            },
        );
        // Reuse the green state, only the manifest differs.
        journal.state = green.state;
        const report = await reconcileCaptureSession(
            ring,
            journal,
            completionsReconciliationAdapter,
        );
        expect(report.matches).to.equal(false);
        expect(row(report, "droppedRecords").match).to.equal(false);
        expect(report.droppedRanges).to.have.length(1);
    });

    test("linkless ring events are excluded with an explicit count", async () => {
        const { ring, journal } = greenFixture();
        const linkless = makeEvent(8, "success");
        delete linkless.link;
        const report = await reconcileCaptureSession(
            [...ring, linkless],
            journal,
            completionsReconciliationAdapter,
        );
        expect(report.ringLinklessExcluded).to.equal(1);
        expect(report.matches, report.mismatches.join("; ")).to.equal(true);
    });

    test("canonical digest is key-order independent", () => {
        expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).to.equal(
            canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }),
        );
        expect(digestOfFields({ a: 1, b: undefined })).to.equal(digestOfFields({ a: 1 }));
    });
});
