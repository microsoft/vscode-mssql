/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * wprEtw collector (diagnostic pass, Windows, requires elevation): system
 * ETW capture via Windows Performance Recorder for whole-system CPU/disk
 * explanation of a scenario window. Not elevated / not Windows ⇒ validation
 * warning and the collector stays inert (§A3.6).
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactRef } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation } from "./types";

export class WprEtwCollector implements Collector {
    readonly name = "wprEtw";
    readonly cost = "high" as const;
    readonly platforms = ["win32"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    readonly allowedPassTypes = ["diagnostic"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private available = false;
    private recording = false;
    private etlPath: string | undefined;

    async validate(ctx: CollectorContext): Promise<CollectorValidation[]> {
        const checks: CollectorValidation[] = [];
        try {
            execFileSync("wpr", ["-status"], {
                encoding: "utf8",
                timeout: 15_000,
                windowsHide: true,
            });
            checks.push({ name: "wprAvailable", status: "passed" });
        } catch (error) {
            const message = String(error);
            if (/access|denied|elevat/i.test(message)) {
                checks.push({
                    name: "wprElevation",
                    status: "warning",
                    message: "wpr requires an elevated session; collector disabled",
                });
            } else {
                checks.push({
                    name: "wprAvailable",
                    status: "warning",
                    message: "wpr not available; install Windows Performance Toolkit",
                });
            }
            ctx.logger.warn("wprEtw.unavailable", message.slice(0, 200));
            return checks;
        }
        this.available = true;
        return checks;
    }

    async onScenarioStart(ctx: CollectorContext): Promise<void> {
        if (!this.available) {
            return;
        }
        try {
            execFileSync("wpr", ["-start", "GeneralProfile", "-filemode"], {
                timeout: 30_000,
                windowsHide: true,
            });
            this.recording = true;
            ctx.logger.info("wprEtw.started");
        } catch (error) {
            ctx.logger.warn("wprEtw.startFailed", String(error).slice(0, 200));
        }
    }

    async onScenarioEnd(ctx: CollectorContext): Promise<void> {
        if (!this.recording) {
            return;
        }
        this.etlPath = join(ctx.artifactsDir, "trace.etl");
        await new Promise<void>((resolve) => {
            execFile(
                "wpr",
                ["-stop", this.etlPath!],
                { timeout: 120_000, windowsHide: true },
                (error) => {
                    if (error) {
                        ctx.logger.warn("wprEtw.stopFailed", String(error).slice(0, 200));
                        this.etlPath = undefined;
                    }
                    this.recording = false;
                    resolve();
                },
            );
        });
    }

    async teardown(ctx: CollectorContext): Promise<void> {
        if (this.recording) {
            // Never leave a system-wide ETW session running.
            try {
                execFileSync("wpr", ["-cancel"], { timeout: 30_000, windowsHide: true });
            } catch (error) {
                ctx.logger.warn("wprEtw.cancelFailed", String(error).slice(0, 200));
            }
            this.recording = false;
        }
    }

    async postExit(): Promise<ArtifactRef[]> {
        if (!this.etlPath || !existsSync(this.etlPath)) {
            return [];
        }
        return [
            {
                kind: "wprEtl",
                path: "artifacts/trace.etl",
                retention: "on-regression",
                sizeBytes: statSync(this.etlPath).size,
            },
        ];
    }
}
