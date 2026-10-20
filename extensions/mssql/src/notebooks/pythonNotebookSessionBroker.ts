/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from "crypto";
import * as http from "http";
import { ILogger } from "../sharedInterfaces/logger";
import {
    PythonNotebookConnectionReference,
    PythonNotebookCredentialsProvider,
    PythonNotebookError,
} from "./pythonNotebookCredentials";

export interface PythonNotebookBootstrap {
    brokerUrl: string;
    capability: string;
}

export class PythonNotebookSessionBroker {
    private server?: http.Server;
    private starting?: Promise<string>;
    private rejectStart?: (error: Error) => void;
    private pendingSessions = 0;
    private readonly servers = new Set<http.Server>();
    private disposed = false;
    private readonly sessions = new Map<
        string,
        {
            provider: PythonNotebookCredentialsProvider;
            reference: PythonNotebookConnectionReference;
        }
    >();

    constructor(
        private readonly log: ILogger,
        private readonly isAllowed: () => boolean,
    ) {}

    public async createSession(
        provider: PythonNotebookCredentialsProvider,
        reference: PythonNotebookConnectionReference,
    ): Promise<PythonNotebookBootstrap> {
        if (this.disposed || !this.isAllowed()) throw new PythonNotebookError("trust");
        this.pendingSessions++;
        try {
            const brokerUrl = await this.start();
            if (this.disposed || !this.isAllowed()) throw new PythonNotebookError("trust");
            const capability = randomBytes(32).toString("hex");
            this.sessions.set(capability, { provider, reference: { ...reference } });
            return { brokerUrl, capability };
        } finally {
            this.pendingSessions--;
            this.stopIfIdle();
        }
    }

    public revoke(capability: string): void {
        this.sessions.delete(capability);
        this.stopIfIdle();
    }

    private stopIfIdle(): void {
        if (!this.sessions.size && !this.pendingSessions && this.server) {
            const server = this.server;
            server.close(() => this.servers.delete(server));
            server.closeIdleConnections();
            this.server = undefined;
            this.starting = undefined;
            this.rejectStart = undefined;
        }
    }

    private start(): Promise<string> {
        if (this.starting) return this.starting;
        this.starting = new Promise<string>((resolve, reject) => {
            this.rejectStart = reject;
            const server = http.createServer((request, response) => {
                void this.handle(request, response);
            });
            this.server = server;
            this.servers.add(server);
            server.requestTimeout = 10000;
            server.headersTimeout = 10000;
            server.keepAliveTimeout = 1000;
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                const address = server.address();
                if (!address || typeof address === "string") {
                    reject(new PythonNotebookError("initialization"));
                    return;
                }
                server.off("error", reject);
                this.rejectStart = undefined;
                server.on("error", () => this.log.error("Python notebook broker socket failed."));
                resolve(`http://127.0.0.1:${address.port}`);
            });
        });
        return this.starting;
    }

    private async handle(
        request: http.IncomingMessage,
        response: http.ServerResponse,
    ): Promise<void> {
        const send = (status: number, value: unknown) => {
            response.writeHead(status, {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            });
            response.end(JSON.stringify(value));
        };
        const address = this.server?.address();
        const expectedHost =
            address && typeof address !== "string" ? `127.0.0.1:${address.port}` : undefined;
        const authorization = request.headers.authorization;
        const capability = authorization?.startsWith("Bearer ") ? authorization.substring(7) : "";
        const session = this.sessions.get(capability);
        if (
            this.disposed ||
            !this.isAllowed() ||
            !session ||
            request.headers.origin !== undefined ||
            request.headers.host !== expectedHost ||
            request.socket.remoteAddress !== "127.0.0.1"
        ) {
            request.resume();
            send(403, { error: "accessDenied" });
            return;
        }
        if (request.method !== "POST" || request.headers["content-type"] !== "application/json") {
            request.resume();
            send(405, { error: "invalidRequest" });
            return;
        }
        if (request.url !== "/v1/configuration" && request.url !== "/v1/token") {
            request.resume();
            send(404, { error: "notFound" });
            return;
        }
        let body = "";
        let size = 0;
        let rejected = false;
        request.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (rejected) return;
            if (size > 1024) {
                rejected = true;
                send(413, { error: "requestTooLarge" });
            } else {
                body += chunk.toString("utf8");
            }
        });
        request.on("error", () => this.log.warn("Python notebook broker request failed."));
        request.on("end", () => {
            if (rejected) return;
            if (body.trim() !== "{}") {
                send(400, { error: "invalidRequest" });
                return;
            }
            void (async () => {
                try {
                    const result =
                        request.url === "/v1/configuration"
                            ? await session.provider.getConfiguration(session.reference)
                            : await session.provider.getSqlToken(session.reference);
                    if (
                        this.disposed ||
                        !this.isAllowed() ||
                        this.sessions.get(capability) !== session
                    ) {
                        send(403, { error: "accessDenied" });
                        return;
                    }
                    send(200, result);
                } catch (error) {
                    const code = error instanceof PythonNotebookError ? error.code : "credentials";
                    this.log.warn(`Python notebook credential request failed: ${code}.`);
                    send(403, { error: code });
                }
            })();
        });
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
        this.sessions.clear();
        this.rejectStart?.(new PythonNotebookError("trust"));
        this.rejectStart = undefined;
        this.server = undefined;
        this.starting = undefined;
        await Promise.all(
            [...this.servers].map(
                (server) =>
                    new Promise<void>((resolve) => {
                        server.closeAllConnections();
                        server.close(() => {
                            this.servers.delete(server);
                            resolve();
                        });
                    }),
            ),
        );
    }
}
