/**
 * Minimal Chrome DevTools Protocol client over WebSocket: request/response
 * with ids, plus event subscription. Shared by the renderer tracing collector
 * (and future CDP collectors).
 */

import { request as httpRequest } from "node:http";
import WebSocket from "ws";

export interface CdpTarget {
    id?: string;
    type?: string;
    title?: string;
    url?: string;
    webSocketDebuggerUrl?: string;
}

/** Reuse one Chromium debugging port when multiple CDP collectors are enabled. */
export function ensureCdpRemoteDebuggingPort(args: string[]): number {
    const existing = args.find((arg) => arg.startsWith("--remote-debugging-port="));
    if (existing) {
        const port = Number(existing.slice("--remote-debugging-port=".length));
        if (Number.isInteger(port) && port > 0 && port <= 65_535) {
            return port;
        }
    }
    const port = 29_000 + Math.floor(Math.random() * 10_000);
    args.push(`--remote-debugging-port=${port}`);
    return port;
}

export function isMssqlWebviewTarget(target: CdpTarget): boolean {
    try {
        const url = new URL(target.url ?? "");
        return (
            url.protocol === "vscode-webview:" &&
            url.searchParams.get("extensionId") === "ms-mssql.mssql"
        );
    } catch {
        return false;
    }
}

export function listCdpTargets(port: number, timeoutMs = 2000): Promise<CdpTarget[]> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            { host: "127.0.0.1", port, path: "/json/list", timeout: timeoutMs },
            (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk: string) => (body += chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(body) as CdpTarget[]);
                    } catch (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                });
            },
        );
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error(`CDP /json/list timed out on port ${port}`));
        });
        req.end();
    });
}

export function getCdpBrowserWebSocketUrl(port: number, timeoutMs = 2000): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            { host: "127.0.0.1", port, path: "/json/version", timeout: timeoutMs },
            (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk: string) => (body += chunk));
                res.on("end", () => {
                    try {
                        const value = JSON.parse(body) as { webSocketDebuggerUrl?: string };
                        if (!value.webSocketDebuggerUrl) {
                            reject(new Error("CDP /json/version omitted webSocketDebuggerUrl"));
                            return;
                        }
                        resolve(value.webSocketDebuggerUrl);
                    } catch (error) {
                        reject(error instanceof Error ? error : new Error(String(error)));
                    }
                });
            },
        );
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error(`CDP /json/version timed out on port ${port}`));
        });
        req.end();
    });
}

export async function discoverCdpTargets(
    port: number,
    retries = 20,
    delayMs = 500,
): Promise<CdpTarget[]> {
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
        try {
            const targets = await listCdpTargets(port);
            if (targets.length > 0) {
                return targets;
            }
        } catch (error) {
            lastError = error;
        }
        await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(`No CDP targets on port ${port}: ${String(lastError ?? "empty list")}`);
}

export class CdpClient {
    private socket: WebSocket | undefined;
    private nextId = 1;
    private readonly pending = new Map<
        number,
        { resolve: (result: unknown) => void; reject: (error: Error) => void }
    >();
    private readonly eventHandlers = new Map<string, Array<(params: unknown) => void>>();

    connect(wsUrl: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
            this.socket = socket;
            socket.on("open", () => resolve());
            socket.on("error", (error) => reject(error));
            socket.on("message", (data) => {
                try {
                    const message = JSON.parse(String(data)) as {
                        id?: number;
                        result?: unknown;
                        error?: { message?: string };
                        method?: string;
                        params?: unknown;
                    };
                    if (message.id !== undefined) {
                        const pending = this.pending.get(message.id);
                        if (pending) {
                            this.pending.delete(message.id);
                            if (message.error) {
                                pending.reject(new Error(message.error.message ?? "CDP error"));
                            } else {
                                pending.resolve(message.result);
                            }
                        }
                    } else if (message.method) {
                        for (const handler of this.eventHandlers.get(message.method) ?? []) {
                            handler(message.params);
                        }
                    }
                } catch {
                    // ignore unparseable frames
                }
            });
        });
    }

    on(method: string, handler: (params: unknown) => void): void {
        const list = this.eventHandlers.get(method) ?? [];
        list.push(handler);
        this.eventHandlers.set(method, list);
    }

    send(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
        return this.sendInternal(method, params, timeoutMs);
    }

    sendToSession(
        sessionId: string,
        method: string,
        params?: Record<string, unknown>,
        timeoutMs = 30_000,
    ): Promise<unknown> {
        return this.sendInternal(method, params, timeoutMs, sessionId);
    }

    private sendInternal(
        method: string,
        params: Record<string, unknown> | undefined,
        timeoutMs: number,
        sessionId?: string,
    ): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
                reject(new Error("CDP socket not open"));
                return;
            }
            const id = this.nextId++;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP call ${method} timed out`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (result) => {
                    clearTimeout(timer);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            this.socket.send(
                JSON.stringify({
                    id,
                    method,
                    ...(params ? { params } : {}),
                    ...(sessionId ? { sessionId } : {}),
                }),
            );
        });
    }

    close(): void {
        const error = new Error("CDP client closed");
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
        this.eventHandlers.clear();
        this.socket?.close();
        this.socket = undefined;
    }
}
