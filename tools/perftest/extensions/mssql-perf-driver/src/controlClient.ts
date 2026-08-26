/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Control-channel client (design §9/§16): connects to the orchestrator's
 * WebSocket, authenticates with the one-time token, answers clock
 * calibration, executes scenarios, and emits markers.
 *
 * Uses the extension host's global WebSocket (Node >= 22) so the driver has
 * zero runtime dependencies and can be loaded straight from its folder.
 */

import * as vscode from "vscode";
import { MarkerBus, type BusMarker } from "./markerBus";
import { runScenario, type ConnectionProfileSpec, type ScenarioSpec } from "./scenarioEngine";

export interface ControlClientOptions {
    controlUrl: string;
    token: string;
    runId: string;
    repId: number;
    scenarioId: string;
}

interface ControlEnvelope {
    schemaVersion: 1;
    kind: string;
    runId: string;
    repId: number;
    scenarioId: string;
    timestampUnixNs: string;
    sender: { role: string; pid: number; name: string };
    payload?: unknown;
}

function nowUnixNs(): string {
    return (BigInt(Date.now()) * 1_000_000n).toString();
}

export class ControlClient implements vscode.Disposable {
    private socket: WebSocket | undefined;
    private readonly bus = new MarkerBus();
    private repId: number;
    private scenarioId: string;
    private disposed = false;
    private scenarioBoundaryWait:
        | {
              phase: "start" | "end";
              resolve: () => void;
              reject: (error: Error) => void;
              timer: ReturnType<typeof setTimeout>;
          }
        | undefined;

    constructor(private readonly options: ControlClientOptions) {
        this.repId = options.repId;
        this.scenarioId = options.scenarioId;
    }

    connect(): void {
        this.log(`connecting to ${this.options.controlUrl}`);
        const socket = new WebSocket(this.options.controlUrl);
        this.socket = socket;

        socket.onopen = () => {
            this.send("hello", {
                token: this.options.token,
                vscodeVersion: vscode.version,
                driverVersion: "0.1.0",
                extensionHostPid: process.pid,
            });
            // Basic environment checks (§9.2 step 4) — all cheap and local.
            const checks = [
                {
                    name: "workspaceTrust",
                    status: vscode.workspace.isTrusted ? ("passed" as const) : ("warning" as const),
                },
            ];
            this.send("ready", { checks });
        };

        socket.onmessage = (event: MessageEvent) => {
            void this.onMessage(String(event.data)).catch((error: unknown) => {
                this.log(
                    `control message failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            });
        };

        socket.onclose = () => {
            this.log("control socket closed");
            this.rejectBoundaryWait(new Error("control socket closed"));
        };

        socket.onerror = () => {
            this.log("control socket error");
        };
    }

    private async onMessage(raw: string): Promise<void> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this.log(`bad JSON from control server: ${raw.slice(0, 200)}`);
            return;
        }
        if (!isControlEnvelope(parsed)) {
            this.log("invalid control message shape");
            return;
        }
        const message = parsed;
        if (
            message.runId !== this.options.runId ||
            message.repId !== this.repId ||
            message.scenarioId !== this.scenarioId
        ) {
            this.log(`ignored mismatched control envelope '${message.kind}'`);
            return;
        }
        try {
            switch (message.kind) {
                case "calibrationPing": {
                    const e1 = nowUnixNs();
                    if (
                        !isRecord(message.payload) ||
                        typeof message.payload["seq"] !== "number" ||
                        typeof message.payload["t0UnixNs"] !== "string"
                    ) {
                        throw new Error("calibrationPing payload is invalid");
                    }
                    const payload = message.payload;
                    this.send("calibrationPong", {
                        seq: payload.seq,
                        t0UnixNs: payload.t0UnixNs,
                        e1UnixNs: e1,
                        e2UnixNs: nowUnixNs(),
                    });
                    break;
                }
                case "startScenario": {
                    if (
                        !isRecord(message.payload) ||
                        !isScenarioSpec(message.payload["scenario"]) ||
                        (message.payload["connectionProfiles"] !== undefined &&
                            !isRecord(message.payload["connectionProfiles"]))
                    ) {
                        throw new Error("startScenario payload is invalid");
                    }
                    this.repId = message.repId;
                    this.scenarioId = message.scenarioId;
                    const payload = message.payload as unknown as {
                        scenario: ScenarioSpec;
                        connectionProfiles?: Record<string, ConnectionProfileSpec>;
                    };
                    await this.executeScenario(payload.scenario, payload.connectionProfiles);
                    break;
                }
                case "marker": {
                    if (!isRecord(message.payload) || !isBusMarker(message.payload["marker"])) {
                        throw new Error("marker payload is invalid");
                    }
                    this.bus.deliver(message.payload["marker"]);
                    break;
                }
                case "scenarioBoundaryAck": {
                    if (
                        !isRecord(message.payload) ||
                        (message.payload["phase"] !== "start" && message.payload["phase"] !== "end")
                    ) {
                        throw new Error("scenarioBoundaryAck payload is invalid");
                    }
                    const payload = message.payload as { phase: "start" | "end" };
                    const pending = this.scenarioBoundaryWait;
                    if (pending?.phase === payload.phase) {
                        clearTimeout(pending.timer);
                        this.scenarioBoundaryWait = undefined;
                        pending.resolve();
                    }
                    break;
                }
                case "shutdown": {
                    this.log("shutdown requested; quitting VS Code");
                    await vscode.commands.executeCommand("workbench.action.quit");
                    break;
                }
                case "heartbeat":
                    if (!isRecord(message.payload) || typeof message.payload["seq"] !== "number") {
                        throw new Error("heartbeat payload is invalid");
                    }
                    this.send("heartbeat", {
                        seq: message.payload["seq"],
                    });
                    break;
                default:
                    this.log(`unexpected control message kind '${message.kind}'`);
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.log(`rejected '${message.kind}': ${reason}`);
            if (message.kind === "startScenario") {
                this.send("scenarioFailed", { reason });
            } else {
                this.send("error", { message: reason, details: { sourceKind: message.kind } });
            }
        }
    }

    private async executeScenario(
        spec: ScenarioSpec,
        connectionProfiles?: Record<string, ConnectionProfileSpec>,
    ): Promise<void> {
        this.send("scenarioStarted", {});
        const errors: string[] = [];
        // Extension-host memory timeline on the marker plane (counter markers,
        // ~2 markers/second while a scenario runs; unref'd, best-effort).
        const memoryTimer = setInterval(() => {
            try {
                const usage = process.memoryUsage();
                this.emitMarker("exthost.memory.rss", "counter", { value: usage.rss });
                this.emitMarker("exthost.memory.heapUsed", "counter", {
                    value: usage.heapUsed,
                });
                this.emitMarker("exthost.memory.external", "counter", {
                    value: usage.external,
                });
                // Electron builds do not all expose process.memoryUsage().arrayBuffers.
                // Absence is not a measured zero: omitting the series keeps reports
                // honest and lets consumers distinguish unsupported from empty.
                if (typeof usage.arrayBuffers === "number") {
                    this.emitMarker("exthost.memory.arrayBuffers", "counter", {
                        value: usage.arrayBuffers,
                    });
                }
            } catch {
                // never let telemetry break a scenario
            }
        }, 500);
        (memoryTimer as { unref?: () => void }).unref?.();
        try {
            const result = await runScenario(spec, {
                emitMarker: (name, phase, attrs) => this.emitMarker(name, phase, attrs),
                prepareScenarioWindow: () =>
                    this.waitForScenarioBoundary("start", "scenario.collectors.prepare", {
                        scenarioId: spec.scenarioId,
                    }),
                emitScenarioEndMarker: (attrs) => this.emitScenarioEndMarker(attrs),
                bus: this.bus,
                errors,
                log: (m) => this.log(m),
                ...(connectionProfiles ? { connectionProfiles } : {}),
                applicationName: `mssql-perf/${this.options.runId}/${this.repId}/${this.scenarioId}`,
            });
            if (result.failure) {
                this.send("scenarioFailed", {
                    reason: result.failure.reason,
                    step: result.failure.step,
                    successChecks: result.successChecks,
                });
            } else {
                this.send("scenarioCompleted", {
                    successChecks: result.successChecks,
                    steps: result.steps,
                });
            }
        } catch (error) {
            this.send("scenarioFailed", {
                reason: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
        } finally {
            clearInterval(memoryTimer);
        }
    }

    private emitMarker(
        name: string,
        phase: "instant" | "begin" | "end" | "counter",
        attrs?: Record<string, unknown>,
    ): void {
        const marker = {
            schemaVersion: 1 as const,
            runId: this.options.runId,
            repId: this.repId,
            scenarioId: this.scenarioId,
            name,
            phase,
            timestampUnixNs: nowUnixNs(),
            monotonicNs: process.hrtime.bigint().toString(),
            process: {
                role: "extensionHost",
                pid: process.pid,
                name: "mssql-perf-driver",
            },
            ...(attrs ? { attrs } : {}),
        };
        this.bus.deliver(marker as unknown as BusMarker);
        this.send("marker", { marker });
    }

    private emitScenarioEndMarker(attrs: Record<string, unknown>): Promise<void> {
        return this.waitForScenarioBoundary("end", "scenario.end", attrs);
    }

    private waitForScenarioBoundary(
        phase: "start" | "end",
        markerName: string,
        attrs: Record<string, unknown>,
    ): Promise<void> {
        if (this.scenarioBoundaryWait) {
            return Promise.reject(
                new Error(`Scenario ${phase} boundary overlapped an active boundary wait`),
            );
        }
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.scenarioBoundaryWait?.timer === timer) {
                    this.scenarioBoundaryWait = undefined;
                }
                reject(
                    new Error(`Timed out waiting for scenario ${phase} collector acknowledgement`),
                );
            }, 60_000);
            this.scenarioBoundaryWait = { phase, resolve, reject, timer };
            this.emitMarker(markerName, "instant", attrs);
        });
    }

    private send(kind: string, payload: unknown): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            this.log(`cannot send '${kind}' - socket not open`);
            return;
        }
        const envelope: ControlEnvelope = {
            schemaVersion: 1,
            kind,
            runId: this.options.runId,
            repId: this.repId,
            scenarioId: this.scenarioId,
            timestampUnixNs: nowUnixNs(),
            sender: {
                role: "automationExtension",
                pid: process.pid,
                name: "mssql-perf-driver",
            },
            payload,
        };
        this.socket.send(JSON.stringify(envelope));
    }

    private log(message: string): void {
        console.log(`[mssql-perf-driver] ${message}`);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.rejectBoundaryWait(new Error("control client disposed"));
        this.socket?.close();
        this.socket = undefined;
    }

    private rejectBoundaryWait(error: Error): void {
        if (!this.scenarioBoundaryWait) return;
        clearTimeout(this.scenarioBoundaryWait.timer);
        this.scenarioBoundaryWait.reject(error);
        this.scenarioBoundaryWait = undefined;
    }
}

function isControlEnvelope(value: unknown): value is ControlEnvelope {
    return (
        isRecord(value) &&
        value["schemaVersion"] === 1 &&
        typeof value["kind"] === "string" &&
        typeof value["runId"] === "string" &&
        typeof value["repId"] === "number" &&
        typeof value["scenarioId"] === "string" &&
        typeof value["timestampUnixNs"] === "string" &&
        isRecord(value["sender"])
    );
}

function isScenarioSpec(value: unknown): value is ScenarioSpec {
    return (
        isRecord(value) &&
        typeof value["scenarioId"] === "string" &&
        isRecord(value["measure"]) &&
        Array.isArray(value["measure"]["action"]) &&
        typeof value["measure"]["timeoutMs"] === "number"
    );
}

function isBusMarker(value: unknown): value is BusMarker {
    return (
        isRecord(value) &&
        typeof value["name"] === "string" &&
        typeof value["phase"] === "string" &&
        typeof value["timestampUnixNs"] === "string" &&
        isRecord(value["process"])
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
