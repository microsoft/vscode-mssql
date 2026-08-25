/**
 * Harness self-telemetry core. Every harness component logs structured events
 * through a component-scoped HarnessLogger; sinks fan out to a pretty console
 * stream and (once a run directory exists) an append-only JSONL file
 * (`harness-log.jsonl`) so an entire run is traceable after the fact.
 *
 * Spans give begin/end pairs with durations and parent links, mirroring the
 * marker model the harness applies to the product — the harness holds itself
 * to the same observability bar it demands of the system under test.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
};

export interface LogEvent {
    timestampUnixNs: string;
    level: LogLevel;
    component: string;
    event: string;
    message?: string;
    spanId?: string;
    parentSpanId?: string;
    durationMs?: number;
    fields?: Record<string, unknown>;
}

export interface LogSink {
    write(event: LogEvent): void;
    close?(): void;
}

function nowUnixNs(): string {
    return (BigInt(Date.now()) * 1_000_000n).toString();
}

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

export class ConsoleSink implements LogSink {
    constructor(private readonly minLevel: LogLevel = "info") {}

    write(event: LogEvent): void {
        if (LEVEL_ORDER[event.level] < LEVEL_ORDER[this.minLevel]) {
            return;
        }
        const time = new Date(Number(BigInt(event.timestampUnixNs) / 1_000_000n))
            .toISOString()
            .slice(11, 23);
        const dur = event.durationMs !== undefined ? ` (${event.durationMs.toFixed(1)}ms)` : "";
        const msg = event.message ? ` ${event.message}` : "";
        const fields =
            event.fields && Object.keys(event.fields).length > 0
                ? ` ${JSON.stringify(event.fields)}`
                : "";
        const line = `[${time}] ${event.level.toUpperCase().padEnd(5)} ${event.component} ${event.event}${dur}${msg}${fields}`;
        if (event.level === "error") {
            process.stderr.write(line + "\n");
        } else {
            process.stdout.write(line + "\n");
        }
    }
}

/** Append-only JSONL sink; writes every level so run logs are complete. */
export class JsonlFileSink implements LogSink {
    private opened = false;

    constructor(private readonly filePath: string) {}

    write(event: LogEvent): void {
        if (!this.opened) {
            mkdirSync(dirname(this.filePath), { recursive: true });
            this.opened = true;
        }
        appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf8");
    }
}

export class CompositeSink implements LogSink {
    private readonly sinks: LogSink[];

    constructor(...sinks: LogSink[]) {
        this.sinks = sinks;
    }

    add(sink: LogSink): void {
        this.sinks.push(sink);
    }

    write(event: LogEvent): void {
        for (const sink of this.sinks) {
            try {
                sink.write(event);
            } catch {
                // A failing sink must never take down the harness.
            }
        }
    }

    close(): void {
        for (const sink of this.sinks) {
            sink.close?.();
        }
    }
}

/** In-memory sink for tests. */
export class MemorySink implements LogSink {
    readonly events: LogEvent[] = [];

    write(event: LogEvent): void {
        this.events.push(event);
    }
}

// ---------------------------------------------------------------------------
// Logger and spans
// ---------------------------------------------------------------------------

export interface HarnessSpan {
    readonly spanId: string;
    /** Log the end event with duration; safe to call once. */
    end(fields?: Record<string, unknown>): void;
    /** Log a failure end event with duration and error details. */
    fail(error: unknown, fields?: Record<string, unknown>): void;
}

export class HarnessLogger {
    constructor(
        private readonly component: string,
        private readonly sink: LogSink,
        private readonly parentSpanId?: string,
    ) {}

    child(component: string, parentSpanId?: string): HarnessLogger {
        return new HarnessLogger(
            `${this.component}.${component}`,
            this.sink,
            parentSpanId ?? this.parentSpanId,
        );
    }

    log(
        level: LogLevel,
        event: string,
        message?: string,
        fields?: Record<string, unknown>,
        span?: { spanId?: string; parentSpanId?: string; durationMs?: number },
    ): void {
        const entry: LogEvent = {
            timestampUnixNs: nowUnixNs(),
            level,
            component: this.component,
            event,
        };
        if (message !== undefined) entry.message = message;
        if (fields !== undefined) entry.fields = fields;
        const spanId = span?.spanId;
        if (spanId !== undefined) entry.spanId = spanId;
        const parent = span?.parentSpanId ?? this.parentSpanId;
        if (parent !== undefined) entry.parentSpanId = parent;
        if (span?.durationMs !== undefined) entry.durationMs = span.durationMs;
        this.sink.write(entry);
    }

    trace(event: string, message?: string, fields?: Record<string, unknown>): void {
        this.log("trace", event, message, fields);
    }

    debug(event: string, message?: string, fields?: Record<string, unknown>): void {
        this.log("debug", event, message, fields);
    }

    info(event: string, message?: string, fields?: Record<string, unknown>): void {
        this.log("info", event, message, fields);
    }

    warn(event: string, message?: string, fields?: Record<string, unknown>): void {
        this.log("warn", event, message, fields);
    }

    error(event: string, message?: string, fields?: Record<string, unknown>): void {
        this.log("error", event, message, fields);
    }

    /**
     * Start a traced span: logs `<event>.begin` now and `<event>.end` (with
     * durationMs) when ended. Nest child work under it via
     * `logger.child(name, span.spanId)`.
     */
    span(event: string, fields?: Record<string, unknown>): HarnessSpan {
        const spanId = randomBytes(8).toString("hex");
        const startedAt = process.hrtime.bigint();
        let done = false;
        this.log("debug", `${event}.begin`, undefined, fields, {
            spanId,
            ...(this.parentSpanId !== undefined ? { parentSpanId: this.parentSpanId } : {}),
        });
        const durationMs = (): number => Number(process.hrtime.bigint() - startedAt) / 1e6;
        return {
            spanId,
            end: (endFields?: Record<string, unknown>): void => {
                if (done) return;
                done = true;
                this.log("info", `${event}.end`, undefined, endFields, {
                    spanId,
                    durationMs: durationMs(),
                });
            },
            fail: (error: unknown, endFields?: Record<string, unknown>): void => {
                if (done) return;
                done = true;
                const err = error instanceof Error ? error.message : String(error);
                this.log("error", `${event}.failed`, err, endFields, {
                    spanId,
                    durationMs: durationMs(),
                });
            },
        };
    }
}

export interface RootLoggerOptions {
    consoleLevel?: LogLevel;
    /** When set, all events (every level) are appended to this JSONL file. */
    jsonlPath?: string;
}

/** Create the root harness logger. Component names nest with dots. */
export function createRootLogger(options: RootLoggerOptions = {}): {
    logger: HarnessLogger;
    sink: CompositeSink;
} {
    const envLevel = process.env["PERFTEST_LOG_LEVEL"] as LogLevel | undefined;
    const level = options.consoleLevel ?? (envLevel && envLevel in LEVEL_ORDER ? envLevel : "info");
    const sink = new CompositeSink(new ConsoleSink(level));
    if (options.jsonlPath) {
        sink.add(new JsonlFileSink(options.jsonlPath));
    }
    return { logger: new HarnessLogger("perftest", sink), sink };
}
