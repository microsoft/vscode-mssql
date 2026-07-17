/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Import/security corpus over the journal + stored-session load path
 * (WI-2.8 / addendum §9.3, §13.2). A stream directory on disk is untrusted
 * input: every hostile shape must produce an honest validation issue —
 * never a crash, never a read outside the stream directory, never an
 * eval/parse of content.
 */

import { expect } from "chai";
import {
    JOURNAL_READER_LIMITS,
    readFeatureCaptureJournal,
} from "../../src/diagnostics/featureCapture/journal/journalReader";
import {
    FEATURE_CAPTURE_MANIFEST_SCHEMA,
    FEATURE_CAPTURE_RECORD_SCHEMA,
    FEATURE_CAPTURE_STREAM_SCHEMA,
    FeatureCaptureManifestV1,
    FeatureCaptureSegmentDescriptorV1,
} from "../../src/diagnostics/featureCapture/journal/journalSchemas";
import {
    COMPLETIONS_JOURNAL_EVENT_SCHEMA,
    COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
    buildCompletionsCapturePolicy,
} from "../../src/copilot/inlineCompletionDebug/completionsJournalProjection";
import {
    configureCompletionsStoredSessions,
    loadStoredCompletionSessionTrace,
} from "../../src/copilot/inlineCompletionDebug/storedSessionProvider";
import { MemJournalFs } from "./support/memJournalFs";

const STORE_ROOT = "C:/hardening-store";
const HOST = "hs-hard";
const EPOCH = "cs-hard";
const STREAM_DIR = `${STORE_ROOT}/sessions/${HOST}/rich/completions/${EPOCH}`;

function headerLine(): string {
    return JSON.stringify({
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "stream.header",
        recordSeq: 0,
        featureId: "completions",
        hostSessionId: HOST,
        captureSessionId: EPOCH,
        eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
        overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
        capturePolicy: buildCompletionsCapturePolicy({
            traceCaptureEnabled: true,
            redactPrompts: false,
            viewerArmed: true,
            activatedAt: 1_000,
        })!,
        createdUtc: "2026-07-16T00:00:00.000Z",
    });
}

function eventValue(captureEventId: string, extras: Record<string, unknown> = {}): unknown {
    return {
        id: captureEventId,
        timestamp: 10_000,
        link: {
            schema: "mssql.observabilityLink/1",
            featureId: "completions",
            hostSessionId: HOST,
            captureSessionId: EPOCH,
            captureEventId,
        },
        documentUri: "file:///c/query.sql",
        documentFileName: "query.sql",
        line: 1,
        column: 1,
        triggerKind: "invoke",
        result: "success",
        promptMessages: [{ role: "user", content: "SELECT 1" }],
        rawResponse: "raw",
        finalCompletionText: "final",
        overridesApplied: {},
        locals: {},
        ...extras,
    };
}

function createdLine(recordSeq: number, captureEventId: string, value: unknown): string {
    return JSON.stringify({
        schema: FEATURE_CAPTURE_RECORD_SCHEMA,
        kind: "event.created",
        recordSeq,
        eventRevision: 1,
        captureEventId,
        at: 10_000,
        value,
    });
}

function seedStream(
    fs: MemJournalFs,
    lines: string[],
    segmentOverrides: Partial<FeatureCaptureSegmentDescriptorV1> = {},
): void {
    const segment: FeatureCaptureSegmentDescriptorV1 = {
        file: "segment-000001.jsonl",
        firstRecordSeq: 0,
        lastRecordSeq: Math.max(lines.length - 1, 0),
        records: lines.length,
        events: lines.filter((line) => line.includes('"event.created"')).length,
        bytes: lines.join("\n").length + 1,
        status: "closed",
        capturePolicyId: "completions.trace/1:localJournal:fullLocal",
        ...segmentOverrides,
    };
    const manifest: FeatureCaptureManifestV1 = {
        schema: FEATURE_CAPTURE_MANIFEST_SCHEMA,
        streamSchema: FEATURE_CAPTURE_STREAM_SCHEMA,
        stream: {
            featureId: "completions",
            hostSessionId: HOST,
            captureSessionId: EPOCH,
            eventSchema: COMPLETIONS_JOURNAL_EVENT_SCHEMA,
            overridesSchema: COMPLETIONS_JOURNAL_OVERRIDES_SCHEMA,
            capturePolicyId: "completions.trace/1:localJournal:fullLocal",
        },
        status: "closed",
        durability: "checkpointed",
        segments: [segment],
        droppedRanges: [],
        totals: {
            records: segment.records,
            events: segment.events,
            bytes: segment.bytes,
            droppedRecords: 0,
        },
        createdUtc: "2026-07-16T00:00:00.000Z",
        updatedUtc: "2026-07-16T00:05:00.000Z",
        closedUtc: "2026-07-16T00:05:00.000Z",
    };
    fs.files.set(`${STREAM_DIR}/manifest.json`, JSON.stringify(manifest));
    fs.files.set(`${STREAM_DIR}/${segment.file}`, lines.join("\n") + "\n");
}

function configure(fs: MemJournalFs): void {
    configureCompletionsStoredSessions({
        storeRoot: STORE_ROOT,
        isCurrentEpoch: () => false,
        fs,
    });
}

suite("Journal import hardening corpus (WI-2.8 / §13.2)", () => {
    teardown(() => {
        configureCompletionsStoredSessions(undefined);
    });

    test("an oversized single segment line is an honest issue, not a crash", async () => {
        const fs = new MemJournalFs();
        const giant = createdLine(
            1,
            "ce-giant",
            eventValue("ce-giant", { rawResponse: "x".repeat(5_000) }),
        );
        const good = createdLine(2, "ce-good", eventValue("ce-good"));
        seedStream(fs, [headerLine(), giant, good]);

        const result = await readFeatureCaptureJournal(STREAM_DIR, {
            fs,
            limits: { maxLineLength: 1_000 },
        });
        expect(result.issues.some((issue) => issue.code === "segment.lineTooLong")).to.equal(true);
        // The rest of the stream still loads as partial evidence.
        expect(result.state.order).to.deep.equal(["ce-good"]);
    });

    test("default line limit admits every line a healthy writer can produce", () => {
        // The writer's queue-byte cap bounds a single record at 4MB; the
        // reader's default cap is double that — no honest line is refused.
        expect(JOURNAL_READER_LIMITS.maxLineLength).to.be.greaterThan(4 * 1024 * 1024);
    });

    test("a manifest naming a traversal segment path is refused, never followed", async () => {
        const fs = new MemJournalFs();
        seedStream(fs, [headerLine()], { file: "..\\evil" });
        // Plant a file at the traversal target: it must never be read.
        fs.files.set(`${STORE_ROOT}/sessions/${HOST}/rich/completions/evil`, "outside!");

        const result = await readFeatureCaptureJournal(STREAM_DIR, { fs });
        expect(result.issues.some((issue) => issue.code === "segment.invalidName")).to.equal(true);
        const readPaths = fs.ops.filter((op) => op.op === "read").map((op) => op.path);
        expect(readPaths.every((path) => !path.includes(".."))).to.equal(true);
        expect(readPaths.every((path) => path.startsWith(STREAM_DIR))).to.equal(true);

        // Absolute paths and forward-slash traversals are refused too.
        for (const hostile of ["../evil", "C:/evil.jsonl", "sub/segment-000001.jsonl"]) {
            const hostileFs = new MemJournalFs();
            seedStream(hostileFs, [headerLine()], { file: hostile });
            const hostileResult = await readFeatureCaptureJournal(STREAM_DIR, { fs: hostileFs });
            expect(
                hostileResult.issues.some((issue) => issue.code === "segment.invalidName"),
                `expected refusal for ${hostile}`,
            ).to.equal(true);
        }
    });

    test("duplicate captureEventIds dedup end-to-end through the stored-session load", async () => {
        const fs = new MemJournalFs();
        const value = eventValue("ce-dup");
        const differing = eventValue("ce-dup", { rawResponse: "DIFFERENT" });
        seedStream(fs, [
            headerLine(),
            createdLine(1, "ce-dup", value),
            createdLine(2, "ce-dup", value), // identical duplicate → silent idempotent
            createdLine(3, "ce-dup", differing), // differing duplicate → original kept
        ]);
        configure(fs);

        const trace = await loadStoredCompletionSessionTrace({
            path: STREAM_DIR,
            savedAt: "2026-07-16T00:05:00.000Z",
        });
        expect(trace.events).to.have.length(1);
        expect(trace.events[0].rawResponse).to.equal("raw"); // the original value

        // The reducer's issue trail names the conflicting duplicate.
        const direct = await readFeatureCaptureJournal(STREAM_DIR, { fs });
        expect(direct.issues.some((issue) => issue.code === "event.duplicateCreated")).to.equal(
            true,
        );
    });

    test("HTML/script strings survive the load path as inert, verbatim strings", async () => {
        const fs = new MemJournalFs();
        const scriptText = "<script>alert(1)</script>";
        const imgText = '<img src=x onerror="alert(1)">';
        seedStream(fs, [
            headerLine(),
            createdLine(
                1,
                "ce-html",
                eventValue("ce-html", {
                    rawResponse: scriptText,
                    finalCompletionText: imgText,
                    promptMessages: [{ role: "user", content: scriptText }],
                    locals: { "<b>key</b>": scriptText },
                }),
            ),
        ]);
        configure(fs);

        const trace = await loadStoredCompletionSessionTrace({
            path: STREAM_DIR,
            savedAt: "2026-07-16T00:05:00.000Z",
        });
        // Verbatim: no unescaping, no parsing, no execution — rendering
        // safety is React's job downstream; the load path must not touch it.
        const event = trace.events[0];
        expect(event.rawResponse).to.equal(scriptText);
        expect(event.finalCompletionText).to.equal(imgText);
        expect(event.promptMessages[0].content).to.equal(scriptText);
        expect((event.locals as Record<string, unknown>)["<b>key</b>"]).to.equal(scriptText);
    });

    test("zip-bomb-shaped deep nesting is rejected by the depth limit", async () => {
        const fs = new MemJournalFs();
        let nested: unknown = "leaf";
        for (let index = 0; index < 100; index++) {
            nested = { n: nested };
        }
        seedStream(fs, [
            headerLine(),
            createdLine(1, "ce-deep", eventValue("ce-deep", { locals: { bomb: nested } })),
            createdLine(2, "ce-flat", eventValue("ce-flat")),
        ]);

        const result = await readFeatureCaptureJournal(STREAM_DIR, { fs });
        expect(result.issues.some((issue) => issue.code === "record.tooDeep")).to.equal(true);
        // The flat record still loads; the bomb never enters the read model.
        expect(result.state.order).to.deep.equal(["ce-flat"]);
    });
});
