/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Feature-capture journal writer + reader (final plan WI-2.2 / addendum
 * §3.7, fault-injection points §13.5): bounded non-blocking writes, exact
 * dropped ranges, segment rolls, atomic child-manifest updates, honest
 * durability labels, ok→degraded→failed isolation, and the crash shapes the
 * reader must load as partial evidence instead of crashing. Schema and
 * reducer coverage lives in featureCaptureJournal.test.ts.
 */

import { expect } from "chai";
import {
    projectEvents,
    reduceJournalRecords,
} from "../../src/diagnostics/featureCapture/journal/journalReducer";
import { readFeatureCaptureJournal } from "../../src/diagnostics/featureCapture/journal/journalReader";
import {
    FEATURE_CAPTURE_RECORD_SCHEMA,
    FeatureCaptureJournalEventRecordInputV1,
    FeatureCaptureJournalRecordV1,
    FeatureCaptureManifestV1,
} from "../../src/diagnostics/featureCapture/journal/journalSchemas";
import {
    FeatureCaptureJournalWriter,
    FeatureCaptureJournalWriterOptions,
} from "../../src/diagnostics/featureCapture/journal/journalWriter";
import { RichCapturePolicySnapshot } from "../../src/sharedInterfaces/featureTrace";
import { ManualClock, MemJournalFs } from "./support/memJournalFs";

interface FakeCreated {
    trigger: string;
}

interface FakeFinal {
    result: string;
    latencyMs?: number;
}

interface FakeAcceptance {
    state: "accepted" | "notAccepted";
}

type FakeAnnotation = Record<string, unknown>;

type FakeInput = FeatureCaptureJournalEventRecordInputV1<
    FakeCreated,
    FakeFinal,
    FakeAcceptance,
    FakeAnnotation
>;

const DIR = "C:/store/rich/journalTest/cs-1";
const MANIFEST_PATH = `${DIR}/manifest.json`;

function makePolicy(): RichCapturePolicySnapshot {
    return {
        schema: "mssql.richCapturePolicy/1",
        policyId: "policy-test",
        featureId: "journalTest",
        fidelity: "fullLocal",
        persistence: "localJournal",
        source: "test",
        activatedAt: 1_000,
        replayPayloadAvailable: true,
    };
}

function makeWriter(
    fs: MemJournalFs,
    clock: ManualClock,
    options: Partial<FeatureCaptureJournalWriterOptions> = {},
) {
    return new FeatureCaptureJournalWriter<FakeCreated, FakeFinal, FakeAcceptance, FakeAnnotation>({
        directory: DIR,
        header: {
            featureId: "journalTest",
            hostSessionId: "hs-test",
            captureSessionId: "cs-1",
            eventSchema: "test.event/1",
            overridesSchema: "test.overrides/1",
            capturePolicy: makePolicy(),
        },
        fs,
        clock,
        ...options,
    });
}

function createdInput(captureEventId: string, trigger = "typing"): FakeInput {
    return {
        kind: "event.created",
        eventRevision: 1,
        captureEventId,
        at: 10_000,
        value: { trigger },
    };
}

function finalizedInput(captureEventId: string, eventRevision: number, result: string): FakeInput {
    return {
        kind: "event.finalized",
        eventRevision,
        captureEventId,
        at: 10_100,
        value: { result, latencyMs: 42 },
    };
}

function acceptanceInput(captureEventId: string, eventRevision: number): FakeInput {
    return {
        kind: "acceptance.changed",
        eventRevision,
        captureEventId,
        at: 10_200,
        value: { state: "accepted" },
    };
}

function annotationInput(captureEventId: string, eventRevision: number): FakeInput {
    return {
        kind: "annotation.added",
        eventRevision,
        captureEventId,
        at: 10_300,
        value: { note: "matrix cell A" },
    };
}

function manifestOf(fs: MemJournalFs): FeatureCaptureManifestV1 {
    const raw = fs.files.get(MANIFEST_PATH);
    expect(raw, "manifest.json should exist").to.not.equal(undefined);
    return JSON.parse(raw!) as FeatureCaptureManifestV1;
}

function segmentLines(fs: MemJournalFs, file: string): string[] {
    return (fs.files.get(`${DIR}/${file}`) ?? "").split("\n").filter((line) => line.length > 0);
}

suite("Feature capture journal writer (WI-2.2)", () => {
    test("tryWrite performs NO filesystem I/O on the caller path (fake fs asserts)", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock());
        for (let index = 0; index < 50; index++) {
            const result = writer.tryWrite(createdInput(`ce-${index}`));
            expect(result.accepted).to.equal(true);
        }
        expect(fs.ops.length, "no fs op may run during tryWrite").to.equal(0);

        await writer.flushBarrier();
        expect(fs.ops.length).to.be.greaterThan(0);

        // Still zero fs activity from tryWrite after the writer has flushed.
        const baseline = fs.ops.length;
        for (let index = 50; index < 80; index++) {
            writer.tryWrite(createdInput(`ce-${index}`));
        }
        expect(fs.ops.length).to.equal(baseline);
        await writer.close();
    });

    test("batched appends coalesce and the manifest lands via temp file + atomic rename", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock());
        for (let index = 0; index < 10; index++) {
            writer.tryWrite(createdInput(`ce-${index}`));
        }
        await writer.flushBarrier();

        // Header + 10 events in exactly ONE append call.
        expect(fs.ops.filter((op) => op.op === "append").length).to.equal(1);
        expect(segmentLines(fs, "segment-000001.jsonl").length).to.equal(11);

        // Atomic manifest protocol: write .tmp, then rename onto manifest.json.
        const write = fs.ops.find((op) => op.op === "write");
        const rename = fs.ops.find((op) => op.op === "rename");
        expect(write?.path.endsWith(".tmp")).to.equal(true);
        expect(rename?.path).to.equal(write?.path);
        expect(rename?.to).to.equal(MANIFEST_PATH);

        const manifest = manifestOf(fs);
        expect(manifest.totals.records).to.equal(11);
        expect(manifest.totals.events).to.equal(10);
        expect(manifest.status).to.equal("active");
        expect(manifest.stream.captureSessionId).to.equal("cs-1");
        await writer.close();
    });

    test("segments roll by record count; closed segments are digested, the active one is not", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock(), { segmentMaxRecords: 5 });
        for (let index = 0; index < 11; index++) {
            writer.tryWrite(createdInput(`ce-${index}`));
        }
        await writer.flushBarrier();

        let manifest = manifestOf(fs);
        expect(manifest.segments.map((segment) => segment.records)).to.deep.equal([5, 5, 2]);
        expect(manifest.segments.map((segment) => segment.file)).to.deep.equal([
            "segment-000001.jsonl",
            "segment-000002.jsonl",
            "segment-000003.jsonl",
        ]);
        expect(manifest.segments[0].sha256).to.be.a("string");
        expect(manifest.segments[1].sha256).to.be.a("string");
        expect(manifest.segments[2].sha256).to.equal(undefined);
        expect(manifest.segments[2].status).to.equal("active");
        expect(manifest.segments[0].firstRecordSeq).to.equal(0);
        expect(manifest.segments[0].lastRecordSeq).to.equal(4);
        expect(manifest.segments[2].firstRecordSeq).to.equal(10);

        // close() completes the last segment: digested + closed + stream closed.
        await writer.close();
        manifest = manifestOf(fs);
        expect(manifest.status).to.equal("closed");
        expect(manifest.closedUtc).to.be.a("string");
        expect(manifest.segments[2].sha256).to.be.a("string");
        expect(manifest.segments[2].status).to.equal("closed");
    });

    test("segments roll by bytes as well as by count", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock(), { segmentMaxBytes: 400 });
        for (let index = 0; index < 8; index++) {
            // ~177-byte lines: two fit a 400-byte segment, three do not.
            writer.tryWrite(createdInput(`ce-${index}`, "x".repeat(20)));
        }
        await writer.close();

        const manifest = manifestOf(fs);
        expect(manifest.segments.length).to.be.greaterThanOrEqual(4);
        expect(manifest.totals.records).to.equal(9);
        for (const segment of manifest.segments) {
            // The byte cap holds — except a single record may exceed it alone.
            expect(segment.bytes <= 400 || segment.records === 1).to.equal(true);
        }
        // Byte-driven grouping actually happened (multi-record segments).
        expect(manifest.segments.some((segment) => segment.records === 2)).to.equal(true);
        expect(manifest.segments.reduce((sum, segment) => sum + segment.records, 0)).to.equal(9);
    });

    test("record-count overflow drops the incoming records with EXACT seq ranges", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock(), { maxQueueRecords: 4 });

        // Header (seq 0) + three events fill the queue.
        expect(writer.tryWrite(createdInput("ce-1")).accepted).to.equal(true);
        expect(writer.tryWrite(createdInput("ce-2")).accepted).to.equal(true);
        expect(writer.tryWrite(createdInput("ce-3")).accepted).to.equal(true);

        // Seqs 4..6 overflow — dropped as one exact contiguous range.
        for (const expectedSeq of [4, 5, 6]) {
            const result = writer.tryWrite(createdInput(`ce-${expectedSeq}`));
            expect(result.accepted).to.equal(false);
            expect(result.recordSeq).to.equal(expectedSeq);
        }
        expect(writer.health().droppedRecords).to.equal(3);
        expect(writer.health().droppedRangeCount).to.equal(1);

        await writer.flushBarrier();
        expect(manifestOf(fs).droppedRanges).to.deep.equal([
            { fromRecordSeq: 4, throughRecordSeq: 6, reason: "queueOverflowRecords" },
        ]);

        // After the queue drains, seq 7 is accepted; a later overflow opens a
        // SECOND distinct range instead of stretching the first.
        expect(writer.tryWrite(createdInput("ce-7")).accepted).to.equal(true);
        expect(writer.tryWrite(createdInput("ce-8")).accepted).to.equal(true);
        expect(writer.tryWrite(createdInput("ce-9")).accepted).to.equal(true);
        expect(writer.tryWrite(createdInput("ce-10")).accepted).to.equal(true);
        expect(writer.tryWrite(createdInput("ce-11")).accepted).to.equal(false);
        await writer.flushBarrier();
        expect(manifestOf(fs).droppedRanges).to.deep.equal([
            { fromRecordSeq: 4, throughRecordSeq: 6, reason: "queueOverflowRecords" },
            { fromRecordSeq: 11, throughRecordSeq: 11, reason: "queueOverflowRecords" },
        ]);
        expect(manifestOf(fs).totals.records).to.equal(8);
        expect(manifestOf(fs).totals.droppedRecords).to.equal(4);

        // The reader treats manifest-covered gaps as evidence, not anomalies.
        const { state, issues } = await readFeatureCaptureJournal(DIR, { fs });
        expect(issues.filter((issue) => issue.code === "record.seqGap")).to.deep.equal([]);
        expect(state.events.size).to.equal(7);
        await writer.close();
    });

    test("byte-bounded queue drops by bytes with its own exact range reason", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock(), { maxQueueBytes: 1000 });
        await writer.flushBarrier(); // drain the header so only events queue

        expect(writer.tryWrite(createdInput("ce-1", "x".repeat(250))).accepted).to.equal(true);
        expect(writer.tryWrite(createdInput("ce-2", "x".repeat(250))).accepted).to.equal(true);
        const dropped = writer.tryWrite(createdInput("ce-3", "x".repeat(250)));
        expect(dropped.accepted).to.equal(false);

        await writer.flushBarrier();
        expect(manifestOf(fs).droppedRanges).to.deep.equal([
            { fromRecordSeq: 3, throughRecordSeq: 3, reason: "queueOverflowBytes" },
        ]);
        await writer.close();
    });

    test("fault §13.5: failure between append and manifest — reader still loads with an issue", async () => {
        const fs = new MemJournalFs();
        fs.failWrite = (path) => (path.endsWith(".tmp") ? new Error("disk full") : undefined);
        const writer = makeWriter(fs, new ManualClock());
        writer.tryWrite(createdInput("ce-1"));
        writer.tryWrite(finalizedInput("ce-1", 2, "success"));
        await writer.flushBarrier();

        // Appended but never checkpointed.
        expect(segmentLines(fs, "segment-000001.jsonl").length).to.equal(3);
        expect(fs.files.has(MANIFEST_PATH)).to.equal(false);
        const health = writer.health();
        expect(health.state).to.equal("degraded");
        expect(health.durabilityLevel).to.equal("appended");
        expect(health.lastCheckpointAt).to.equal(undefined);
        expect(health.consecutiveFailures).to.equal(1);

        // The reader falls back to a directory scan and reports honestly.
        const { state, issues, manifest } = await readFeatureCaptureJournal<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >(DIR, { fs });
        expect(manifest).to.equal(undefined);
        expect(issues.some((issue) => issue.code === "manifest.missing")).to.equal(true);
        expect(state.events.get("ce-1")?.finalizedValue?.result).to.equal("success");
    });

    test("fault §13.5: failure during atomic rename — the old manifest stays intact", async () => {
        const fs = new MemJournalFs();
        const clock = new ManualClock();
        const writer = makeWriter(fs, clock);
        writer.tryWrite(createdInput("ce-1"));
        writer.tryWrite(createdInput("ce-2"));
        await writer.flushBarrier();
        expect(manifestOf(fs).totals.records).to.equal(3);

        fs.failRename = () => new Error("EPERM");
        writer.tryWrite(createdInput("ce-3"));
        writer.tryWrite(createdInput("ce-4"));
        await writer.flushBarrier();

        // Data appended, checkpoint failed, OLD manifest untouched.
        expect(segmentLines(fs, "segment-000001.jsonl").length).to.equal(5);
        expect(manifestOf(fs).totals.records).to.equal(3);
        expect(writer.health().state).to.equal("degraded");
        expect(writer.health().durabilityLevel).to.equal("appended");

        // Reader: every appended record loads; the stale count is an issue.
        const readBack = await readFeatureCaptureJournal(DIR, { fs });
        expect(readBack.state.events.size).to.equal(4);
        const mismatch = readBack.issues.find(
            (issue) => issue.code === "segment.recordCountMismatch",
        );
        expect(mismatch?.severity).to.equal("info");
        expect(mismatch?.message).to.match(/appended after the last checkpoint/);

        // Recovery: the next successful flush re-checkpoints everything.
        fs.failRename = undefined;
        writer.tryWrite(createdInput("ce-5"));
        await writer.flushBarrier();
        expect(manifestOf(fs).totals.records).to.equal(6);
        expect(writer.health().state).to.equal("ok");
        expect(writer.health().durabilityLevel).to.equal("checkpointed");
        await writer.close();
    });

    test("flushBarrier makes queued records durable on demand and upgrades the durability claim", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock());
        writer.tryWrite(createdInput("ce-1"));
        expect(fs.files.size).to.equal(0);
        expect(writer.health().durabilityLevel).to.equal("appended");
        expect(writer.health().queueDepth).to.equal(2); // header + event

        await writer.flushBarrier();
        expect(segmentLines(fs, "segment-000001.jsonl").length).to.equal(2);
        expect(writer.health().queueDepth).to.equal(0);
        expect(writer.health().durabilityLevel).to.equal("checkpointed");
        expect(writer.health().lastCheckpointAt).to.be.a("number");
        await writer.close();
    });

    test("close() finalizes honestly and is idempotent; late records become exact drops", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock());
        writer.tryWrite(createdInput("ce-1"));
        writer.tryWrite(finalizedInput("ce-1", 2, "success"));
        await writer.close();

        const manifest = manifestOf(fs);
        expect(manifest.status).to.equal("closed");
        expect(manifest.closedUtc).to.be.a("string");
        expect(manifest.segments.length).to.equal(1);
        expect(manifest.segments[0].sha256).to.be.a("string");
        expect(manifest.durability).to.equal("checkpointed");

        // Writes after close are refused with exact accounting; close is
        // idempotent and never throws.
        const late = writer.tryWrite(createdInput("ce-late"));
        expect(late.accepted).to.equal(false);
        expect(writer.health().droppedRecords).to.equal(1);
        await writer.close();
        expect(manifestOf(fs)).to.deep.equal(manifest);
    });

    test("close() after an append failure claims partial, never a fabricated digest", async () => {
        const fs = new MemJournalFs();
        let failures = 0;
        fs.failAppend = () => (++failures === 1 ? new Error("EIO") : undefined);
        const writer = makeWriter(fs, new ManualClock());
        writer.tryWrite(createdInput("ce-1"));
        await writer.flushBarrier(); // first append fails; records requeued
        expect(writer.health().state).to.equal("degraded");

        await writer.close(); // retry succeeds into a fresh segment

        const manifest = manifestOf(fs);
        expect(manifest.status).to.equal("partial");
        // The interrupted segment: closed, empty, and NEVER digested.
        expect(manifest.segments[0].records).to.equal(0);
        expect(manifest.segments[0].sha256).to.equal(undefined);
        // The retried records landed complete in the next segment.
        expect(manifest.segments[1].records).to.equal(2);
        expect(manifest.segments[1].sha256).to.be.a("string");
        expect(manifest.durability).to.equal("appended");

        // Reader: honest partial — every record present exactly once.
        const { state, issues } = await readFeatureCaptureJournal(DIR, { fs });
        expect(state.events.size).to.equal(1);
        expect(state.recordsApplied).to.equal(2);
        expect(issues.filter((issue) => issue.severity === "error")).to.deep.equal([]);
    });

    test("health degrades ok→degraded→failed; a throwing fs never reaches the product", async () => {
        const fs = new MemJournalFs();
        fs.failAppend = () => new Error("EIO");
        const writer = makeWriter(fs, new ManualClock(), { failureThreshold: 3 });
        expect(writer.health().state).to.equal("ok");

        writer.tryWrite(createdInput("ce-1"));
        writer.tryWrite(createdInput("ce-2"));

        await writer.flushBarrier();
        expect(writer.health().state).to.equal("degraded");
        expect(writer.health().consecutiveFailures).to.equal(1);

        await writer.flushBarrier();
        expect(writer.health().consecutiveFailures).to.equal(2);

        await writer.flushBarrier();
        const failed = writer.health();
        expect(failed.state).to.equal("failed");
        expect(failed.consecutiveFailures).to.equal(3);
        expect(failed.failureDetail).to.match(/appending/);
        // The queue (header + 2 events) became an exact dropped range.
        expect(failed.queueDepth).to.equal(0);
        expect(failed.droppedRecords).to.equal(3);

        // Failed writers keep counting drops; nothing ever throws.
        const result = writer.tryWrite(createdInput("ce-3"));
        expect(result.accepted).to.equal(false);
        expect(writer.health().droppedRecords).to.equal(4);
        await writer.flushBarrier(); // resolves, no rejection
        await writer.close(); // resolves, no rejection
        expect(manifestOf(fs).status).to.equal("partial");
        expect(manifestOf(fs).totals.droppedRecords).to.equal(4);
    });

    test("a single transient failure recovers to ok with every record persisted exactly once", async () => {
        const fs = new MemJournalFs();
        let failures = 0;
        fs.failAppend = () => (++failures === 1 ? new Error("EIO") : undefined);
        const writer = makeWriter(fs, new ManualClock());
        writer.tryWrite(createdInput("ce-1"));
        writer.tryWrite(finalizedInput("ce-1", 2, "success"));

        await writer.flushBarrier(); // fails, requeues
        await writer.flushBarrier(); // retries clean
        expect(writer.health().state).to.equal("ok");
        expect(writer.health().consecutiveFailures).to.equal(0);
        await writer.close();

        const { state, issues } = await readFeatureCaptureJournal<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >(DIR, { fs });
        expect(state.recordsApplied).to.equal(3);
        expect(state.events.get("ce-1")?.finalizedValue?.result).to.equal("success");
        expect(
            issues.filter(
                (issue) => issue.code === "event.duplicateCreated" || issue.severity === "error",
            ),
        ).to.deep.equal([]);
    });
});

suite("Feature capture journal reader (WI-2.2)", () => {
    test("a torn final line is an issue, not a crash; complete records still load", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock());
        writer.tryWrite(createdInput("ce-1"));
        writer.tryWrite(finalizedInput("ce-1", 2, "success"));
        await writer.flushBarrier();

        // Simulate an append interrupted mid-line on the active segment.
        const segmentPath = `${DIR}/segment-000001.jsonl`;
        fs.files.set(segmentPath, fs.files.get(segmentPath)! + '{"schema":"mssql.featu');

        const { state, issues } = await readFeatureCaptureJournal<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >(DIR, { fs });
        const torn = issues.find((issue) => issue.code === "segment.tornTailLine");
        expect(torn?.severity).to.equal("warning");
        expect(state.recordsApplied).to.equal(3);
        expect(state.events.get("ce-1")?.finalizedValue?.result).to.equal("success");
        expect(
            issues.filter((issue) => issue.code === "segment.recordCountMismatch"),
        ).to.deep.equal([]);
    });

    test("a missing segment file yields an honest partial read", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock(), { segmentMaxRecords: 3 });
        for (let index = 0; index < 5; index++) {
            writer.tryWrite(createdInput(`ce-${index}`));
        }
        await writer.close();
        expect(manifestOf(fs).segments.length).to.equal(2);

        fs.files.delete(`${DIR}/segment-000001.jsonl`);
        const { state, issues } = await readFeatureCaptureJournal(DIR, { fs });
        const missing = issues.find((issue) => issue.code === "segment.missing");
        expect(missing?.severity).to.equal("error");
        expect(missing?.message).to.match(/segment-000001\.jsonl/);
        // Segment 2 (seqs 3..5) still loads: partial evidence, not a crash.
        expect(state.events.size).to.equal(3);
    });

    test("closed-segment digests are verified; corruption is loaded but flagged", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock());
        writer.tryWrite(createdInput("ce-1"));
        writer.tryWrite(finalizedInput("ce-1", 2, "success"));
        await writer.close();

        const clean = await readFeatureCaptureJournal(DIR, { fs });
        expect(clean.issues).to.deep.equal([]);

        // Same-length tamper keeps the JSON valid but breaks the digest.
        const segmentPath = `${DIR}/segment-000001.jsonl`;
        fs.files.set(segmentPath, fs.files.get(segmentPath)!.replace("success", "SUCCESS"));

        const tampered = await readFeatureCaptureJournal<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >(DIR, { fs });
        const mismatch = tampered.issues.find((issue) => issue.code === "segment.digestMismatch");
        expect(mismatch?.severity).to.equal("error");
        expect(tampered.state.events.get("ce-1")?.finalizedValue?.result).to.equal("SUCCESS");

        // Digest verification is skippable for tooling that only inventories.
        const unverified = await readFeatureCaptureJournal(DIR, { fs, verifyDigests: false });
        expect(
            unverified.issues.filter((issue) => issue.code === "segment.digestMismatch"),
        ).to.deep.equal([]);
    });

    test("round trip: writer → reader → reducer → projection equals the in-memory sequence", async () => {
        const fs = new MemJournalFs();
        const writer = makeWriter(fs, new ManualClock(), { segmentMaxRecords: 4 });
        const inputs: FakeInput[] = [
            createdInput("ce-a"),
            createdInput("ce-b", "invoke"),
            finalizedInput("ce-a", 2, "success"),
            acceptanceInput("ce-a", 3),
            finalizedInput("ce-b", 2, "error"),
            annotationInput("ce-a", 4),
            createdInput("ce-c"), // stays pending
        ];
        for (const input of inputs) {
            expect(writer.tryWrite(input).accepted).to.equal(true);
        }
        await writer.close();

        // The same records, reduced entirely in memory (no storage round trip).
        const expectedRecords: Array<
            FeatureCaptureJournalRecordV1<FakeCreated, FakeFinal, FakeAcceptance, FakeAnnotation>
        > = [
            writer.header,
            ...inputs.map(
                (input, index) =>
                    ({
                        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
                        ...input,
                        recordSeq: index + 1,
                    }) as FeatureCaptureJournalRecordV1<
                        FakeCreated,
                        FakeFinal,
                        FakeAcceptance,
                        FakeAnnotation
                    >,
            ),
        ];
        const expectedState = reduceJournalRecords(expectedRecords);

        const { state, issues, manifest } = await readFeatureCaptureJournal<
            FakeCreated,
            FakeFinal,
            FakeAcceptance,
            FakeAnnotation
        >(DIR, { fs });
        expect(issues).to.deep.equal([]);
        expect(manifest?.status).to.equal("closed");
        expect(manifest?.totals.records).to.equal(8);
        expect(state.header).to.deep.equal(writer.header);

        const projector = (event: {
            captureEventId: string;
            eventRevision: number;
            createdValue?: FakeCreated;
            finalizedValue?: FakeFinal;
            acceptance?: FakeAcceptance;
            annotations: Array<{ value: FakeAnnotation }>;
        }) => ({
            id: event.captureEventId,
            revision: event.eventRevision,
            trigger: event.createdValue?.trigger,
            result: event.finalizedValue?.result ?? "pending",
            accepted: event.acceptance?.state === "accepted",
            annotations: event.annotations.map((entry) => entry.value),
        });
        expect(projectEvents(state, projector)).to.deep.equal(
            projectEvents(expectedState, projector),
        );
        expect(projectEvents(state, projector)).to.deep.equal([
            {
                id: "ce-a",
                revision: 4,
                trigger: "typing",
                result: "success",
                accepted: true,
                annotations: [{ note: "matrix cell A" }],
            },
            {
                id: "ce-b",
                revision: 2,
                trigger: "invoke",
                result: "error",
                accepted: false,
                annotations: [],
            },
            {
                id: "ce-c",
                revision: 1,
                trigger: "typing",
                result: "pending",
                accepted: false,
                annotations: [],
            },
        ]);
    });
});
