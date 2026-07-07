/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Rich diagnostics collection ("COLLECT_ALL_THE_DATA" intent): a bounded,
 * opt-in enrichment layer for the extension host. While enabled AND a sink is
 * active it:
 *   - samples heap/RSS/external memory, CPU-usage deltas, and event-loop delay
 *     percentiles every 2s as `system.rich.snapshot` counter events;
 *   - provides the cheap per-span metric snapshot the diagnostics core attaches
 *     to span ends (heap delta, event-loop p95).
 *
 * Gates (all real, no silent elevation):
 *   - setting `mssql.debugConsole.richCollection`
 *   - env     `MSSQL_COLLECT_ALL_THE_DATA=1`
 *   - a self-test run started with "collect rich diagnostics" (window-scoped)
 *
 * Off ⇒ zero cost: no timers, no observers, no per-span reads. Metrics are
 * diagnostic-only (never official-eligible) and carry no user data.
 */

import { monitorEventLoopDelay, IntervalHistogram } from "perf_hooks";
import { diag } from "./diagnosticsCore";

const SAMPLE_INTERVAL_MS = 2000;

/**
 * The 2 s system.rich.snapshot heartbeat is NOISY in journals and rarely
 * needed (per-span rich deltas cover most investigations). It emits only
 * when mssql.debugConsole.richSnapshotHeartbeat is ALSO on (default off);
 * the sampler still runs so span deltas and percentiles stay available.
 */
function heartbeatEnabled(): boolean {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscode = require("vscode") as typeof import("vscode");
        return vscode.workspace
            .getConfiguration("mssql.debugConsole")
            .get<boolean>("richSnapshotHeartbeat", false);
    } catch {
        return false;
    }
}

class RichStatsCollector {
    private timer: NodeJS.Timeout | undefined;
    private loopHistogram: IntervalHistogram | undefined;
    private lastCpu: NodeJS.CpuUsage | undefined;
    /** Reasons keep the mode on until every enabler releases it. */
    private enablers = new Set<string>();

    public enable(reason: string): void {
        this.enablers.add(reason);
        if (this.timer) {
            return;
        }
        diag.setRichMode(true, reason);
        try {
            this.loopHistogram = monitorEventLoopDelay({ resolution: 20 });
            this.loopHistogram.enable();
        } catch {
            this.loopHistogram = undefined;
        }
        this.lastCpu = process.cpuUsage();
        diag.setRichProvider(() => this.snapshotMetrics(false));
        this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
        this.timer.unref?.();
    }

    public disable(reason: string): void {
        this.enablers.delete(reason);
        if (this.enablers.size > 0) {
            return;
        }
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        try {
            this.loopHistogram?.disable();
        } catch {
            // already disabled
        }
        this.loopHistogram = undefined;
        diag.setRichProvider(undefined);
        diag.setRichMode(false, reason);
    }

    public get active(): boolean {
        return this.timer !== undefined;
    }

    /** Cheap reads only — safe to call per span end under rich mode. */
    private snapshotMetrics(resetLoop: boolean): Record<string, number> {
        const metrics: Record<string, number> = {};
        try {
            const memory = process.memoryUsage();
            metrics["heapUsedMB"] = Number((memory.heapUsed / 1048576).toFixed(1));
            metrics["rssMB"] = Number((memory.rss / 1048576).toFixed(1));
            metrics["externalMB"] = Number((memory.external / 1048576).toFixed(1));
        } catch {
            // metrics stay absent — never fabricated
        }
        const histogram = this.loopHistogram;
        if (histogram) {
            try {
                metrics["eventLoopP50Ms"] = Number((histogram.percentile(50) / 1e6).toFixed(2));
                metrics["eventLoopP95Ms"] = Number((histogram.percentile(95) / 1e6).toFixed(2));
                metrics["eventLoopMaxMs"] = Number((histogram.max / 1e6).toFixed(2));
                if (resetLoop) {
                    histogram.reset();
                }
            } catch {
                // histogram unavailable mid-teardown
            }
        }
        return metrics;
    }

    private sample(): void {
        if (!diag.anySinkActive) {
            return; // nobody listening — skip the work entirely
        }
        if (!heartbeatEnabled()) {
            // Keep sampling internals warm for span deltas; just do not
            // journal the heartbeat event (Karl: journal noise).
            return;
        }
        try {
            const metrics = this.snapshotMetrics(true);
            if (this.lastCpu) {
                const cpu = process.cpuUsage(this.lastCpu);
                this.lastCpu = process.cpuUsage();
                metrics["cpuUserMs"] = Number((cpu.user / 1000).toFixed(1));
                metrics["cpuSystemMs"] = Number((cpu.system / 1000).toFixed(1));
            }
            const fields: Record<string, { raw: number; cls: "diagnostic.metadata" }> = {};
            for (const [key, value] of Object.entries(metrics)) {
                fields[key] = { raw: value, cls: "diagnostic.metadata" };
            }
            diag.emit({
                feature: "system",
                kind: "metric",
                type: "system.rich.snapshot",
                fields,
                tags: ["rich", "phase:counter"],
            });
        } catch {
            // enrichment must never break the product
        }
    }
}

/** Singleton rich collector; wire gates through enable/disable with a reason. */
export const richStats = new RichStatsCollector();
