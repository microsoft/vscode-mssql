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

import { request as httpRequest } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import type { ArtifactRef } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation, MutableLaunchSpec } from "./types";

export class CdpExtHostProfileCollector implements Collector {
    readonly name = "cdpExtHostProfile";
    readonly cost = "medium" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    readonly allowedPassTypes = ["diagnostic"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private port = 0;
    private socket: WebSocket | undefined;
    private nextId = 1;
    private readonly pendingReplies = new Map<number, (result: unknown) => void>();
    private profile: unknown;
    private profiling = false;

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
            if (!this.socket) {
                const wsUrl = await this.discoverTarget();
                await this.connect(wsUrl);
            }
            await this.send("Profiler.enable");
            await this.send("Profiler.setSamplingInterval", { interval: 100 });
            await this.send("Profiler.start");
            this.profiling = true;
            ctx.logger.info("cdpExtHost.profilerStarted");
        } catch (error) {
            ctx.logger.warn("cdpExtHost.startFailed", String(error));
        }
    }

    async onScenarioEnd(ctx: CollectorContext): Promise<void> {
        if (!this.profiling) {
            return;
        }
        try {
            const result = (await this.send("Profiler.stop")) as { profile?: unknown };
            this.profile = result?.profile;
            this.profiling = false;
            ctx.logger.info("cdpExtHost.profilerStopped");
        } catch (error) {
            ctx.logger.warn("cdpExtHost.stopFailed", String(error));
        }
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        this.socket?.close();
        this.socket = undefined;
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

    // ---------------------------------------------------------------------------

    private discoverTarget(retries = 20): Promise<string> {
        return new Promise((resolve, reject) => {
            const attempt = (remaining: number): void => {
                const req = httpRequest(
                    { host: "127.0.0.1", port: this.port, path: "/json/list", timeout: 2000 },
                    (res) => {
                        let body = "";
                        res.setEncoding("utf8");
                        res.on("data", (chunk: string) => (body += chunk));
                        res.on("end", () => {
                            try {
                                const targets = JSON.parse(body) as Array<{
                                    webSocketDebuggerUrl?: string;
                                }>;
                                const url = targets.find(
                                    (t) => t.webSocketDebuggerUrl,
                                )?.webSocketDebuggerUrl;
                                if (url) {
                                    resolve(url);
                                    return;
                                }
                            } catch {
                                // fall through to retry
                            }
                            retry(remaining);
                        });
                    },
                );
                req.on("error", () => retry(remaining));
                req.on("timeout", () => {
                    req.destroy();
                    retry(remaining);
                });
                req.end();
            };
            const retry = (remaining: number): void => {
                if (remaining <= 0) {
                    reject(new Error(`No inspector target on port ${this.port}`));
                } else {
                    setTimeout(() => attempt(remaining - 1), 500);
                }
            };
            attempt(retries);
        });
    }

    private connect(wsUrl: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(wsUrl);
            this.socket = socket;
            socket.on("open", () => resolve());
            socket.on("error", (error) => reject(error));
            socket.on("message", (data) => {
                try {
                    const message = JSON.parse(String(data)) as { id?: number; result?: unknown };
                    if (message.id !== undefined) {
                        const pending = this.pendingReplies.get(message.id);
                        if (pending) {
                            this.pendingReplies.delete(message.id);
                            pending(message.result);
                        }
                    }
                } catch {
                    // ignore non-JSON frames
                }
            });
        });
    }

    private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                reject(new Error("inspector socket not open"));
                return;
            }
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pendingReplies.delete(id);
                reject(new Error(`inspector call ${method} timed out`));
            }, 30_000);
            this.pendingReplies.set(id, (result) => {
                clearTimeout(timer);
                resolve(result);
            });
            this.socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
        });
    }
}
