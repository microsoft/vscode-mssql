/**
 * CPU sampling profile of the actual Query Studio webview target.
 *
 * VS Code exposes extension webviews as debuggable iframe targets. Chromium's
 * Tracing domain is unavailable on those targets, but Runtime and Profiler are
 * available. We identify Query Studio by a product-owned DOM sentinel, never
 * by document name, opaque target id, or caller-provided selector.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactRef, Metric } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation, MutableLaunchSpec } from "./types";
import {
    CdpClient,
    discoverCdpTargets,
    ensureCdpRemoteDebuggingPort,
    getCdpBrowserWebSocketUrl,
    isMssqlWebviewTarget,
    type CdpTarget,
} from "./cdpClient";

interface CpuProfileNode {
    id: number;
    callFrame?: { functionName?: string; url?: string };
}

interface CpuProfile {
    nodes?: CpuProfileNode[];
    startTime?: number;
    endTime?: number;
    samples?: number[];
    timeDeltas?: number[];
}

export function summarizeCpuProfile(profile: CpuProfile): {
    durationMs: number;
    sampledCpuMs: number;
    samples: number;
} {
    const nodeNames = new Map(
        (profile.nodes ?? []).map((node) => [node.id, node.callFrame?.functionName ?? ""]),
    );
    const samples = profile.samples ?? [];
    const deltas = profile.timeDeltas ?? [];
    let sampledCpuUs = 0;
    for (let index = 0; index < samples.length; index++) {
        const nodeId = samples[index];
        if (nodeId !== undefined && nodeNames.get(nodeId) !== "(idle)") {
            sampledCpuUs += deltas[index] ?? 0;
        }
    }
    return {
        durationMs: Math.max(0, ((profile.endTime ?? 0) - (profile.startTime ?? 0)) / 1000),
        sampledCpuMs: sampledCpuUs / 1000,
        samples: samples.length,
    };
}

export class CdpRendererProfileCollector implements Collector {
    readonly name = "cdpRendererProfile";
    readonly cost = "medium" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    readonly allowedPassTypes = ["diagnostic"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private port = 0;
    private client: CdpClient | undefined;
    private sessionId: string | undefined;
    private profile: CpuProfile | undefined;
    private profiling = false;
    private failureReason: string | undefined;
    private candidateCount = 0;

    async preLaunch(ctx: CollectorContext, launch: MutableLaunchSpec): Promise<void> {
        this.port = ensureCdpRemoteDebuggingPort(launch.args);
        ctx.logger.info("cdpRendererProfile.portRequested", undefined, {
            port: this.port,
        });
    }

    async onScenarioStart(ctx: CollectorContext): Promise<void> {
        try {
            const targets = await discoverCdpTargets(this.port);
            const candidates = targets.filter(
                (target) => Boolean(target.webSocketDebuggerUrl) && isMssqlWebviewTarget(target),
            );
            this.candidateCount = candidates.length;
            const attached = await this.connectToQueryStudio(candidates, ctx);
            this.client = attached?.client;
            this.sessionId = attached?.sessionId;
            if (!this.client || !this.sessionId) {
                this.failureReason = `Query Studio target not found among ${candidates.length} MSSQL webviews`;
                ctx.logger.warn("cdpRendererProfile.noQueryStudioTarget", this.failureReason);
                return;
            }

            await this.client.sendToSession(this.sessionId, "Profiler.enable");
            await this.client.sendToSession(this.sessionId, "Profiler.setSamplingInterval", {
                interval: 250,
            });
            await this.client.sendToSession(this.sessionId, "Profiler.start");
            this.profiling = true;
            ctx.logger.info("cdpRendererProfile.started", undefined, {
                mssqlWebviewCandidates: this.candidateCount,
                samplingIntervalUs: 250,
            });
        } catch (error) {
            this.failureReason = String(error).slice(0, 300);
            ctx.logger.warn("cdpRendererProfile.startFailed", this.failureReason);
        }
    }

    async onScenarioEnd(ctx: CollectorContext): Promise<void> {
        if (!this.profiling || !this.client || !this.sessionId) {
            return;
        }
        try {
            const result = (await this.client.sendToSession(this.sessionId, "Profiler.stop")) as {
                profile?: CpuProfile;
            };
            this.profile = result.profile;
            await this.client.sendToSession(this.sessionId, "Profiler.disable");
            ctx.logger.info("cdpRendererProfile.stopped", undefined, {
                samples: this.profile?.samples?.length ?? 0,
            });
        } catch (error) {
            this.failureReason = String(error).slice(0, 300);
            ctx.logger.warn("cdpRendererProfile.stopFailed", this.failureReason);
        } finally {
            this.profiling = false;
        }
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        this.client?.close();
        this.client = undefined;
        this.sessionId = undefined;
        if (!this.profile) {
            return [];
        }
        const path = join(ctx.artifactsDir, "query-studio-webview.cpuprofile");
        writeFileSync(path, JSON.stringify(this.profile), "utf8");
        return [
            {
                kind: "cdpRendererProfile",
                path: "artifacts/query-studio-webview.cpuprofile",
                retention: "on-regression",
            },
        ];
    }

    async normalize(): Promise<Metric[]> {
        if (!this.profile) {
            return [];
        }
        const summary = summarizeCpuProfile(this.profile);
        const common = {
            component: "queryStudioWebview",
            processRole: "renderer" as const,
            source: "cdp" as const,
            official: false,
            lowerIsBetter: true,
            tags: { scope: "queryStudioWebviewTarget" },
        };
        return [
            {
                name: "renderer.webview.profile.duration",
                value: summary.durationMs,
                unit: "ms",
                ...common,
            },
            {
                name: "renderer.webview.cpu.sampled",
                value: summary.sampledCpuMs,
                unit: "ms",
                ...common,
            },
            {
                name: "renderer.webview.cpu.samples",
                value: summary.samples,
                unit: "count",
                ...common,
            },
        ];
    }

    postRunValidations(): CollectorValidation[] {
        if (this.failureReason) {
            return [
                {
                    name: "rendererWebviewProfileCapture",
                    status: "warning",
                    message: this.failureReason,
                },
            ];
        }
        if (this.profile) {
            return [
                {
                    name: "rendererWebviewProfileCapture",
                    status: "passed",
                    message: `${this.profile.samples?.length ?? 0} Query Studio webview samples`,
                },
            ];
        }
        return [];
    }

    private async connectToQueryStudio(
        targets: readonly CdpTarget[],
        ctx: CollectorContext,
    ): Promise<{ client: CdpClient; sessionId: string } | undefined> {
        const outcomes: Array<Record<string, unknown>> = [];
        const browser = new CdpClient();
        await browser.connect(await getCdpBrowserWebSocketUrl(this.port));
        for (const target of targets) {
            if (!target.id || !target.webSocketDebuggerUrl) {
                continue;
            }
            const pathKind = (() => {
                try {
                    const path = new URL(target.url ?? "").pathname;
                    return path.endsWith("/index.html")
                        ? "index"
                        : path.endsWith("/fake.html")
                          ? "wrapper"
                          : "other";
                } catch {
                    return "other";
                }
            })();
            const probe = new CdpClient();
            try {
                await probe.connect(target.webSocketDebuggerUrl);
                const evaluation = (await probe.send("Runtime.evaluate", {
                    expression:
                        'Boolean(document.getElementById("qs-results-panel-results") || ' +
                        'Array.from(document.querySelectorAll("iframe")).some((frame) => { ' +
                        'try { return Boolean(frame.contentDocument?.getElementById("qs-results-panel-results")); } ' +
                        "catch { return false; } }))",
                    returnByValue: true,
                })) as { result?: { value?: unknown } };
                const hasSentinel = evaluation.result?.value === true;
                outcomes.push({ pathKind, sentinel: hasSentinel });
                probe.close();
                if (!hasSentinel) {
                    continue;
                }

                const attached = (await browser.send("Target.attachToTarget", {
                    targetId: target.id,
                    flatten: true,
                })) as { sessionId?: string };
                const sessionId = attached.sessionId;
                if (!sessionId) {
                    throw new Error("Target.attachToTarget omitted sessionId");
                }
                ctx.logger.info("cdpRendererProfile.targetProbed", undefined, {
                    outcomes,
                });
                return { client: browser, sessionId };
            } catch (error) {
                probe.close();
                outcomes.push({
                    pathKind,
                    error: String(error)
                        .replace(/wss?:\/\/[^ ]+/g, "<websocket>")
                        .slice(0, 160),
                });
                // Probe the next privacy-safe, extension-owned candidate.
            }
        }
        ctx.logger.info("cdpRendererProfile.targetProbed", undefined, {
            outcomes,
        });
        browser.close();
        return undefined;
    }
}
