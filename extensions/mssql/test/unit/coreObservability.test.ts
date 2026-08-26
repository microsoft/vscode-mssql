/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    diagnosticErrorClass,
    DiagnosticsCore,
    DiagnosticSink,
} from "../../src/diagnostics/diagnosticsCore";
import { CAPTURE_POLICIES, classifyPayload } from "../../src/diagnostics/redaction";
import { LiveTailSink, PerfModeSink, SessionDiagSink } from "../../src/diagnostics/sinks";
import { DIAG_SCHEMA_VERSION, DiagEvent, GapRecord } from "../../src/sharedInterfaces/diagnostics";

const PROVIDER_CANARY = "CANARY-provider-message-7f3a9";
const SECRET_CANARY = "CANARY-secret-token-2b8c1";

function event(seq: number): DiagEvent {
    return {
        schemaVersion: DIAG_SCHEMA_VERSION,
        eventId: `evt_${seq}`,
        sessionId: "sess_test",
        seq,
        epochMs: 1_000 + seq,
        process: "extensionHost",
        feature: "test",
        kind: "event",
        type: "test.event",
        status: "ok",
        cls: { max: "public", redactedFields: 0, policyId: "test" },
    };
}

suite("Core observability", () => {
    test("the no-sink path is inert", () => {
        const core = new DiagnosticsCore();
        expect(core.anySinkActive).to.equal(false);
        expect(core.emit({ feature: "test", type: "test.noop" })).to.equal(undefined);
        expect(core.lastSeq).to.equal(0);
    });

    test("sink failures are isolated and root actions retain one trace", () => {
        const core = new DiagnosticsCore();
        const received: DiagEvent[] = [];
        const throwingSink: DiagnosticSink = {
            id: "throwing",
            tryWrite: () => {
                throw new Error("sink failure");
            },
        };
        const collectingSink: DiagnosticSink = {
            id: "collecting",
            tryWrite: (value) => received.push(value),
        };
        core.addSink(throwingSink);
        core.addSink(collectingSink);

        core.emit({ feature: "connection", type: "mssql.connection.begin" });
        core.emit({ feature: "connection", type: "mssql.connection.ready" });

        expect(received).to.have.length(2);
        expect(received[0].seq).to.equal(1);
        expect(received[1].seq).to.equal(2);
        expect(received[0].traceId).to.be.a("string");
        expect(received[1].traceId).to.equal(received[0].traceId);
    });

    test("failed spans expose a closed error class, never provider text", () => {
        const core = new DiagnosticsCore();
        const received: DiagEvent[] = [];
        core.addSink({ id: "collecting", tryWrite: (value) => received.push(value) });

        const providerError = new Error(PROVIDER_CANARY);
        providerError.name = PROVIDER_CANARY;
        (providerError as Error & { code: string }).code = SECRET_CANARY;
        core.startSpan({ feature: "test", type: "test.operation" }).fail(providerError);

        expect(diagnosticErrorClass(providerError)).to.equal("UnknownError");
        expect(received).to.have.length(2);
        expect(received[1].causeEventId).to.equal(received[0].eventId);
        expect(received[1].traceId).to.equal(received[0].traceId);
        expect(received[1].payload?.["errorClass"].v).to.equal("UnknownError");
        expect(JSON.stringify(received)).to.not.include(PROVIDER_CANARY);
        expect(JSON.stringify(received)).to.not.include(SECRET_CANARY);
    });

    test("a span can complete only once", () => {
        const core = new DiagnosticsCore();
        const received: DiagEvent[] = [];
        core.addSink({ id: "collecting", tryWrite: (value) => received.push(value) });
        const span = core.startSpan({ feature: "test", type: "test.once" });

        span.end();
        span.fail(new Error("late failure"));

        expect(received.map((value) => value.type)).to.deep.equal([
            "test.once.begin",
            "test.once.end",
        ]);
    });

    test("live-tail overflow reports the exact gap and resync sequence", async () => {
        const sink = new LiveTailSink(2, 5);
        let delivered: DiagEvent[] = [];
        let gap: GapRecord | undefined;
        sink.subscribe((events, value) => {
            delivered = events;
            gap = value;
        });
        sink.tryWrite(event(1));
        sink.tryWrite(event(2));
        sink.tryWrite(event(3));
        await new Promise((resolve) => setTimeout(resolve, 15));

        expect(delivered.map((value) => value.seq)).to.deep.equal([2, 3]);
        expect(gap).to.include({
            fromSeq: 1,
            throughSeq: 1,
            droppedCount: 1,
            firstAvailableSeq: 2,
        });
        sink.dispose();
    });

    test("redacted session journals never persist secrets or provider text", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-core-diag-"));
        try {
            const policy = CAPTURE_POLICIES.redacted;
            const { payload, maxClassification, redactedFields } = classifyPayload(
                {
                    secret: { raw: SECRET_CANARY, cls: "secret" },
                    provider: { raw: PROVIDER_CANARY, cls: "user.text" },
                },
                policy,
            );
            const sink = new SessionDiagSink(root, "sess_canary", "redacted", policy.policyId, {
                extensionVersion: "test",
            });
            sink.tryWrite({
                ...event(1),
                sessionId: "sess_canary",
                payload,
                cls: { max: maxClassification, redactedFields, policyId: policy.policyId },
            });
            sink.close();

            const sessionDir = path.join(root, "sessions", "sess_canary");
            const persisted = fs
                .readdirSync(path.join(sessionDir, "events"))
                .map((name) => fs.readFileSync(path.join(sessionDir, "events", name), "utf8"))
                .join("\n");
            expect(persisted).to.not.include(SECRET_CANARY);
            expect(persisted).to.not.include(PROVIDER_CANARY);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("the harness sink forwards only post-classification plain fields", () => {
        const policy = CAPTURE_POLICIES.redacted;
        const { payload, maxClassification, redactedFields } = classifyPayload(
            {
                secret: { raw: SECRET_CANARY, cls: "secret" },
                rowCount: { raw: 42, cls: "diagnostic.metadata" },
            },
            policy,
        );
        const sink = new PerfModeSink("http://127.0.0.1:1/unused", "token", "run", 0, "scenario");
        sink.tryWrite({
            ...event(1),
            payload,
            cls: { max: maxClassification, redactedFields, policyId: policy.policyId },
            tags: ["perfMarker", "phase:instant"],
        });

        const queued = (sink as unknown as { queue: unknown[] }).queue;
        expect(sink.queuedCount).to.equal(1);
        expect(JSON.stringify(queued)).to.include("rowCount");
        expect(JSON.stringify(queued)).to.not.include(SECRET_CANARY);
    });
});
