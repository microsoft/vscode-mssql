/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deliberately narrow STS v1 compatibility boundary for headless DacFx.
 * The child process and JSON-RPC contracts do not escape this module. No
 * `vscode` or `vscode-languageclient` runtime is loaded.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
    createMessageConnection,
    type MessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { parseSqlConnectionString } from "../../diagnostics/selfTest/connectionString";

const REQUEST_TIMEOUT_MS = 10 * 60_000;
const CONNECT_TIMEOUT_MS = 60_000;

export interface HeadlessDacFxResult {
    success: boolean;
    errorMessage?: string;
    operationId?: string;
}

export interface HeadlessDeployPlanResult extends HeadlessDacFxResult {
    report?: string;
}

interface ConnectionComplete {
    ownerUri?: string;
    errorMessage?: string;
    errorNumber?: number;
}

export class HeadlessStsDacFxError extends Error {
    constructor(public readonly code: string) {
        super(code);
        this.name = "HeadlessStsDacFxError";
    }
}

export class HeadlessStsDacFxClient {
    private child: ChildProcessWithoutNullStreams | undefined;
    private connection: MessageConnection | undefined;
    private startPromise: Promise<void> | undefined;

    constructor(private readonly extensionRoot: string) {}

    public async extract(
        connectionString: string,
        databaseName: string,
        packageFilePath: string,
        isCancellationRequested: () => boolean,
    ): Promise<HeadlessDacFxResult> {
        return this.withConnectedOwner(
            connectionString,
            databaseName,
            isCancellationRequested,
            (ownerUri) =>
                this.request<HeadlessDacFxResult>(
                    "dacfx/extract",
                    {
                        databaseName,
                        packageFilePath,
                        applicationName: databaseName,
                        applicationVersion: "1.0.0.0",
                        ownerUri,
                        extractTarget: 0,
                        taskExecutionMode: 0,
                    },
                    isCancellationRequested,
                ),
        );
    }

    public async deployPlan(
        connectionString: string,
        databaseName: string,
        packageFilePath: string,
        isCancellationRequested: () => boolean,
    ): Promise<HeadlessDeployPlanResult> {
        return this.withConnectedOwner(
            connectionString,
            databaseName,
            isCancellationRequested,
            (ownerUri) =>
                this.request<HeadlessDeployPlanResult>(
                    "dacfx/generateDeployPlan",
                    { packageFilePath, databaseName, ownerUri, taskExecutionMode: 0 },
                    isCancellationRequested,
                ),
        );
    }

    /** Publish is an at-most-once critical section. Cancellation is checked
     * before the request, then the DacFx result is allowed to settle. */
    public async deploy(
        connectionString: string,
        databaseName: string,
        packageFilePath: string,
        isCancellationRequested: () => boolean,
    ): Promise<HeadlessDacFxResult> {
        return this.withConnectedOwner(
            connectionString,
            databaseName,
            isCancellationRequested,
            (ownerUri) =>
                this.request<HeadlessDacFxResult>(
                    "dacfx/deploy",
                    {
                        packageFilePath,
                        databaseName,
                        upgradeExisting: true,
                        ownerUri,
                        taskExecutionMode: 0,
                    },
                    () => false,
                ),
        );
    }

    public async dispose(): Promise<void> {
        const connection = this.connection;
        const child = this.child;
        this.connection = undefined;
        this.child = undefined;
        this.startPromise = undefined;
        if (connection) {
            await Promise.race([
                connection.sendRequest("shutdown").catch(() => undefined),
                delay(1000),
            ]).catch(() => undefined);
            try {
                connection.sendNotification("exit");
            } catch {
                // The service may already have closed after a provider failure.
            }
            connection.dispose();
        }
        if (child && child.exitCode === null) {
            child.kill();
            await Promise.race([waitForExit(child), delay(2000)]).catch(() => undefined);
            if (child.exitCode === null) {
                child.kill("SIGKILL");
            }
        }
    }

    private async withConnectedOwner<T>(
        rawConnectionString: string,
        databaseName: string,
        isCancellationRequested: () => boolean,
        operation: (ownerUri: string) => Promise<T>,
    ): Promise<T> {
        await this.start();
        if (isCancellationRequested()) {
            throw new HeadlessStsDacFxError("HeadlessActivityHost.ActivityCancelled");
        }
        const parsed = parseSqlConnectionString(rawConnectionString);
        if ("error" in parsed || !validDatabaseName(databaseName)) {
            throw new HeadlessStsDacFxError("HeadlessActivityHost.ConnectionInvalid");
        }
        const ownerUri = `runbook-headless://dacfx/${process.pid}/${Date.now().toString(36)}`;
        const connection = this.requireConnection();
        const complete = waitForConnectionComplete(connection, ownerUri);
        let accepted: boolean;
        try {
            accepted = await this.request<boolean>(
                "connection/connect",
                {
                    ownerUri,
                    connection: {
                        options: {
                            connectionString: rawConnectionString,
                            server: parsed.parsed.server,
                            database: databaseName,
                            databaseDisplayName: databaseName,
                            user: parsed.parsed.user,
                            password: parsed.parsed.password,
                            authenticationType: parsed.parsed.integrated ? 1 : 2,
                            encrypt: parsed.parsed.encrypt,
                            trustServerCertificate: parsed.parsed.trustServerCertificate,
                            applicationName: "Runbook Studio headless DacFx",
                        },
                    },
                },
                isCancellationRequested,
                CONNECT_TIMEOUT_MS,
            );
        } catch (error) {
            complete.dispose();
            throw error;
        }
        if (!accepted) {
            complete.dispose();
            throw new HeadlessStsDacFxError("HeadlessActivityHost.ConnectionFailed");
        }
        const connected = await complete.promise;
        if (connected.errorMessage || connected.errorNumber) {
            throw new HeadlessStsDacFxError("HeadlessActivityHost.ConnectionFailed");
        }
        try {
            return await operation(ownerUri);
        } finally {
            await this.request<boolean>(
                "connection/disconnect",
                { ownerUri },
                () => false,
                10_000,
            ).catch(() => undefined);
        }
    }

    private start(): Promise<void> {
        this.startPromise ??= this.startCore();
        return this.startPromise;
    }

    private async startCore(): Promise<void> {
        const executable = resolveStsExecutable(this.extensionRoot);
        const child = spawn(executable, ["--tracing-level", "OFF"], {
            cwd: path.dirname(executable),
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.child = child;
        let stderrBytes = 0;
        child.stderr.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.byteLength;
            if (stderrBytes > 1024 * 1024) {
                child.stderr.pause();
            }
        });
        const connection = createMessageConnection(
            new StreamMessageReader(child.stdout),
            new StreamMessageWriter(child.stdin),
        );
        this.connection = connection;
        connection.listen();
        child.once("exit", () => {
            if (this.child === child) {
                this.connection = undefined;
                this.child = undefined;
            }
        });
        await this.request(
            "initialize",
            {
                processId: process.pid,
                clientInfo: { name: "mssql-runbook-headless", version: "1" },
                rootUri: null,
                capabilities: {},
                workspaceFolders: null,
            },
            () => false,
            30_000,
        );
        connection.sendNotification("initialized", {});
    }

    private async request<T>(
        method: string,
        params: unknown,
        isCancellationRequested: () => boolean,
        timeoutMs = REQUEST_TIMEOUT_MS,
    ): Promise<T> {
        if (isCancellationRequested()) {
            throw new HeadlessStsDacFxError("HeadlessActivityHost.ActivityCancelled");
        }
        const connection = this.requireConnection();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let poll: ReturnType<typeof setInterval> | undefined;
        try {
            return await Promise.race([
                connection.sendRequest<T>(method, params),
                new Promise<T>((_resolve, reject) => {
                    timeout = setTimeout(
                        () =>
                            reject(
                                new HeadlessStsDacFxError("HeadlessActivityHost.ProviderTimedOut"),
                            ),
                        timeoutMs,
                    );
                    poll = setInterval(() => {
                        if (isCancellationRequested()) {
                            reject(
                                new HeadlessStsDacFxError("HeadlessActivityHost.ActivityCancelled"),
                            );
                        }
                    }, 50);
                }),
            ]);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
            if (poll) {
                clearInterval(poll);
            }
        }
    }

    private requireConnection(): MessageConnection {
        if (!this.connection) {
            throw new HeadlessStsDacFxError("HeadlessActivityHost.ProviderUnavailable");
        }
        return this.connection;
    }
}

function waitForConnectionComplete(
    connection: MessageConnection,
    ownerUri: string,
): {
    promise: Promise<ConnectionComplete>;
    dispose: () => void;
} {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposable: { dispose(): void } | undefined;
    const promise = new Promise<ConnectionComplete>((resolve, reject) => {
        disposable = connection.onNotification(
            "connection/complete",
            (notification: ConnectionComplete) => {
                if (notification.ownerUri !== ownerUri) {
                    return;
                }
                disposable?.dispose();
                if (timer) {
                    clearTimeout(timer);
                }
                resolve(notification);
            },
        );
        timer = setTimeout(() => {
            disposable?.dispose();
            reject(new HeadlessStsDacFxError("HeadlessActivityHost.ConnectionTimedOut"));
        }, CONNECT_TIMEOUT_MS);
    });
    return {
        promise,
        dispose: () => {
            disposable?.dispose();
            if (timer) {
                clearTimeout(timer);
            }
        },
    };
}

function resolveStsExecutable(extensionRoot: string): string {
    if (process.platform !== "win32") {
        throw new HeadlessStsDacFxError("HeadlessActivityHost.ProviderUnavailable");
    }
    const serviceRoot = path.resolve(extensionRoot, "sqltoolsservice");
    let versions: string[];
    try {
        versions = fs
            .readdirSync(serviceRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
            .map((entry) => entry.name)
            .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    } catch {
        throw new HeadlessStsDacFxError("HeadlessActivityHost.ProviderUnavailable");
    }
    for (const version of versions) {
        const candidate = path.join(
            serviceRoot,
            version,
            "Windows",
            "MicrosoftSqlToolsServiceLayer.exe",
        );
        try {
            const stat = fs.lstatSync(candidate);
            const resolved = fs.realpathSync(candidate);
            if (
                stat.isFile() &&
                !stat.isSymbolicLink() &&
                isContained(fs.realpathSync(serviceRoot), resolved)
            ) {
                return resolved;
            }
        } catch {
            // Try the next installed version.
        }
    }
    throw new HeadlessStsDacFxError("HeadlessActivityHost.ProviderUnavailable");
}

function validDatabaseName(value: string): boolean {
    return (
        value.trim().length > 0 &&
        value.trim().length <= 128 &&
        !/[\u0000-\u001f\u007f]/u.test(value)
    );
}

function isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        relative !== "" &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) {
        return Promise.resolve();
    }
    return new Promise((resolve) => child.once("exit", () => resolve()));
}
