import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    CompositeSink,
    HarnessLogger,
    JsonlFileSink,
    MemorySink,
    type LogEvent,
} from "../src/telemetry/logger";

describe("HarnessLogger", () => {
    it("writes structured events with component scoping", () => {
        const sink = new MemorySink();
        const root = new HarnessLogger("perftest", sink);
        root.child("controlServer").info("listening", "on port", { port: 9333 });

        expect(sink.events).toHaveLength(1);
        const event = sink.events[0]!;
        expect(event.component).toBe("perftest.controlServer");
        expect(event.event).toBe("listening");
        expect(event.fields).toEqual({ port: 9333 });
        expect(event.timestampUnixNs).toMatch(/^[0-9]+$/);
    });

    it("spans emit begin/end with duration and stable spanId", () => {
        const sink = new MemorySink();
        const logger = new HarnessLogger("perftest", sink);
        const span = logger.span("launch", { attempt: 1 });
        span.end({ pid: 42 });
        span.end(); // second call is a no-op

        expect(sink.events).toHaveLength(2);
        const [begin, end] = sink.events as [LogEvent, LogEvent];
        expect(begin.event).toBe("launch.begin");
        expect(end.event).toBe("launch.end");
        expect(begin.spanId).toBe(end.spanId);
        expect(end.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("span.fail records the error with duration", () => {
        const sink = new MemorySink();
        const logger = new HarnessLogger("perftest", sink);
        const span = logger.span("connect");
        span.fail(new Error("boom"));

        const end = sink.events[1]!;
        expect(end.event).toBe("connect.failed");
        expect(end.level).toBe("error");
        expect(end.message).toBe("boom");
    });

    it("JSONL sink appends parseable lines and composite isolates sink failures", () => {
        const dir = mkdtempSync(join(tmpdir(), "perflog-"));
        const file = join(dir, "nested", "harness-log.jsonl");
        try {
            const failing = {
                write: () => {
                    throw new Error("sink down");
                },
            };
            const sink = new CompositeSink(failing, new JsonlFileSink(file));
            const logger = new HarnessLogger("perftest", sink);
            logger.info("one");
            logger.warn("two", "careful");

            const lines = readFileSync(file, "utf8").trim().split("\n");
            expect(lines).toHaveLength(2);
            const parsed = lines.map((l) => JSON.parse(l) as LogEvent);
            expect(parsed[0]!.event).toBe("one");
            expect(parsed[1]!.level).toBe("warn");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
