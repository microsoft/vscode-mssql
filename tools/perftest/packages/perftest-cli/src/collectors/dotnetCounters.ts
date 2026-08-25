/**
 * dotnetCounters collector (Phase-3 12.4, diagnostic only): live time-series
 * of STS runtime + sts2 counters via `dotnet-counters collect`.
 *
 * Windows stop story: dotnet-counters (like dotnet-trace) finalizes its
 * output when the TARGET process exits — STS exits at rep teardown, so no
 * console-signal games are needed; we wait boundedly for the tool to exit.
 * Missing tool ⇒ validation warning, never a corrupted rep (§A3.6).
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactRef, Metric } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation, PerfProcess } from "./types";

export class DotnetCountersCollector implements Collector {
    readonly name = "dotnetCounters";
    readonly cost = "low" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    // Diagnostic-only until a §12.3 calibration approves it for measurement.
    readonly allowedPassTypes = ["diagnostic", "calibration"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private available = false;
    private child: ChildProcess | undefined;
    private outputPath: string | undefined;

    async validate(ctx: CollectorContext): Promise<CollectorValidation[]> {
        try {
            execFileSync("dotnet-counters", ["--version"], {
                encoding: "utf8",
                timeout: 15_000,
                windowsHide: true,
                shell: process.platform === "win32",
            });
            this.available = true;
            return [{ name: "dotnetCountersAvailable", status: "passed" }];
        } catch {
            ctx.logger.warn(
                "dotnetCounters.unavailable",
                "dotnet-counters not found; collector disabled",
            );
            return [
                {
                    name: "dotnetCountersAvailable",
                    status: "warning",
                    message:
                        "dotnet-counters not installed (dotnet tool install -g dotnet-counters)",
                },
            ];
        }
    }

    async onProcessDiscovered(ctx: CollectorContext, perfProcess: PerfProcess): Promise<void> {
        if (!this.available || perfProcess.role !== "sts" || this.child) {
            return;
        }
        this.outputPath = join(ctx.artifactsDir, "sts-counters.csv");
        const toolLog = createWriteStream(join(ctx.artifactsDir, "dotnet-counters.log"));
        ctx.logger.info("dotnetCounters.attach", undefined, { pid: perfProcess.pid });
        this.child = spawn(
            "dotnet-counters",
            [
                "collect",
                "--process-id",
                String(perfProcess.pid),
                "--refresh-interval",
                "1",
                "--counters",
                "System.Runtime,Microsoft-SqlTools-Sts2",
                "--format",
                "csv",
                "-o",
                this.outputPath,
            ],
            {
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
                shell: process.platform === "win32",
            },
        );
        this.child.stdout?.pipe(toolLog);
        this.child.stderr?.pipe(toolLog);
        this.child.on("error", (error) => {
            ctx.logger.warn("dotnetCounters.spawnFailed", String(error));
            this.child = undefined;
        });
        this.child.on("exit", (code) => {
            ctx.logger.info("dotnetCounters.exited", undefined, { code });
        });
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        if (this.child && this.child.exitCode === null) {
            // Target has exited; the tool notices and finalizes the CSV.
            await new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                    this.child?.kill();
                    resolve();
                }, 15_000);
                this.child?.once("exit", () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
        this.child = undefined;
        void ctx;
        if (!this.outputPath || !existsSync(this.outputPath)) {
            return [];
        }
        return [
            {
                kind: "dotnetCounters",
                path: "artifacts/sts-counters.csv",
                retention: "on-regression",
                sizeBytes: statSync(this.outputPath).size,
            },
        ];
    }

    async normalize(): Promise<Metric[]> {
        // Summarize a couple of headline series from the CSV (peak working set,
        // peak GC heap). CSV format: Timestamp,Provider,Counter Name,Counter Type,Mean/Increment
        if (!this.outputPath || !existsSync(this.outputPath)) {
            return [];
        }
        const peaks = new Map<string, number>();
        try {
            for (const line of readFileSync(this.outputPath, "utf8").split("\n").slice(1)) {
                const parts = line.split(",");
                if (parts.length < 5) continue;
                const name = parts[2]?.trim() ?? "";
                const value = Number(parts[4]);
                if (!Number.isFinite(value)) continue;
                if (name === "Working Set (MB)" || name === "GC Heap Size (MB)") {
                    peaks.set(name, Math.max(peaks.get(name) ?? 0, value));
                }
            }
        } catch {
            return [];
        }
        const metrics: Metric[] = [];
        for (const [name, value] of peaks) {
            metrics.push({
                name: name === "Working Set (MB)" ? "sts.workingSet.peak" : "sts.gcHeap.peak",
                value: Number(value.toFixed(1)),
                unit: "MB",
                component: "sts",
                processRole: "sts",
                source: "dotnetCounters",
                official: false,
                lowerIsBetter: true,
            });
        }
        return metrics;
    }
}
