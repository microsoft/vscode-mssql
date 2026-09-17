/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * cdpExtHostProfile collector (diagnostic pass only, design §14.3): V8 CPU
 * profile of the extension host across the scenario window.
 *
 * Mechanics: adds `--inspect-extensions=<port>` to the launch (a public VS
 * Code flag), connects to the Node inspector WebSocket after launch, starts
 * the V8 sampling profiler on scenario.start and stops it on scenario.end,
 * writing `exthost.cpuprofile` (openable in VS Code / Chrome DevTools /
 * speedscope). Never allowed in measurement passes — profiling perturbs
 * timing (§12.2).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactRef } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation, MutableLaunchSpec } from "./types";
import { CdpClient, discoverCdpTargets } from "./cdpClient";

export class CdpExtHostProfileCollector implements Collector {
    readonly name = "cdpExtHostProfile";
    readonly cost = "medium" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    readonly allowedPassTypes = ["diagnostic"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private port = 0;
    private client: CdpClient | undefined;
    private profile: unknown;
    private profiling = false;
    private failureReason: string | undefined;

    async validate(): Promise<CollectorValidation[]> {
        return [];
    }

    async preLaunch(ctx: CollectorContext, launch: MutableLaunchSpec): Promise<void> {
        this.port = 39000 + Math.floor(Math.random() * 20000);
        launch.args.push(`--inspect-extensions=${this.port}`);
        ctx.logger.info("cdpExtHost.inspectorRequested", undefined, { port: this.port });
    }

    async onScenarioStart(ctx: CollectorContext): Promise<void> {
        try {
            if (!this.client) {
                const targets = await discoverCdpTargets(this.port, { preferredType: "node" });
                const wsUrl = targets.find(
                    (target) => target.webSocketDebuggerUrl,
                )?.webSocketDebuggerUrl;
                if (!wsUrl) {
                    throw new Error(`No inspector target on port ${this.port}`);
                }
                this.client = new CdpClient();
                await this.client.connect(wsUrl);
            }
            await this.client.send("Profiler.enable");
            await this.client.send("Profiler.setSamplingInterval", { interval: 100 });
            await this.client.send("Profiler.start");
            this.profiling = true;
            ctx.logger.info("cdpExtHost.profilerStarted");
        } catch (error) {
            this.failureReason = `start failed: ${String(error).slice(0, 200)}`;
            ctx.logger.warn("cdpExtHost.startFailed", this.failureReason);
        }
    }

    async onScenarioEnd(ctx: CollectorContext): Promise<void> {
        if (!this.profiling) {
            return;
        }
        try {
            const result = (await this.client?.send("Profiler.stop")) as
                | { profile?: unknown }
                | undefined;
            this.profile = result?.profile;
            this.profiling = false;
            ctx.logger.info("cdpExtHost.profilerStopped");
        } catch (error) {
            this.profiling = false;
            this.failureReason = `stop failed: ${String(error).slice(0, 200)}`;
            ctx.logger.warn("cdpExtHost.stopFailed", this.failureReason);
        }
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        this.client?.close();
        this.client = undefined;
        if (!this.profile) {
            return [];
        }
        const path = join(ctx.artifactsDir, "exthost.cpuprofile");
        writeFileSync(path, JSON.stringify(this.profile), "utf8");
        return [
            {
                kind: "cdpExtHostProfile",
                path: "artifacts/exthost.cpuprofile",
                retention: "always",
            },
        ];
    }

    postRunValidations(): CollectorValidation[] {
        return this.failureReason
            ? [
                  {
                      name: "cdpExtHostProfileCapture",
                      status: "warning",
                      message: this.failureReason,
                  },
              ]
            : [];
    }
}
