/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import {
    diagnosticErrorClass,
    DiagnosticsCore,
    DiagnosticSink,
} from "../../src/diagnostics/diagnosticsCore";
import { CAPTURE_POLICIES, classifyPayload } from "../../src/diagnostics/redaction";
import { LiveTailSink, PerfModeSink, SessionDiagSink } from "../../src/diagnostics/sinks";
import { parsePerfRepId } from "../../src/perf/perfTelemetry";
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

async function listen(server: http.Server): Promise<number> {
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("test HTTP server did not bind a TCP port");
    }
    return address.port;
}

async function close(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function eventually(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!predicate()) {
        if (Date.now() >= deadline) {
            throw new Error("condition was not met before timeout");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

suite("Core observability", () => {
    test("the no-sink path is inert", () => {
        const core = new DiagnosticsCore();
        expect(core.anySinkActive).to.equal(false);
        expect(core.emit({ feature: "test", type: "test.noop" })).to.equal(undefined);
        expect(core.lastSeq).to.equal(0);
    });

    test("the default active-sink envelope is redacted while store capture is off", () => {
        const core = new DiagnosticsCore();
        const received: DiagEvent[] = [];
        core.addSink({ id: "collecting", tryWrite: (value) => received.push(value) });

        core.emit({
            feature: "connection",
            type: "test.defaultPolicy",
            fields: { server: { raw: "private-server", cls: "server.name" } },
        });

        expect(core.captureMode).to.equal("off");
        expect(received[0].payload?.["server"].handling).to.equal("digest");
        expect(JSON.stringify(received[0])).to.not.include("private-server");
    });

    test("adding the same sink is idempotent and same-id replacement disposes the old sink", () => {
        const core = new DiagnosticsCore();
        let firstDisposals = 0;
        const received: DiagEvent[] = [];
        const first: DiagnosticSink = {
            id: "replaceable",
            tryWrite: () => undefined,
            dispose: () => firstDisposals++,
        };
        const replacement: DiagnosticSink = {
            id: "replaceable",
            tryWrite: (value) => received.push(value),
        };

        core.addSink(first);
        core.addSink(first);
        expect(firstDisposals).to.equal(0);

        core.addSink(replacement);
        core.emit({ feature: "test", type: "test.replacement" });
        expect(firstDisposals).to.equal(1);
        expect(received).to.have.length(1);
    });

    test("sink-state listeners observe transitions and can unsubscribe", () => {
        const core = new DiagnosticsCore();
        const transitions: boolean[] = [];
        const unsubscribe = core.onSinkStateChanged((active) => transitions.push(active));
        const sink: DiagnosticSink = { id: "observed", tryWrite: () => undefined };

        core.addSink(sink);
        core.addSink(sink);
        // A second sink and a same-id replacement by a DIFFERENT instance are
        // not transitions: listeners must not see churn (no [.., false, true]).
        core.addSink({ id: "other", tryWrite: () => undefined });
        core.addSink({ id: "observed", tryWrite: () => undefined });
        core.removeSink("other");
        core.removeSink(sink.id);
        unsubscribe();
        core.addSink({ id: "after-unsubscribe", tryWrite: () => undefined });

        expect(transitions).to.deep.equal([true, false]);
    });

    test("full capture duration is clamped to a positive bounded interval", () => {
        const core = new DiagnosticsCore();
        const before = Date.now();

        core.setCaptureMode("full", { durationMs: -10 });

        expect(core.captureExpiresEpochMs).to.be.at.least(before + 1_000);
        expect(core.captureExpiresEpochMs).to.be.at.most(Date.now() + 1_000);
        core.setCaptureMode("off");
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
        expect(received[1].timingClass).to.equal("officialSameProcess");
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

    test("live-tail subscription boundaries do not replay pending events or gaps", async () => {
        const sink = new LiveTailSink(2, 5);
        sink.subscribe(() => undefined);
        sink.tryWrite(event(1));
        sink.tryWrite(event(2));
        sink.tryWrite(event(3));
        sink.unsubscribe();

        let delivered: DiagEvent[] = [];
        let deliveredGap: GapRecord | undefined;
        const state = sink.subscribe((events, gap) => {
            delivered = events;
            deliveredGap = gap;
        });
        expect(state.snapshot.map((value) => value.seq)).to.deep.equal([2, 3]);

        await new Promise((resolve) => setTimeout(resolve, 15));
        expect(delivered).to.be.empty;

        sink.tryWrite(event(4));
        await new Promise((resolve) => setTimeout(resolve, 15));
        expect(delivered.map((value) => value.seq)).to.deep.equal([4]);
        expect(deliveredGap).to.equal(undefined);
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
        sink.dispose();
        expect((sink as unknown as { flushTimer: NodeJS.Timeout | undefined }).flushTimer).to.equal(
            undefined,
        );
    });

    test("the harness sink accounts for a partial non-2xx rejection exactly once", async () => {
        const server = http.createServer((request, response) => {
            request.resume();
            request.on("end", () => {
                response.writeHead(400, { "content-type": "application/json" });
                response.end(JSON.stringify({ accepted: 1, rejected: 1 }));
            });
        });
        const port = await listen(server);
        const sink = new PerfModeSink(
            `http://127.0.0.1:${port}/v1/markers`,
            "token",
            "run",
            0,
            "scenario",
        );
        try {
            sink.tryWrite({ ...event(1), tags: ["perfMarker", "phase:instant"] });
            sink.tryWrite({ ...event(2), tags: ["perfMarker", "phase:instant"] });
            sink.flush();

            await eventually(() => sink.droppedCount === 1);
            expect(sink.droppedCount).to.equal(1);
            expect(sink.health().healthy).to.equal(false);
        } finally {
            sink.dispose();
            await close(server);
        }
    });

    test("invalid harness repetition ids fall back to zero", () => {
        expect(parsePerfRepId(undefined)).to.equal(0);
        expect(parsePerfRepId("-1")).to.equal(0);
        expect(parsePerfRepId("1.5")).to.equal(0);
        expect(parsePerfRepId("not-a-number")).to.equal(0);
        expect(parsePerfRepId("9007199254740992")).to.equal(0);
        expect(parsePerfRepId("42")).to.equal(42);
    });
});
