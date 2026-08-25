/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * dotnetTrace collector (diagnostic pass only): EventPipe trace of the STS
 * process via the `dotnet-trace` tool on PATH. A bounded trace starts when STS
 * self-reports its pid, then the scenario-end barrier waits for natural expiry
 * while STS is still alive so EventPipe can emit managed-symbol rundown.
 * Missing tool ⇒ validation warning, never a corrupted rep (§A3.6).
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactRef, DotnetTraceProfile } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation, PerfProcess } from "./types";

export class DotnetTraceCollector implements Collector {
    readonly name = "dotnetTrace";
    readonly cost = "high" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    readonly allowedPassTypes = ["diagnostic"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private available = false;
    private child: ChildProcess | undefined;
    private outputPath: string | undefined;
    private completionPromise: Promise<void> | undefined;
    private readonly durationSeconds: number;

    constructor(
        private readonly profile: DotnetTraceProfile = "cpu",
        durationSeconds = 15,
    ) {
        this.durationSeconds = Math.max(1, Math.trunc(durationSeconds));
    }

    async validate(ctx: CollectorContext): Promise<CollectorValidation[]> {
        try {
            execFileSync("dotnet-trace", ["--version"], {
                encoding: "utf8",
                timeout: 15_000,
                windowsHide: true,
                shell: false,
            });
            this.available = true;
            return [{ name: "dotnetTraceAvailable", status: "passed" }];
        } catch {
            ctx.logger.warn(
                "dotnetTrace.unavailable",
                "dotnet-trace not found; collector disabled",
            );
            return [
                {
                    name: "dotnetTraceAvailable",
                    status: "warning",
                    message: "dotnet-trace not installed (dotnet tool install -g dotnet-trace)",
                },
            ];
        }
    }

    async onProcessDiscovered(ctx: CollectorContext, perfProcess: PerfProcess): Promise<void> {
        if (!this.available || perfProcess.role !== "sts" || this.child) return;

        this.outputPath = join(ctx.artifactsDir, "sts.nettrace");
        ctx.logger.info("dotnetTrace.attach", undefined, {
            pid: perfProcess.pid,
            profile: this.profile,
            durationSeconds: this.durationSeconds,
        });
        const toolLog = createWriteStream(join(ctx.artifactsDir, "dotnet-trace.log"));
        const child = spawn(
            "dotnet-trace",
            buildDotnetTraceArgs(
                perfProcess.pid,
                this.outputPath,
                this.profile,
                this.durationSeconds,
            ),
            {
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
                shell: false,
            },
        );
        this.child = child;
        const attachPromise = waitForTraceAttach(child, 5_000);
        let toolLogEnded = false;
        const endToolLog = () => {
            if (!toolLogEnded) {
                toolLogEnded = true;
                toolLog.end();
            }
        };
        toolLog.on("error", (error) => {
            ctx.logger.warn("dotnetTrace.logFailed", String(error));
        });
        child.stdout?.pipe(toolLog, { end: false });
        child.stderr?.pipe(toolLog, { end: false });
        child.on("error", (error) => {
            ctx.logger.warn("dotnetTrace.spawnFailed", String(error));
            this.child = undefined;
            endToolLog();
        });
        child.on("exit", (code) => {
            ctx.logger.info("dotnetTrace.exited", undefined, { code });
            endToolLog();
        });
        const attached = await attachPromise;
        ctx.logger.info("dotnetTrace.ready", undefined, { attached });
    }

    async onScenarioEnd(ctx: CollectorContext): Promise<void> {
        await this.finishTrace(ctx);
    }

    async preShutdown(ctx: CollectorContext): Promise<void> {
        await this.finishTrace(ctx);
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        // Fallback for failures before a scenario-end marker. Partial traces are
        // still retained if the target process has already exited.
        await this.finishTrace(ctx);
        this.child = undefined;
        if (!this.outputPath || !existsSync(this.outputPath)) {
            return [];
        }
        return [
            {
                kind: "dotnetTrace",
                path: "artifacts/sts.nettrace",
                retention: "on-regression",
                sizeBytes: statSync(this.outputPath).size,
            },
        ];
    }

    private async finishTrace(ctx: CollectorContext): Promise<void> {
        const child = this.child;
        if (!child || child.exitCode !== null || child.signalCode !== null) {
            return;
        }
        if (!this.completionPromise) {
            this.completionPromise = new Promise<void>((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve();
                };
                const timer = setTimeout(
                    () => {
                        ctx.logger.warn(
                            "dotnetTrace.stopTimeout",
                            `dotnet-trace did not finalize within ${this.durationSeconds + 10}s`,
                        );
                        child.kill();
                        finish();
                    },
                    (this.durationSeconds + 10) * 1_000,
                );
                child.once("exit", finish);
                child.once("error", finish);
            });
        }
        await this.completionPromise;
    }
}

async function waitForTraceAttach(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        let output = "";
        let settled = false;
        const finish = (attached: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.stdout?.off("data", onData);
            child.stderr?.off("data", onData);
            resolve(attached);
        };
        const onData = (chunk: Buffer | string) => {
            output = (output + chunk.toString()).slice(-16_384);
            if (/Process\s*:/i.test(output)) finish(true);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);
        child.once("exit", () => finish(false));
        child.once("error", () => finish(false));
    });
}

/** Build a shell-free, testable command line. CPU sampling remains the CLI default. */
export function buildDotnetTraceArgs(
    processId: number,
    outputPath: string,
    profile: DotnetTraceProfile,
    durationSeconds = 15,
): string[] {
    const args = ["collect"];
    // dotnet-trace 9 rejects naming its default CPU profile explicitly.
    if (profile !== "cpu") {
        args.push("--profile", profile);
    }
    args.push("--duration", formatDotnetTraceDuration(durationSeconds));
    args.push("--process-id", String(processId), "-o", outputPath);
    return args;
}

export function formatDotnetTraceDuration(durationSeconds: number): string {
    let remaining = Math.max(1, Math.trunc(durationSeconds));
    const days = Math.floor(remaining / 86_400);
    remaining %= 86_400;
    const hours = Math.floor(remaining / 3_600);
    remaining %= 3_600;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return [days, hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
