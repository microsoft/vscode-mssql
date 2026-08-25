import { describe, expect, it } from "vitest";
import {
    normalizeMultiplexerTransportStats,
    normalizeQueryCoordinatorStats,
    normalizeQueryPipelineStats,
    normalizeRpcTransportStats,
    parseMultiplexerTransportStatsLog,
    parseRpcTransportStatsLog,
} from "../src/collectors/stsEnvelopeJournal";

describe("stsEnvelopeJournal query pipeline normalization", () => {
    it("sums additive stats, keeps the maximum payload, and excludes correlation ids", () => {
        const metrics = normalizeQueryPipelineStats([
            {
                kind: "diag",
                type: "sts2.query.stats",
                payload: {
                    status: "succeeded",
                    pagesSent: 2,
                    stats: {
                        pages: 2,
                        rows: 100,
                        encodedBytes: 1_000,
                        maxEventPayloadBytes: 700,
                        rowsSerializeMsTotal: 1.25,
                        postBuildAllocatedBytes: 4_000,
                    },
                },
            },
            {
                kind: "diag",
                type: "sts2.query.stats",
                payload: {
                    pagesSent: 3,
                    stats: {
                        pages: 3,
                        rows: 150,
                        encodedBytes: 2_000,
                        maxEventPayloadBytes: 650,
                        rowsSerializeMsTotal: 2.5,
                        postBuildAllocatedBytes: 6_000,
                    },
                },
            },
            { kind: "diag", type: "unrelated", payload: { stats: { rows: 999 } } },
        ]);

        const byName = new Map(metrics.map((metric) => [metric.name, metric]));
        expect(byName.get("sts2.query.pipeline.pagesSent")?.value).toBe(5);
        expect(byName.get("sts2.query.pipeline.rows")?.value).toBe(250);
        expect(byName.get("sts2.query.pipeline.encodedBytes")?.value).toBe(3_000);
        expect(byName.get("sts2.query.pipeline.maxEventPayloadBytes")?.value).toBe(700);
        expect(byName.get("sts2.query.pipeline.rowsSerializeMsTotal")?.value).toBe(3.75);
        expect(byName.get("sts2.query.pipeline.postBuildAllocatedBytes")?.value).toBe(10_000);
        expect(byName.get("sts2.query.pipeline.rows")?.tags).toEqual({
            samples: 2,
            derivedFrom: "sts2.query.stats",
        });
        expect(JSON.stringify(metrics)).not.toContain("queryId");
        expect(JSON.stringify(metrics)).not.toContain("connectionId");
    });

    it("normalizes post-driver coordinator stages without correlation tags", () => {
        const metrics = normalizeQueryCoordinatorStats([
            {
                kind: "metric",
                type: "sts2.query.coordinator.stats",
                payload: {
                    queryId: "q-private-1",
                    status: "completed",
                    pages: 20,
                    captureCanonicalBytes: 5_900_000,
                    captureMsTotal: 80.25,
                    captureAllocatedBytes: 17_000_000,
                    outputActionMsTotal: 160.5,
                    outputActionAllocatedBytes: 9_000_000,
                },
            },
            {
                kind: "metric",
                type: "sts2.query.coordinator.stats",
                payload: {
                    queryId: "q-private-2",
                    pages: 1,
                    captureCanonicalBytes: 100,
                    captureMsTotal: 0.25,
                    captureAllocatedBytes: 1_000,
                    outputActionMsTotal: 0.5,
                    outputActionAllocatedBytes: 500,
                },
            },
        ]);

        const byName = new Map(metrics.map((metric) => [metric.name, metric]));
        expect(byName.get("sts2.query.coordinator.pages")?.value).toBe(21);
        expect(byName.get("sts2.query.coordinator.captureCanonicalBytes")?.value).toBe(5_900_100);
        expect(byName.get("sts2.query.coordinator.captureMsTotal")?.value).toBe(80.5);
        expect(byName.get("sts2.query.coordinator.captureAllocatedBytes")?.value).toBe(17_001_000);
        expect(byName.get("sts2.query.coordinator.outputActionMsTotal")?.tags).toEqual({
            samples: 2,
            derivedFrom: "sts2.query.coordinator.stats",
        });
        expect(JSON.stringify(metrics)).not.toContain("q-private");
    });

    it("parses and normalizes content-free multiplexer transport summaries", () => {
        const line =
            '2026-07-14T00:00:00.0000000+00:00 [transportStats] {"schema":"sts2.transport.stats/1","legacy":{"outboundFrames":2,"outboundFrameBytes":200},"sts2":{"outboundFrames":20,"outboundFrameBytes":5900000,"maxOutboundFrameBytes":300000,"pipeSegments":40,"multiSegmentFrames":20,"materializedFrames":20,"materializedBytes":5900000,"materializeMsTotal":2.75,"materializeAllocatedBytes":5901000,"stdoutWriteMsTotal":8.5}}';
        const snapshots = parseMultiplexerTransportStatsLog(
            ["ignored private-canary", line, "[transportStats] {truncated"].join("\n"),
        );
        expect(snapshots).toHaveLength(1);

        const metrics = normalizeMultiplexerTransportStats(snapshots);
        const byName = new Map(metrics.map((metric) => [metric.name, metric]));
        expect(byName.get("sts2.transport.sts2.outboundFrames")?.value).toBe(20);
        expect(byName.get("sts2.transport.sts2.outboundFrameBytes")?.value).toBe(5_900_000);
        expect(byName.get("sts2.transport.sts2.maxOutboundFrameBytes")?.value).toBe(300_000);
        expect(byName.get("sts2.transport.sts2.materializeMsTotal")?.value).toBe(2.75);
        expect(byName.get("sts2.transport.sts2.materializeAllocatedBytes")?.tags).toEqual({
            samples: 1,
            derivedFrom: "sts2MultiplexerLog",
        });
        expect(byName.get("sts2.transport.legacy.outboundFrames")?.value).toBe(2);
        expect(JSON.stringify(metrics)).not.toContain("private-canary");
    });

    it("parses only the latest content-free RPC transport checkpoint", () => {
        const first =
            '2026-07-14T00:00:00Z [rpcTransportStats] {"schema":"sts2.rpc.transport.stats/1","messages":1,"bytes":100,"maxMessageBytes":100,"serializeMsTotal":2,"framingCopyMsTotal":3,"flushMsTotal":4,"rowMessages":1,"rowBytes":100}';
        const latest =
            '2026-07-14T00:00:01Z [rpcTransportStats] {"schema":"sts2.rpc.transport.stats/1","directPipeEndpoint":1,"messages":2,"bytes":250,"maxMessageBytes":150,"bufferRequests":7,"maxBufferSizeHint":4096,"serializeMsTotal":3.25,"serializeAllocatedBytes":800,"framingCopyMsTotal":4.5,"framingCopyAllocatedBytes":1200,"flushMsTotal":5.75,"rowMessages":1,"rowBytes":150}';
        const snapshots = parseRpcTransportStatsLog(
            [first, "ignored private-canary", latest, "[rpcTransportStats] {truncated"].join("\n"),
        );
        expect(snapshots).toHaveLength(1);

        const metrics = normalizeRpcTransportStats(snapshots);
        const byName = new Map(metrics.map((metric) => [metric.name, metric]));
        expect(byName.get("sts2.rpcTransport.directPipeEndpoint")?.value).toBe(1);
        expect(byName.get("sts2.rpcTransport.messages")?.value).toBe(2);
        expect(byName.get("sts2.rpcTransport.bytes")?.value).toBe(250);
        expect(byName.get("sts2.rpcTransport.maxMessageBytes")?.value).toBe(150);
        expect(byName.get("sts2.rpcTransport.serializeMsTotal")?.value).toBe(3.25);
        expect(byName.get("sts2.rpcTransport.framingCopyAllocatedBytes")?.tags).toEqual({
            samples: 1,
            derivedFrom: "sts2RpcTransportLog",
        });
        expect(byName.get("sts2.rpcTransport.maxBufferSizeHint")?.unit).toBe("bytes");
        expect(JSON.stringify(metrics)).not.toContain("private-canary");
    });
});
