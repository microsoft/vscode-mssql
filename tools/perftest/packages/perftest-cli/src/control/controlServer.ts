/**
 * Local control server (design §9): a 127.0.0.1 HTTP server hosting
 *  - `ws://.../control` — the WebSocket control channel with the driver
 *    extension (token-authenticated hello, calibration, scenario lifecycle),
 *  - `POST /v1/markers` — direct marker ingestion for the product extension,
 *    STS, and other perf-mode processes (Bearer token).
 *
 * One ControlServer instance serves one repetition. Every inbound/outbound
 * message is logged through the harness telemetry so the whole control plane
 * is traceable in harness-log.jsonl.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
    nowUnixNs,
    type CalibrationPongMessage,
    type ConnectionProfileSpec,
    type ControlMessage,
    type ControlMessageKind,
    type HelloMessage,
    type ProcessDiscoveredMessage,
    type ReadyMessage,
    type ScenarioCompletedMessage,
    type ScenarioFailedMessage,
    type ScenarioSpec,
} from "@mssqlperf/contracts";
import type { MarkerSink } from "../markers/markerSink";
import type { HarnessLogger } from "../telemetry/logger";

export interface ControlServerOptions {
    token: string;
    runId: string;
    repId: number;
    scenarioId: string;
    sink: MarkerSink;
    logger: HarnessLogger;
}

export interface CalibrationResult {
    /** Estimated driver clock minus orchestrator clock, ns (from best sample). */
    offsetNs: string;
    /** Best (minimum) observed round trip, ns. */
    roundTripNs: string;
    samples: number;
}

export interface ScenarioOutcome {
    kind: "completed" | "failed";
    completed?: ScenarioCompletedMessage;
    failed?: ScenarioFailedMessage;
}

interface PendingWait<T> {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

export class ControlServer {
    private readonly http: Server;
    private readonly wss: WebSocketServer;
    private driver: WebSocket | undefined;
    private helloMessage: HelloMessage | undefined;
    private readyMessage: ReadyMessage | undefined;
    private outcome: ScenarioOutcome | undefined;
    private waitingHello: PendingWait<HelloMessage> | undefined;
    private waitingReady: PendingWait<ReadyMessage> | undefined;
    private waitingOutcome: PendingWait<ScenarioOutcome> | undefined;
    private pendingCalibration:
        | { seq: number; t0UnixNs: string; resolve: (m: CalibrationPongMessage) => void }
        | undefined;
    readonly discoveredProcesses: ProcessDiscoveredMessage["payload"][] = [];

    private constructor(
        private readonly options: ControlServerOptions,
        http: Server,
        private readonly port: number,
    ) {
        this.http = http;
        this.wss = new WebSocketServer({ server: http, path: "/control" });
        this.wss.on("connection", (socket) => this.onConnection(socket));
        // Markers ingested from other processes (HTTP path: product extension,
        // STS, webview bridge) are relayed to the driver so its waitForMarker
        // steps can resolve on them. Dedup is by INGEST SOURCE, not pid — the
        // product extension shares the driver's extension-host pid.
        options.sink.on("marker", (marker, source) => {
            if (source === "http" && this.driver && this.driver.readyState === WebSocket.OPEN) {
                this.send({
                    ...this.envelope("marker"),
                    payload: { marker },
                } as ControlMessage);
            }
        });
    }

    static async start(options: ControlServerOptions): Promise<ControlServer> {
        const span = options.logger.span("controlServer.start");
        const http = createServer();
        await new Promise<void>((resolve, reject) => {
            http.once("error", reject);
            http.listen(0, "127.0.0.1", () => resolve());
        });
        const address = http.address();
        if (address === null || typeof address === "string") {
            throw new Error("Control server failed to bind a port");
        }
        const server = new ControlServer(options, http, address.port);
        http.on("request", (req, res) => server.onHttpRequest(req, res));
        span.end({ port: address.port });
        return server;
    }

    get controlUrl(): string {
        return `ws://127.0.0.1:${this.port}/control`;
    }

    get markerUrl(): string {
        return `http://127.0.0.1:${this.port}/v1/markers`;
    }

    get hello(): HelloMessage | undefined {
        return this.helloMessage;
    }

    // -------------------------------------------------------------------------
    // HTTP marker ingestion
    // -------------------------------------------------------------------------

    private onHttpRequest(req: IncomingMessage, res: ServerResponse): void {
        if (req.method !== "POST" || !req.url?.startsWith("/v1/markers")) {
            res.writeHead(404).end();
            return;
        }
        const auth = req.headers.authorization ?? "";
        const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("token");
        if (token !== this.options.token) {
            this.options.logger.warn("controlServer.markerAuthFailed");
            res.writeHead(401).end();
            return;
        }
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
            body += chunk;
            if (body.length > 4 * 1024 * 1024) {
                res.writeHead(413).end();
                req.destroy();
            }
        });
        req.on("end", () => {
            let accepted = 0;
            let rejected = 0;
            for (const line of body.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const parsed: unknown = JSON.parse(trimmed);
                    if (this.options.sink.ingest(parsed, "http")) {
                        accepted += 1;
                    } else {
                        rejected += 1;
                    }
                } catch {
                    rejected += 1;
                }
            }
            res.writeHead(rejected === 0 ? 202 : 400, { "content-type": "application/json" }).end(
                JSON.stringify({ accepted, rejected }),
            );
        });
    }

    // -------------------------------------------------------------------------
    // WebSocket control channel
    // -------------------------------------------------------------------------

    private onConnection(socket: WebSocket): void {
        this.options.logger.debug("controlServer.connection");
        let authenticated = false;
        socket.on("message", (data) => {
            let message: ControlMessage;
            try {
                message = JSON.parse(String(data)) as ControlMessage;
            } catch {
                this.options.logger.warn("controlServer.badJson");
                return;
            }
            if (!authenticated) {
                if (
                    message.kind === "hello" &&
                    (message as HelloMessage).payload?.token === this.options.token
                ) {
                    if (this.driver) {
                        this.options.logger.warn(
                            "controlServer.duplicateDriver",
                            "second hello rejected",
                        );
                        socket.close(4001, "driver already connected");
                        return;
                    }
                    authenticated = true;
                    this.driver = socket;
                    this.helloMessage = message as HelloMessage;
                    this.options.logger.info("controlServer.driverAuthenticated", undefined, {
                        extensionHostPid: this.helloMessage.payload.extensionHostPid,
                        vscodeVersion: this.helloMessage.payload.vscodeVersion,
                    });
                    // Replay markers that arrived before the driver connected (e.g. a
                    // product extension that activated during window startup) so the
                    // driver's marker view is complete from the beginning.
                    for (const entry of this.options.sink.allWithSource()) {
                        if (entry.source === "http") {
                            this.send({
                                ...this.envelope("marker"),
                                payload: { marker: entry.marker },
                            } as ControlMessage);
                        }
                    }
                    this.settle(this.waitingHello, this.helloMessage);
                    this.waitingHello = undefined;
                } else {
                    this.options.logger.warn("controlServer.authFailed", undefined, {
                        kind: message.kind,
                    });
                    socket.close(4003, "authentication required");
                }
                return;
            }
            this.onDriverMessage(message);
        });
        socket.on("close", (code, reason) => {
            if (this.driver === socket) {
                this.driver = undefined;
                this.options.logger.info("controlServer.driverDisconnected", undefined, {
                    code,
                    reason: String(reason),
                });
            }
        });
        socket.on("error", (error) => {
            this.options.logger.warn("controlServer.socketError", String(error));
        });
    }

    private onDriverMessage(message: ControlMessage): void {
        this.options.logger.trace("controlServer.received", undefined, { kind: message.kind });
        switch (message.kind) {
            case "ready":
                this.readyMessage = message as ReadyMessage;
                this.settle(this.waitingReady, this.readyMessage);
                this.waitingReady = undefined;
                break;
            case "marker":
                this.options.sink.ingest(
                    (message as { payload: { marker: unknown } }).payload.marker,
                    "ws",
                );
                break;
            case "calibrationPong": {
                const pong = message as CalibrationPongMessage;
                if (this.pendingCalibration && this.pendingCalibration.seq === pong.payload.seq) {
                    this.pendingCalibration.resolve(pong);
                    this.pendingCalibration = undefined;
                }
                break;
            }
            case "scenarioStarted":
                this.options.logger.info("controlServer.scenarioStarted");
                break;
            case "scenarioCompleted":
                this.outcome = {
                    kind: "completed",
                    completed: message as ScenarioCompletedMessage,
                };
                this.settle(this.waitingOutcome, this.outcome);
                this.waitingOutcome = undefined;
                break;
            case "scenarioFailed":
                this.outcome = { kind: "failed", failed: message as ScenarioFailedMessage };
                this.settle(this.waitingOutcome, this.outcome);
                this.waitingOutcome = undefined;
                break;
            case "processDiscovered": {
                const discovered = (message as ProcessDiscoveredMessage).payload;
                this.discoveredProcesses.push(discovered);
                this.options.logger.info("controlServer.processDiscovered", undefined, {
                    role: discovered.role,
                    pid: discovered.pid,
                });
                break;
            }
            case "artifactHint":
                this.options.logger.info("controlServer.artifactHint", undefined, {
                    payload: (message as { payload: unknown }).payload as Record<string, unknown>,
                });
                break;
            case "heartbeat":
                this.options.logger.trace("controlServer.heartbeat");
                break;
            case "error":
                this.options.logger.warn("controlServer.driverError", undefined, {
                    payload: (message as { payload: unknown }).payload as Record<string, unknown>,
                });
                break;
            default:
                this.options.logger.warn("controlServer.unexpectedKind", undefined, {
                    kind: message.kind,
                });
        }
    }

    // -------------------------------------------------------------------------
    // Orchestrator API
    // -------------------------------------------------------------------------

    waitForHello(timeoutMs: number): Promise<HelloMessage> {
        if (this.helloMessage) return Promise.resolve(this.helloMessage);
        return this.makeWait<HelloMessage>("hello", timeoutMs, (w) => (this.waitingHello = w));
    }

    waitForReady(timeoutMs: number): Promise<ReadyMessage> {
        if (this.readyMessage) return Promise.resolve(this.readyMessage);
        return this.makeWait<ReadyMessage>("ready", timeoutMs, (w) => (this.waitingReady = w));
    }

    waitForScenarioOutcome(timeoutMs: number): Promise<ScenarioOutcome> {
        if (this.outcome) return Promise.resolve(this.outcome);
        return this.makeWait<ScenarioOutcome>("scenario outcome", timeoutMs, (w) => {
            this.waitingOutcome = w;
        });
    }

    /**
     * §11.3 clock calibration. Runs `samples` ping/pongs and reports the offset
     * from the minimum-round-trip sample (least queuing noise).
     */
    async calibrate(samples = 5, timeoutMs = 5000): Promise<CalibrationResult> {
        const span = this.options.logger.span("controlServer.calibrate", { samples });
        let best: { offsetNs: bigint; roundTripNs: bigint } | undefined;
        for (let seq = 0; seq < samples; seq++) {
            const t0 = nowUnixNs();
            const pong = await new Promise<CalibrationPongMessage>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`calibration ping ${seq} timed out`)),
                    timeoutMs,
                );
                this.pendingCalibration = {
                    seq,
                    t0UnixNs: t0,
                    resolve: (m) => {
                        clearTimeout(timer);
                        resolve(m);
                    },
                };
                this.send({
                    ...this.envelope("calibrationPing"),
                    payload: { seq, t0UnixNs: t0 },
                } as ControlMessage);
            });
            const t3 = BigInt(nowUnixNs());
            const t0n = BigInt(pong.payload.t0UnixNs);
            const e2 = BigInt(pong.payload.e2UnixNs);
            const roundTrip = t3 - t0n;
            const offset = e2 - (t0n + t3) / 2n;
            if (!best || roundTrip < best.roundTripNs) {
                best = { offsetNs: offset, roundTripNs: roundTrip };
            }
        }
        if (!best) {
            span.fail(new Error("no calibration samples"));
            throw new Error("Clock calibration produced no samples");
        }
        const result: CalibrationResult = {
            offsetNs: best.offsetNs.toString(),
            roundTripNs: best.roundTripNs.toString(),
            samples,
        };
        span.end({ ...result });
        return result;
    }

    startScenario(
        spec: ScenarioSpec,
        traceId: string,
        rootTraceparent: string,
        artifactDir: string,
        connectionProfiles?: Record<string, ConnectionProfileSpec>,
    ): void {
        this.options.logger.info("controlServer.startScenario", undefined, {
            scenarioId: spec.scenarioId,
            traceId,
            // profile names only — never the contents (they carry credentials)
            profiles: Object.keys(connectionProfiles ?? {}),
        });
        this.send({
            ...this.envelope("startScenario"),
            payload: {
                scenario: spec,
                traceId,
                rootTraceparent,
                artifactDir,
                ...(connectionProfiles ? { connectionProfiles } : {}),
            },
        } as ControlMessage);
    }

    sendScenarioBoundaryAck(phase: "start" | "end"): void {
        this.options.logger.info("controlServer.scenarioBoundaryAck", undefined, { phase });
        this.send({
            ...this.envelope("scenarioBoundaryAck"),
            payload: { phase },
        } as ControlMessage);
    }

    sendShutdown(reason: string): void {
        this.options.logger.info("controlServer.shutdown", undefined, { reason });
        if (this.driver && this.driver.readyState === WebSocket.OPEN) {
            this.send({ ...this.envelope("shutdown"), payload: { reason } } as ControlMessage);
        }
    }

    async close(): Promise<void> {
        const span = this.options.logger.span("controlServer.close");
        for (const client of this.wss.clients) {
            client.close(1000, "run complete");
        }
        await new Promise<void>((resolve) => this.wss.close(() => resolve()));
        await new Promise<void>((resolve) => this.http.close(() => resolve()));
        span.end();
    }

    // -------------------------------------------------------------------------

    private envelope(kind: ControlMessageKind): Omit<ControlMessage, "payload"> {
        return {
            schemaVersion: 1,
            kind,
            runId: this.options.runId,
            repId: this.options.repId,
            scenarioId: this.options.scenarioId,
            timestampUnixNs: nowUnixNs(),
            sender: { role: "orchestrator", pid: process.pid, name: "perftest" },
        };
    }

    private send(message: ControlMessage): void {
        if (!this.driver || this.driver.readyState !== WebSocket.OPEN) {
            this.options.logger.warn("controlServer.sendWithoutDriver", undefined, {
                kind: message.kind,
            });
            return;
        }
        this.options.logger.trace("controlServer.sent", undefined, { kind: message.kind });
        this.driver.send(JSON.stringify(message));
    }

    private makeWait<T>(
        what: string,
        timeoutMs: number,
        store: (wait: PendingWait<T>) => void,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`)),
                timeoutMs,
            );
            store({
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
                timer,
            });
        });
    }

    private settle<T>(wait: PendingWait<T> | undefined, value: T): void {
        if (wait) {
            wait.resolve(value);
        }
    }
}
