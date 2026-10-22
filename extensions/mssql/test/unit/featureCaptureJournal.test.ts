/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Feature-capture journal schemas + lifecycle reducer (final plan WI-2.1 /
 * addendum §3.5): golden fixtures for the frozen record/manifest schemas and
 * every legal + illegal lifecycle transition through the pure reducer.
 * Writer/reader/fault-injection coverage lives in
 * featureCaptureJournalWriter.test.ts.
 */

import { expect } from "chai";
import {
    DEFAULT_CONTENT_BEARING_KEYS,
    applyJournalRecord,
    createJournalReducerState,
    deepEqual,
    projectEvents,
    reduceJournalRecords,
} from "../../src/diagnostics/featureCapture/journal/journalReducer";
import {
    FEATURE_CAPTURE_MANIFEST_SCHEMA,
    FEATURE_CAPTURE_RECORD_SCHEMA,
    FEATURE_CAPTURE_STREAM_SCHEMA,
    FeatureCaptureAcceptanceChangedRecordV1,
    FeatureCaptureAnnotationAddedRecordV1,
    FeatureCaptureEventCreatedRecordV1,
    FeatureCaptureEventFinalizedRecordV1,
    FeatureCaptureJournalRecordV1,
    FeatureCaptureManifestV1,
    FeatureCaptureStreamHeaderRecordV1,
    isJournalRecordShape,
} from "../../src/diagnostics/featureCapture/journal/journalSchemas";
import { RichCapturePolicySnapshot } from "../../src/sharedInterfaces/featureTrace";

// ---------------------------------------------------------------------------
// Fake feature event shapes (the reducer is featureId-agnostic — WI-2.1)
// ---------------------------------------------------------------------------

interface FakeCreated {
    link?: {
        captureEventId?: string;
        captureSessionId?: string;
        hostSessionId?: string;
        featureId?: string;
    };
    trigger: string;
    userPrompt?: string;
}

interface FakeFinal {
    link?: { captureEventId?: string; captureSessionId?: string };
    result: string;
    latencyMs?: number;
    rawResponse?: string;
}

interface FakeAcceptance {
    state: "accepted" | "notAccepted";
    changedAt?: number;
}

type FakeAnnotation = Record<string, unknown>;

type FakeRecord = FeatureCaptureJournalRecordV1<
    FakeCreated,
    FakeFinal,
    FakeAcceptance,
    FakeAnnotation
>;

export function makeTestPolicy(
    fidelity: RichCapturePolicySnapshot["fidelity"],
): RichCapturePolicySnapshot {
    return {
        schema: "mssql.richCapturePolicy/1",
        policyId: `policy-${fidelity}`,
        featureId: "journalTest",
        fidelity,
        persistence: "localJournal",
        source: "test",
        activatedAt: 1_000,
        replayPayloadAvailable: fidelity === "fullLocal",
    };
}

function makeHeader(
    overrides: Partial<FeatureCaptureStreamHeaderRecordV1> = {},
): FeatureCaptureStreamHeaderRecordV1 {
    return {
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "stream.header",
        recordSeq: 0,
        featureId: "journalTest",
        hostSessionId: "hs-test",
        captureSessionId: "cs-journal-test",
        eventSchema: "test.event/1",
        overridesSchema: "test.overrides/1",
        capturePolicy: makeTestPolicy("fullLocal"),
        createdUtc: "2026-07-16T00:00:00.000Z",
        ...overrides,
    };
}

function created(
    recordSeq: number,
    captureEventId: string,
    value: FakeCreated,
): FeatureCaptureEventCreatedRecordV1<FakeCreated> {
    return {
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "event.created",
        recordSeq,
        eventRevision: 1,
        captureEventId,
        at: 10_000 + recordSeq,
        value,
    };
}

function finalized(
    recordSeq: number,
    captureEventId: string,
    eventRevision: number,
    value: FakeFinal,
): FeatureCaptureEventFinalizedRecordV1<FakeFinal> {
    return {
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "event.finalized",
        recordSeq,
        eventRevision,
        captureEventId,
        at: 10_000 + recordSeq,
        value,
    };
}

function acceptance(
    recordSeq: number,
    captureEventId: string,
    eventRevision: number,
    value: FakeAcceptance,
): FeatureCaptureAcceptanceChangedRecordV1<FakeAcceptance> {
    return {
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "acceptance.changed",
        recordSeq,
        eventRevision,
        captureEventId,
        at: 10_000 + recordSeq,
        value,
    };
}

function annotation(
    recordSeq: number,
    captureEventId: string,
    eventRevision: number,
    value: FakeAnnotation,
): FeatureCaptureAnnotationAddedRecordV1<FakeAnnotation> {
    return {
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "annotation.added",
        recordSeq,
        eventRevision,
        captureEventId,
        at: 10_000 + recordSeq,
        value,
    };
}

function issueCodes(state: { issues: Array<{ code: string }> }): string[] {
    return state.issues.map((issue) => issue.code);
}

// ---------------------------------------------------------------------------
// Schema golden fixtures
// ---------------------------------------------------------------------------

suite("Feature capture journal schemas (WI-2.1)", () => {
    test("frozen schema ids match the final plan §1.4", () => {
        expect(FEATURE_CAPTURE_STREAM_SCHEMA).to.equal("mssql.featureCapture.stream/1");
        expect(FEATURE_CAPTURE_RECORD_SCHEMA).to.equal("mssql.featureCapture.record/1");
        expect(FEATURE_CAPTURE_MANIFEST_SCHEMA).to.equal("mssql.featureCapture.manifest/1");
    });

    test("every record kind survives a serialize→parse round trip byte-equal", () => {
        const fixtures: FakeRecord[] = [
            makeHeader(),
            created(1, "ce-1", {
                link: { captureEventId: "ce-1", captureSessionId: "cs-journal-test" },
                trigger: "typing",
                userPrompt: "SELECT * FROM",
            }),
            finalized(2, "ce-1", 2, {
                link: { captureEventId: "ce-1" },
                result: "success",
                latencyMs: 412,
                rawResponse: "Orders WHERE 1=1",
            }),
            acceptance(3, "ce-1", 3, { state: "accepted", changedAt: 10_500 }),
            annotation(4, "ce-1", 4, { replayRunId: "rr-1", note: "matrix cell A" }),
        ];
        for (const fixture of fixtures) {
            const parsed = JSON.parse(JSON.stringify(fixture)) as FakeRecord;
            expect(parsed).to.deep.equal(fixture);
            expect(isJournalRecordShape(parsed)).to.equal(true);
        }
        expect(isJournalRecordShape({ kind: "event.created" })).to.equal(false);
        expect(isJournalRecordShape("nope")).to.equal(false);
        expect(isJournalRecordShape(null)).to.equal(false);
    });

    test("child manifest fixture round-trips with segments, drops, and totals", () => {
        const manifest: FeatureCaptureManifestV1 = {
            schema: FEATURE_CAPTURE_MANIFEST_SCHEMA,
            streamSchema: FEATURE_CAPTURE_STREAM_SCHEMA,
            stream: {
                featureId: "journalTest",
                hostSessionId: "hs-test",
                captureSessionId: "cs-journal-test",
                eventSchema: "test.event/1",
                overridesSchema: "test.overrides/1",
                capturePolicyId: "policy-fullLocal",
            },
            status: "partial",
            durability: "checkpointed",
            segments: [
                {
                    file: "segment-000001.jsonl",
                    firstRecordSeq: 0,
                    lastRecordSeq: 4_999,
                    records: 5_000,
                    events: 2_400,
                    bytes: 1_048_576,
                    status: "closed",
                    sha256: "ab".repeat(32),
                    capturePolicyId: "policy-fullLocal",
                },
                {
                    file: "segment-000002.jsonl",
                    firstRecordSeq: 5_000,
                    lastRecordSeq: 5_120,
                    records: 118,
                    events: 60,
                    bytes: 24_400,
                    status: "active",
                    capturePolicyId: "policy-fullLocal",
                },
            ],
            droppedRanges: [
                { fromRecordSeq: 5_010, throughRecordSeq: 5_012, reason: "queueOverflowRecords" },
            ],
            totals: { records: 5_118, events: 2_460, bytes: 1_072_976, droppedRecords: 3 },
            createdUtc: "2026-07-16T00:00:00.000Z",
            updatedUtc: "2026-07-16T00:05:00.000Z",
            closedUtc: "2026-07-16T00:05:00.000Z",
        };
        const parsed = JSON.parse(JSON.stringify(manifest)) as FeatureCaptureManifestV1;
        expect(parsed).to.deep.equal(manifest);
    });
});

// ---------------------------------------------------------------------------
// Lifecycle reducer
// ---------------------------------------------------------------------------

suite("Feature capture journal reducer (WI-2.1)", () => {
    test("full legal lifecycle: header → created → finalized → acceptance → annotation", () => {
        const state = reduceJournalRecords<FakeCreated, FakeFinal, FakeAcceptance, FakeAnnotation>([
            makeHeader(),
            created(1, "ce-1", { trigger: "typing" }),
            finalized(2, "ce-1", 2, { result: "success", latencyMs: 300 }),
            acceptance(3, "ce-1", 3, { state: "accepted" }),
            annotation(4, "ce-1", 4, { note: "nice" }),
        ]);

        expect(state.issues).to.deep.equal([]);
        expect(state.recordsApplied).to.equal(5);
        expect(state.recordsRejected).to.equal(0);
        expect(state.header?.captureSessionId).to.equal("cs-journal-test");
        expect(state.order).to.deep.equal(["ce-1"]);

        const event = state.events.get("ce-1");
        expect(event?.eventRevision).to.equal(4);
        expect(event?.createdValue?.trigger).to.equal("typing");
        expect(event?.finalizedValue?.result).to.equal("success");
        expect(event?.acceptance?.state).to.equal("accepted");
        expect(event?.annotations.length).to.equal(1);
        expect(event?.firstRecordSeq).to.equal(1);
        expect(event?.lastRecordSeq).to.equal(4);
    });

    test("duplicate created with identical payload is a silent idempotent no-op", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        expect(applyJournalRecord(state, created(1, "ce-1", { trigger: "typing" }))).to.equal(true);
        expect(applyJournalRecord(state, created(2, "ce-1", { trigger: "typing" }))).to.equal(
            false,
        );
        expect(state.issues).to.deep.equal([]);
        expect(state.events.size).to.equal(1);
        expect(state.order).to.deep.equal(["ce-1"]);
    });

    test("duplicate created with a DIFFERENT payload is rejected with an issue; original kept", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        applyJournalRecord(state, created(1, "ce-1", { trigger: "typing" }));
        expect(applyJournalRecord(state, created(2, "ce-1", { trigger: "invoke" }))).to.equal(
            false,
        );
        expect(issueCodes(state)).to.deep.equal(["event.duplicateCreated"]);
        expect(state.events.get("ce-1")?.createdValue?.trigger).to.equal("typing");
        expect(state.recordsRejected).to.equal(1);
    });

    test("stale revisions are idempotent skips for finalized, acceptance, and annotation", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        applyJournalRecord(state, created(1, "ce-1", { trigger: "typing" }));
        applyJournalRecord(state, finalized(2, "ce-1", 3, { result: "success" }));

        // Revision 2 arrives late (out of revision order): skipped, state kept.
        expect(applyJournalRecord(state, finalized(3, "ce-1", 2, { result: "error" }))).to.equal(
            false,
        );
        expect(applyJournalRecord(state, acceptance(4, "ce-1", 3, { state: "accepted" }))).to.equal(
            false,
        );
        expect(applyJournalRecord(state, annotation(5, "ce-1", 1, { note: "x" }))).to.equal(false);

        const event = state.events.get("ce-1");
        expect(event?.finalizedValue?.result).to.equal("success");
        expect(event?.acceptance).to.equal(undefined);
        expect(event?.annotations).to.deep.equal([]);
        expect(event?.eventRevision).to.equal(3);
        expect(issueCodes(state)).to.deep.equal([
            "event.staleRevision",
            "event.staleRevision",
            "event.staleRevision",
        ]);
    });

    test("finalized cannot alter immutable identity fields — record rejected", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        applyJournalRecord(
            state,
            created(1, "ce-1", {
                link: { captureEventId: "ce-1", captureSessionId: "cs-journal-test" },
                trigger: "typing",
            }),
        );

        // The finalized value claims a DIFFERENT captureEventId in its link.
        const applied = applyJournalRecord(
            state,
            finalized(2, "ce-1", 2, {
                link: { captureEventId: "ce-OTHER" },
                result: "success",
            }),
        );
        expect(applied).to.equal(false);
        expect(issueCodes(state)).to.deep.equal(["event.identityMutation"]);
        expect(state.events.get("ce-1")?.finalizedValue).to.equal(undefined);
        expect(state.events.get("ce-1")?.eventRevision).to.equal(1);

        // A foreign captureSessionId is equally immutable (header identity).
        const foreign = applyJournalRecord(
            state,
            finalized(3, "ce-1", 2, {
                link: { captureEventId: "ce-1", captureSessionId: "cs-foreign" },
                result: "success",
            }),
        );
        expect(foreign).to.equal(false);
        expect(issueCodes(state)).to.deep.equal([
            "event.identityMutation",
            "event.identityMutation",
        ]);
    });

    test("acceptance before finalized is HELD, surfaced, and applied at finalization", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        applyJournalRecord(state, created(1, "ce-1", { trigger: "typing" }));

        expect(applyJournalRecord(state, acceptance(2, "ce-1", 3, { state: "accepted" }))).to.equal(
            false,
        );
        expect(issueCodes(state)).to.deep.equal(["acceptance.beforeFinalized"]);
        expect(state.pendingAcceptances.size).to.equal(1);
        expect(state.events.get("ce-1")?.acceptance).to.equal(undefined);

        expect(applyJournalRecord(state, finalized(3, "ce-1", 2, { result: "success" }))).to.equal(
            true,
        );
        const event = state.events.get("ce-1");
        expect(event?.acceptance?.state).to.equal("accepted");
        expect(event?.eventRevision).to.equal(3);
        expect(state.pendingAcceptances.size).to.equal(0);
    });

    test("redacted streams never regain plain content — resurrection rejected", () => {
        const redactedState = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(
            redactedState,
            makeHeader({ capturePolicy: makeTestPolicy("contentRedacted") }),
        );
        // Redacted content is fine — the token is not plain content.
        expect(
            applyJournalRecord(
                redactedState,
                created(1, "ce-1", { trigger: "typing", userPrompt: "[REDACTED]" }),
            ),
        ).to.equal(true);
        // A later record with plain content under a content-bearing key: rejected.
        expect(
            applyJournalRecord(
                redactedState,
                finalized(2, "ce-1", 2, { result: "success", rawResponse: "SELECT secret" }),
            ),
        ).to.equal(false);
        expect(issueCodes(redactedState)).to.deep.equal(["redaction.resurrection"]);
        expect(redactedState.events.get("ce-1")?.finalizedValue).to.equal(undefined);
        expect(DEFAULT_CONTENT_BEARING_KEYS.has("rawResponse")).to.equal(true);

        // Nested plain content (promptMessages[].content) is also caught.
        expect(
            applyJournalRecord(
                redactedState,
                annotation(3, "ce-1", 2, {
                    promptMessages: [{ role: "user", content: "full text" }],
                }),
            ),
        ).to.equal(false);
        expect(issueCodes(redactedState)).to.deep.equal([
            "redaction.resurrection",
            "redaction.resurrection",
        ]);

        // The same records are legal under a fullLocal header.
        const fullState = reduceJournalRecords<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >([
            makeHeader(),
            created(1, "ce-1", { trigger: "typing", userPrompt: "SELECT" }),
            finalized(2, "ce-1", 2, { result: "success", rawResponse: "SELECT secret" }),
        ]);
        expect(fullState.issues).to.deep.equal([]);
        expect(fullState.events.get("ce-1")?.finalizedValue?.rawResponse).to.equal("SELECT secret");
    });

    test("unknown future record kinds and schemas are tolerated and counted", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        const futureKind = {
            schema: FEATURE_CAPTURE_RECORD_SCHEMA,
            kind: "event.futureThing",
            recordSeq: 1,
            eventRevision: 1,
            captureEventId: "ce-1",
            at: 1,
            value: {},
        } as unknown as FakeRecord;
        const futureSchema = {
            schema: "mssql.featureCapture.record/9",
            kind: "event.created",
            recordSeq: 2,
            eventRevision: 1,
            captureEventId: "ce-2",
            at: 2,
            value: {},
        } as unknown as FakeRecord;

        expect(applyJournalRecord(state, futureKind)).to.equal(false);
        expect(applyJournalRecord(state, futureSchema)).to.equal(false);
        expect(state.unknownKindCount).to.equal(1);
        expect(state.unknownSchemaCount).to.equal(1);
        expect(state.events.size).to.equal(0);
        expect(state.recordsRejected).to.equal(0); // tolerated, not rejected
        expect(issueCodes(state)).to.deep.equal(["record.unknownKind", "record.unknownSchema"]);
        expect(state.issues.every((issue) => issue.severity === "info")).to.equal(true);
    });

    test("out-of-order and gapped recordSeq are surfaced; expected gaps are not", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        applyJournalRecord(state, created(5, "ce-1", { trigger: "typing" }));
        expect(issueCodes(state)).to.deep.equal(["record.seqGap"]);

        // Lower-than-last seq: out of order (still applied idempotently).
        applyJournalRecord(state, created(3, "ce-2", { trigger: "invoke" }));
        expect(issueCodes(state)).to.deep.equal(["record.seqGap", "record.outOfOrder"]);
        expect(state.events.size).to.equal(2);

        // The same gap is silent when the manifest's dropped ranges cover it.
        const covered = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        const options = { expectedGaps: [{ fromRecordSeq: 1, throughRecordSeq: 4 }] };
        applyJournalRecord(covered, makeHeader(), options);
        applyJournalRecord(covered, created(5, "ce-1", { trigger: "typing" }), options);
        expect(covered.issues).to.deep.equal([]);
    });

    test("records for an unknown event materialize a placeholder; created backfills later", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());

        // created was lost (e.g. dropped range) — finalized still lands.
        expect(applyJournalRecord(state, finalized(3, "ce-1", 2, { result: "success" }))).to.equal(
            true,
        );
        expect(issueCodes(state)).to.contain("event.missingCreated");
        const event = state.events.get("ce-1");
        expect(event?.createdValue).to.equal(undefined);
        expect(event?.finalizedValue?.result).to.equal("success");

        // The created arrives late: backfilled without regressing revision.
        applyJournalRecord(state, created(1, "ce-1", { trigger: "typing" }));
        expect(state.events.get("ce-1")?.createdValue?.trigger).to.equal("typing");
        expect(state.events.get("ce-1")?.eventRevision).to.equal(2);
        expect(state.order).to.deep.equal(["ce-1"]);
    });

    test("stream identity is frozen at recordSeq 0: differing second header rejected", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        // Identical duplicate header: silent idempotent no-op.
        expect(applyJournalRecord(state, makeHeader())).to.equal(false);
        expect(state.issues).to.deep.equal([]);
        // Differing header: rejected.
        expect(applyJournalRecord(state, makeHeader({ captureSessionId: "cs-other" }))).to.equal(
            false,
        );
        expect(issueCodes(state)).to.deep.equal(["header.duplicate"]);
        expect(state.header?.captureSessionId).to.equal("cs-journal-test");
    });

    test("event records before any header are applied with a single honest warning", () => {
        const state = reduceJournalRecords<FakeCreated, FakeFinal, FakeAcceptance, FakeAnnotation>([
            created(1, "ce-1", { trigger: "typing" }),
            finalized(2, "ce-1", 2, { result: "success" }),
        ]);
        expect(issueCodes(state)).to.deep.equal(["header.missing"]);
        expect(state.events.get("ce-1")?.finalizedValue?.result).to.equal("success");
    });

    test("malformed event records are rejected, never thrown", () => {
        const state = createJournalReducerState<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >();
        applyJournalRecord(state, makeHeader());
        const missingId = {
            schema: FEATURE_CAPTURE_RECORD_SCHEMA,
            kind: "event.created",
            recordSeq: 1,
            eventRevision: 1,
            at: 1,
            value: { trigger: "typing" },
        } as unknown as FakeRecord;
        expect(applyJournalRecord(state, missingId)).to.equal(false);
        expect(issueCodes(state)).to.deep.equal(["record.malformed"]);
        expect(state.recordsRejected).to.equal(1);
    });

    test("projectEvents is deterministic, creation-ordered, and supports skips", () => {
        const state = reduceJournalRecords<FakeCreated, FakeFinal, FakeAcceptance, FakeAnnotation>([
            makeHeader(),
            created(1, "ce-a", { trigger: "typing" }),
            created(2, "ce-b", { trigger: "invoke" }),
            created(3, "ce-c", { trigger: "typing" }),
            finalized(4, "ce-b", 2, { result: "success" }),
            finalized(5, "ce-a", 2, { result: "error" }),
            acceptance(6, "ce-b", 3, { state: "accepted" }),
        ]);

        const projector = (event: {
            captureEventId: string;
            finalizedValue?: FakeFinal;
            acceptance?: FakeAcceptance;
        }) => ({
            id: event.captureEventId,
            result: event.finalizedValue?.result ?? "pending",
            accepted: event.acceptance?.state === "accepted",
        });

        const first = projectEvents(state, projector);
        const second = projectEvents(state, projector);
        expect(first).to.deep.equal(second);
        expect(first).to.deep.equal([
            { id: "ce-a", result: "error", accepted: false },
            { id: "ce-b", result: "success", accepted: true },
            { id: "ce-c", result: "pending", accepted: false },
        ]);

        // Projectors may skip events by returning undefined.
        const terminalOnly = projectEvents(state, (event) =>
            event.finalizedValue ? event.captureEventId : undefined,
        );
        expect(terminalOnly).to.deep.equal(["ce-a", "ce-b"]);
    });

    test("deepEqual helper: structural, key-order agnostic, undefined-insensitive", () => {
        expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).to.equal(true);
        expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).to.equal(true);
        expect(deepEqual({ a: 1 }, { a: 2 })).to.equal(false);
        expect(deepEqual([1, 2], [2, 1])).to.equal(false);
        expect(deepEqual(null, {})).to.equal(false);
    });
});
