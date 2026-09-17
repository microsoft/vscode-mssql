/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * gcDump collector (Phase-2 M10.5, diagnostic only): STS managed-heap dumps
 * at scenario start and end via `dotnet-gcdump`, for offline diffing in
 * PerfView / Visual Studio. Missing tool ⇒ validation warning; capture
 * failures never corrupt the rep (§A3.6).
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactRef } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation, PerfProcess } from "./types";

export class GcDumpCollector implements Collector {
    readonly name = "gcDump";
    readonly cost = "high" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    readonly allowedPassTypes = ["diagnostic"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private available = false;
    private stsPid: number | undefined;
    private captured: string[] = [];
    private failureReason: string | undefined;

    async validate(ctx: CollectorContext): Promise<CollectorValidation[]> {
        try {
            execFileSync("dotnet-gcdump", ["--version"], {
                encoding: "utf8",
                timeout: 15_000,
                windowsHide: true,
                shell: false,
            });
            this.available = true;
            return [{ name: "gcDumpAvailable", status: "passed" }];
        } catch {
            ctx.logger.warn("gcDump.unavailable", "dotnet-gcdump not found; collector disabled");
            return [
                {
                    name: "gcDumpAvailable",
                    status: "warning",
                    message: "dotnet-gcdump not installed (dotnet tool install -g dotnet-gcdump)",
                },
            ];
        }
    }

    async onProcessDiscovered(_ctx: CollectorContext, perfProcess: PerfProcess): Promise<void> {
        if (perfProcess.role === "sts") {
            this.stsPid = perfProcess.pid;
        }
    }

    async onScenarioStart(ctx: CollectorContext): Promise<void> {
        await this.capture(ctx, "start");
    }

    async onScenarioEnd(ctx: CollectorContext): Promise<void> {
        await this.capture(ctx, "end");
    }

    private async capture(ctx: CollectorContext, label: "start" | "end"): Promise<void> {
        if (!this.available || !this.stsPid) {
            return;
        }
        const outPath = join(ctx.artifactsDir, `sts-${label}.gcdump`);
        const span = ctx.logger.span("gcDump.capture", { label, pid: this.stsPid });
        await new Promise<void>((resolve) => {
            execFile(
                "dotnet-gcdump",
                ["collect", "-p", String(this.stsPid), "-o", outPath],
                { timeout: 120_000, windowsHide: true, shell: false },
                (error, _stdout, stderr) => {
                    if (error || !existsSync(outPath)) {
                        this.failureReason = `${label} gcdump failed: ${String(stderr || error).slice(0, 200)}`;
                        span.fail(this.failureReason);
                    } else {
                        this.captured.push(`artifacts/sts-${label}.gcdump`);
                        span.end({ sizeBytes: statSync(outPath).size });
                    }
                    resolve();
                },
            );
        });
    }

    async postExit(): Promise<ArtifactRef[]> {
        return this.captured.map((path) => ({
            kind: "gcDump",
            path,
            retention: "on-regression" as const,
        }));
    }

    postRunValidations(): CollectorValidation[] {
        if (this.failureReason) {
            return [{ name: "gcDumpCapture", status: "warning", message: this.failureReason }];
        }
        if (this.captured.length === 2) {
            return [
                {
                    name: "gcDumpCapture",
                    status: "passed",
                    message: "start+end STS managed-heap dumps captured (diff in PerfView/VS)",
                },
            ];
        }
        return [];
    }
}
