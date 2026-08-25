/**
 * sqlServerXEvents collector (Phase-2 M8, design §19): captures EVERY SQL
 * command a scenario causes, with per-command detail, correlated to the rep
 * by Application Name (`mssql-perf/<runId>/<repId>/<scenarioId>`, set by the
 * driver's connect step).
 *
 * Session lifecycle per scenario window: create+start on scenario.start, read
 * the ring buffer then stop on scenario.end. Reads come back as FOR JSON text
 * through the provider-appropriate sqlcmd path (sqlExec seam).
 *
 * Honesty rules: correlation is by exact app-name match — events that cannot
 * be attributed to THIS rep are counted and surfaced as a validation warning,
 * never guessed into metrics. SQL text is persisted only in diagnostic passes
 * with captureSqlText enabled (synthetic DB only, §29). All metrics
 * official:false until a §12.3 calibration approves the session for
 * measurement passes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ArtifactRef, Metric } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation } from "./types";

interface XEvent {
    event_name: string;
    ts_utc: string;
    client_app_name: string | null;
    session_id: number | null;
    database_name: string | null;
    duration_us: number | null;
    cpu_time_us: number | null;
    logical_reads: number | null;
    physical_reads: number | null;
    writes: number | null;
    row_count: number | null;
    object_name: string | null;
    statement_text: string | null;
    batch_text: string | null;
}

export class SqlServerXEventsCollector implements Collector {
    readonly name = "sqlServerXEvents";
    readonly cost = "low" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    // Diagnostic-only until calibrated for measurement (§12.3).
    readonly allowedPassTypes = ["diagnostic", "calibration"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private scripts: { create: string; start: string; read: string; stop: string } | undefined;
    private matched: XEvent[] = [];
    private unmatchedCount = 0;
    private readFailed: string | undefined;
    private sessionStarted = false;

    constructor(private readonly options: { captureSqlText: boolean }) {}

    async validate(ctx: CollectorContext): Promise<CollectorValidation[]> {
        if (!ctx.sqlExec) {
            return [
                {
                    name: "sqlExecAvailable",
                    status: "warning",
                    message: "no SQL executor for this provider; XEvents collector disabled",
                },
            ];
        }
        const dir = resolve("sql", "xevents");
        const files = {
            create: join(dir, "create-perf-session.sql"),
            start: join(dir, "start-perf-session.sql"),
            read: join(dir, "read-perf-session.sql"),
            stop: join(dir, "stop-perf-session.sql"),
        };
        for (const [key, path] of Object.entries(files)) {
            if (!existsSync(path)) {
                return [
                    {
                        name: "xeventScripts",
                        status: "warning",
                        message: `missing ${key} script at ${path}; XEvents collector disabled`,
                    },
                ];
            }
        }
        this.scripts = {
            create: readFileSync(files.create, "utf8"),
            start: readFileSync(files.start, "utf8"),
            read: readFileSync(files.read, "utf8"),
            stop: readFileSync(files.stop, "utf8"),
        };
        return [{ name: "xeventScripts", status: "passed" }];
    }

    async onScenarioStart(ctx: CollectorContext): Promise<void> {
        if (!ctx.sqlExec || !this.scripts) {
            return;
        }
        try {
            await ctx.sqlExec(this.scripts.create, "xevents:create");
            await ctx.sqlExec(this.scripts.start, "xevents:start");
            this.sessionStarted = true;
            ctx.logger.info("sqlXEvents.sessionStarted");
        } catch (error) {
            this.readFailed = `session start failed: ${String(error).slice(0, 300)}`;
            ctx.logger.warn("sqlXEvents.startFailed", this.readFailed);
        }
    }

    async onScenarioEnd(ctx: CollectorContext): Promise<void> {
        if (!ctx.sqlExec || !this.scripts || !this.sessionStarted) {
            return;
        }
        try {
            // MAX_DISPATCH_LATENCY is 3s; give buffered events time to land.
            await new Promise((r) => setTimeout(r, 3500));
            const raw = await ctx.sqlExec(this.scripts.read, "xevents:read");
            const events = parseForJsonOutput(raw);
            // Prefix match: STS appends its own suffix to the application name, but
            // the runId/repId/scenarioId prefix is unique to this rep.
            const expectedApp = `mssql-perf/${ctx.runId}/${ctx.repId}/${ctx.scenarioId}`;
            for (const event of events) {
                if (event.client_app_name?.startsWith(expectedApp)) {
                    this.matched.push(event);
                } else {
                    this.unmatchedCount++;
                }
            }
            ctx.logger.info("sqlXEvents.read", undefined, {
                total: events.length,
                matched: this.matched.length,
                unmatched: this.unmatchedCount,
            });
        } catch (error) {
            this.readFailed = `ring-buffer read failed: ${String(error).slice(0, 300)}`;
            ctx.logger.warn("sqlXEvents.readFailed", this.readFailed);
        } finally {
            try {
                await ctx.sqlExec(this.scripts.stop, "xevents:stop");
            } catch (error) {
                ctx.logger.warn("sqlXEvents.stopFailed", String(error).slice(0, 200));
            }
            this.sessionStarted = false;
        }
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        if (this.matched.length === 0) {
            return [];
        }
        const sqlDir = join(ctx.artifactsDir, "sql");
        mkdirSync(sqlDir, { recursive: true });
        const persistText = this.options.captureSqlText && ctx.passType === "diagnostic";
        const lines = this.matched.map((event) => {
            const record: Record<string, unknown> = { ...event };
            if (!persistText) {
                delete record["statement_text"];
                delete record["batch_text"];
            }
            return JSON.stringify(record);
        });
        writeFileSync(join(sqlDir, "sql-activity.jsonl"), lines.join("\n") + "\n", "utf8");

        // Per-scenario rollup for humans/agents.
        const rollup = {
            commandCount: this.matched.length,
            byEvent: groupRollup(this.matched, (e) => e.event_name),
            byObject: groupRollup(
                this.matched.filter((e) => e.object_name),
                (e) => e.object_name ?? "",
            ),
            sqlTextPersisted: persistText,
        };
        writeFileSync(
            join(sqlDir, "sql-activity-rollup.json"),
            JSON.stringify(rollup, null, 2),
            "utf8",
        );
        return [
            { kind: "sqlActivity", path: "artifacts/sql/sql-activity.jsonl", retention: "always" },
            {
                kind: "sqlActivityRollup",
                path: "artifacts/sql/sql-activity-rollup.json",
                retention: "always",
            },
        ];
    }

    async normalize(ctx: CollectorContext): Promise<Metric[]> {
        void ctx;
        if (this.matched.length === 0) {
            return [];
        }
        // Statement-level events double-count their parent batch/rpc; totals use
        // rpc_completed + sql_batch_completed only (the top-level commands).
        const topLevel = this.matched.filter(
            (e) => e.event_name === "rpc_completed" || e.event_name === "sql_batch_completed",
        );
        const source = topLevel.length > 0 ? topLevel : this.matched;
        const sum = (select: (e: XEvent) => number | null): number =>
            source.reduce((total, e) => total + (select(e) ?? 0), 0);
        return [
            {
                name: "sqlserver.duration",
                value: Number((sum((e) => e.duration_us) / 1000).toFixed(3)),
                unit: "ms",
                component: "sqlserver",
                processRole: "sqlserver",
                source: "sqlServerXEvents",
                official: false,
                lowerIsBetter: true,
                confidence: "high",
                tags: { commands: source.length, correlation: "appName" },
            },
            {
                name: "sqlserver.cpu",
                value: Number((sum((e) => e.cpu_time_us) / 1000).toFixed(3)),
                unit: "ms",
                component: "sqlserver",
                processRole: "sqlserver",
                source: "sqlServerXEvents",
                official: false,
                lowerIsBetter: true,
                confidence: "high",
                tags: { commands: source.length },
            },
            {
                name: "sqlserver.logicalReads",
                value: sum((e) => e.logical_reads),
                unit: "reads",
                component: "sqlserver",
                processRole: "sqlserver",
                source: "sqlServerXEvents",
                official: false,
                lowerIsBetter: true,
                confidence: "high",
                tags: { commands: source.length },
            },
            {
                name: "sqlserver.commandCount",
                value: source.length,
                unit: "count",
                component: "sqlserver",
                processRole: "sqlserver",
                source: "sqlServerXEvents",
                official: false,
                lowerIsBetter: true,
                confidence: "high",
                tags: { allEvents: this.matched.length },
            },
        ];
    }

    /** Validation records surfaced post-run (correlation honesty). */
    postRunValidations(): CollectorValidation[] {
        const checks: CollectorValidation[] = [];
        if (this.readFailed) {
            checks.push({ name: "sqlXEventsCapture", status: "warning", message: this.readFailed });
        } else if (this.matched.length === 0 && this.unmatchedCount > 0) {
            checks.push({
                name: "sqlXEventsCorrelation",
                status: "warning",
                message: `${this.unmatchedCount} event(s) captured but none matched this rep's app name`,
            });
        } else if (this.matched.length > 0) {
            checks.push({
                name: "sqlXEventsCorrelation",
                status: "passed",
                message: `${this.matched.length} matched, ${this.unmatchedCount} other-rep/other-client events excluded`,
            });
        }
        return checks;
    }
}

function groupRollup(
    events: XEvent[],
    keyOf: (e: XEvent) => string,
): Record<string, { count: number; durationMs: number; logicalReads: number; rows: number }> {
    const groups: Record<
        string,
        { count: number; durationMs: number; logicalReads: number; rows: number }
    > = {};
    for (const event of events) {
        const key = keyOf(event);
        const group = (groups[key] ??= { count: 0, durationMs: 0, logicalReads: 0, rows: 0 });
        group.count += 1;
        group.durationMs += (event.duration_us ?? 0) / 1000;
        group.logicalReads += event.logical_reads ?? 0;
        group.rows += event.row_count ?? 0;
    }
    for (const group of Object.values(groups)) {
        group.durationMs = Number(group.durationMs.toFixed(3));
    }
    return groups;
}

/**
 * Parse sqlcmd FOR JSON output: sqlcmd wraps long JSON across lines; FOR JSON
 * escapes all control characters, so rejoining the lines restores the JSON.
 */
export function parseForJsonOutput(raw: string): XEvent[] {
    const joined = raw
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .join("")
        .trim();
    if (!joined || joined === "NULL") {
        return [];
    }
    const start = joined.indexOf("[");
    const end = joined.lastIndexOf("]");
    if (start < 0 || end <= start) {
        return [];
    }
    return JSON.parse(joined.slice(start, end + 1)) as XEvent[];
}
