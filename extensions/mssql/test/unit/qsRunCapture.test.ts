/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QsRunRecord capture (B7): arming gates, digest-only default, elevated-
 * capture text policy (worksheet row 9 honesty), and completion lifecycle.
 */

import { expect } from "chai";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import { DiagEvent } from "../../src/sharedInterfaces/debugConsole";
import {
    beginRunRecord,
    completeRunRecord,
    qsRunCaptureStore,
} from "../../src/queryStudio/replay/qsRunCapture";

const SQL = "SELECT canary_a FROM T1\nGO\nSELECT canary_b FROM T2";

function begin() {
    return beginRunRecord({
        text: SQL,
        uriKey: "file:///c/x/canary.sql",
        scope: "document",
        mode: "normal",
        server: "canaryhost",
        database: "canarydb",
        catalogGeneration: 7,
    });
}

suite("Query Studio run capture", () => {
    teardown(() => {
        qsRunCaptureStore.clearEvents();
        qsRunCaptureStore.setPanelOpen(false);
        diag.setCaptureMode("redacted");
    });

    test("not armed: no record is captured", () => {
        expect(begin()).to.equal(undefined);
        expect(qsRunCaptureStore.getEvents().length).to.equal(0);
    });

    test("armed default policy: digests only, no SQL text anywhere", () => {
        qsRunCaptureStore.setPanelOpen(true);
        const recordId = begin();
        expect(recordId).to.be.a("string");

        const record = qsRunCaptureStore.getEvent(recordId!)!;
        expect(record.result).to.equal("pending");
        expect(record.batches.length).to.equal(2);
        expect(record.elevated).to.equal(false);
        expect(record.scriptText).to.equal(undefined);
        expect(record.batches.every((batch) => batch.text === undefined)).to.equal(true);
        expect(record.batches[0].textDigest).to.match(/^sql:sha256:/);
        expect(record.documentUriDigest).to.match(/^uri:sha256:/);
        expect(record.profileFingerprint).to.match(/^profile:sha256:/);

        const serialized = JSON.stringify(record);
        expect(serialized.includes("canary_a")).to.equal(false);
        expect(serialized.includes("canary.sql")).to.equal(false);
        expect(serialized.includes("canaryhost")).to.equal(false);
        // Database NAME is metadata (design 18) and intentionally present.
        expect(record.database).to.equal("canarydb");

        completeRunRecord(
            recordId,
            {
                status: "succeeded",
                batches: 2,
                resultSets: 2,
                totalRows: 10,
                errors: 0,
                durationMs: 42,
            },
            5,
        );
        const finalized = qsRunCaptureStore.getEvent(recordId!)!;
        expect(finalized.result).to.equal("succeeded");
        expect(finalized.outcome?.totalRows).to.equal(10);
        expect(finalized.msToFirstResult).to.equal(5);
    });

    test("elevated capture: SQL text captured and policy recorded honestly", () => {
        qsRunCaptureStore.setPanelOpen(true);
        diag.setCaptureMode("full", { reason: "qs capture test", durationMs: 60_000 });
        const recordId = begin();
        const record = qsRunCaptureStore.getEvent(recordId!)!;

        expect(record.elevated).to.equal(true);
        expect(record.scriptText).to.equal(SQL);
        expect(record.batches[0].text).to.contain("canary_a");
        expect(record.capturePolicyId).to.equal("policy_full_elevated");
    });

    test("capture emits queryStudio.runRecord.captured on the substrate", async () => {
        const events: DiagEvent[] = [];
        const sink = {
            id: "qsRunCaptureTestSink",
            tryWrite: (event: DiagEvent) => {
                events.push(event);
            },
        };
        diag.addSink(sink);
        try {
            qsRunCaptureStore.setPanelOpen(true);
            begin();
            const captured = events.find(
                (event) => event.type === "queryStudio.runRecord.captured",
            );
            expect(captured).to.not.equal(undefined);
            expect(captured?.payload?.batches?.v).to.equal(2);
            expect(captured?.payload?.elevated?.v).to.equal(false);
        } finally {
            diag.removeSink(sink.id);
        }
    });
});
