/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TediousDriver — the ONLY module that imports tedious (TSQ2 addendum §4.2,
 * §5.5). Ships in the lazily-loaded provider bundle (dist/tsNativeProvider),
 * never in the activation graph.
 *
 * Baseline driver options (pinned by tests, §5.5): requestTimeout=0 (the
 * domain absolute timer is authoritative), rowCollectionOnDone=false,
 * rowCollectionOnRequestCompletion=false, useColumnNames=false; batches ride
 * execSqlBatch so SET/SHOWPLAN/transaction semantics match SqlClient raw
 * batches. Credential-bearing config is cleared after connect settles.
 *
 * Event contract: one connection-level router installed at open; per-request
 * listeners attach on the Request object and die with it; `completed`
 * resolves exactly once after every event already emitted for the
 * generation; late connection events after loss are swallowed (loss fired
 * once). Cancellation is TDS attention via request.cancel()/ECANCEL.
 */

import { Connection, Request, type ConnectionConfiguration } from "tedious";

/** Structural view of tedious column metadata (version-tolerant). */
interface TediousColumnMeta {
    colName: string;
    type?: { name?: string };
    udtInfo?: { typeName?: string };
    precision?: number;
    scale?: number;
    dataLength?: number;
}
import {
    DataPlaneOperationContext,
    ITdsConnection,
    ITdsDriver,
    ITdsQueryLease,
    TdsCancelReason,
    TdsCancelResult,
    TdsCell,
    TdsColumn,
    TdsCompletion,
    TdsConnectionObserver,
    TdsError,
    TdsErrorCategory,
    TdsExecuteRequest,
    TdsOpenRequest,
    TdsPauseReason,
    TdsQueryEvent,
    TdsQueryObserver,
    TdsServerFacts,
} from "./tdsDriver";

const AUTH_ERROR_NUMBERS = new Set([18456, 18452, 4060, 916]);

function makeError(category: TdsErrorCategory, message: string): TdsError & Error {
    const error = new Error(message) as TdsError & Error;
    error.category = category;
    return error;
}

export const TEDIOUS_DRIVER_VERSION: string =
    // Resolved at bundle time from the pinned package.
    (require("tedious/package.json") as { version: string }).version;

export class TediousDriver implements ITdsDriver {
    readonly name = "tedious" as const;
    readonly version = TEDIOUS_DRIVER_VERSION;

    async open(
        request: TdsOpenRequest,
        observer: TdsConnectionObserver,
        _context: DataPlaneOperationContext,
    ): Promise<ITdsConnection> {
        const config = buildConfig(request);
        const connection = new Connection(config);
        // Never retain the credential-bearing config beyond connect.
        scrubAuth(config);
        await new Promise<void>((resolve, reject) => {
            connection.connect((error) => {
                if (error) {
                    try {
                        connection.close();
                    } catch {
                        // socket may already be dead
                    }
                    reject(mapConnectError(error));
                } else {
                    resolve();
                }
            });
        });
        return new TediousConnection(connection, observer, {
            serverVersion:
                (connection as unknown as { serverVersion?: string }).serverVersion ?? undefined,
        });
    }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

let tediousConnectionCounter = 0;

class TediousConnection implements ITdsConnection {
    readonly id = `tds-${++tediousConnectionCounter}`;
    state: "open" | "closing" | "closed" | "lost" = "open";
    private generation = 0;
    private activeLease: TediousLease | undefined;
    private lostFired = false;

    constructor(
        private readonly connection: Connection,
        private readonly observer: TdsConnectionObserver,
        readonly serverFacts: TdsServerFacts,
    ) {
        // One connection-level router, installed once (§2.6/§5.3).
        this.connection.on("error", (error: Error) => this.handleLoss(categorize(error), error));
        this.connection.on("end", () => {
            if (this.state === "open") {
                this.handleLoss("network");
            }
        });
        this.connection.on("databaseChange", (database: string) => {
            const lease = this.activeLease;
            if (lease && !lease.terminal) {
                lease.emit({
                    kind: "databaseChanged",
                    driverSeq: lease.nextSeq(),
                    database,
                });
            } else {
                this.observer.onDatabaseChanged(database);
            }
        });
        this.connection.on("infoMessage", (message: TediousMessage) => {
            this.routeMessage(message, false);
        });
        this.connection.on("errorMessage", (message: TediousMessage) => {
            this.routeMessage(message, true);
        });
    }

    execute(
        request: TdsExecuteRequest,
        observer: TdsQueryObserver,
        _context: DataPlaneOperationContext,
    ): ITdsQueryLease {
        const lease = new TediousLease(++this.generation, observer);
        if (this.state !== "open") {
            lease.rejectAccepted(makeError("internal", `execute on ${this.state} connection`));
            lease.complete({
                ok: false,
                error: { category: "internal", message: "connection not open" },
            });
            return lease;
        }
        if (this.activeLease && !this.activeLease.terminal) {
            lease.rejectAccepted(makeError("internal", "a request is already active"));
            lease.complete({
                ok: false,
                error: { category: "internal", message: "request already active" },
            });
            return lease;
        }
        this.activeLease = lease;

        const tdsRequest = new Request(request.batchText, (error, _rowCount) => {
            // Terminal fence (§2.5): the request callback, never DONE tokens.
            const completion: TdsCompletion = error
                ? { ok: false, error: mapRequestError(error) }
                : { ok: true };
            if (this.activeLease === lease) {
                this.activeLease = undefined;
            }
            lease.complete(completion);
        });

        tdsRequest.on(
            "columnMetadata",
            (columns: TediousColumnMeta[] | Record<string, TediousColumnMeta>) => {
                const list = Array.isArray(columns) ? columns : Object.values(columns);
                lease.emit({
                    kind: "metadata",
                    driverSeq: lease.nextSeq(),
                    columns: list.map(normalizeColumn),
                });
            },
        );
        tdsRequest.on("row", (columns: TediousRowColumn[]) => {
            lease.emit({
                kind: "row",
                driverSeq: lease.nextSeq(),
                cells: columns.map(normalizeCell),
            });
        });
        const onDone =
            (token: "done" | "doneInProc" | "doneProc") =>
            (rowCount: number | undefined, more: boolean) => {
                lease.emit({
                    kind: "done",
                    driverSeq: lease.nextSeq(),
                    token,
                    ...(typeof rowCount === "number" ? { rowCount } : {}),
                    more: more === true,
                });
            };
        tdsRequest.on("done", onDone("done"));
        tdsRequest.on("doneInProc", onDone("doneInProc"));
        tdsRequest.on("doneProc", onDone("doneProc"));

        lease.bind(tdsRequest, this.connection);
        try {
            this.connection.execSqlBatch(tdsRequest);
            lease.resolveAccepted();
        } catch (error) {
            if (this.activeLease === lease) {
                this.activeLease = undefined;
            }
            lease.rejectAccepted(
                makeError("internal", error instanceof Error ? error.message : String(error)),
            );
            lease.complete({
                ok: false,
                error: { category: "internal", message: "execSqlBatch submission failed" },
            });
        }
        return lease;
    }

    async close(_context: DataPlaneOperationContext): Promise<void> {
        if (this.state === "closed") {
            return;
        }
        this.state = "closing";
        await new Promise<void>((resolve) => {
            this.connection.once("end", () => resolve());
            try {
                this.connection.close();
            } catch {
                resolve();
            }
        });
        this.state = "closed";
        this.connection.removeAllListeners();
    }

    destroy(_reason: string): void {
        if (this.state === "closed" || this.state === "lost") {
            return;
        }
        try {
            // tedious exposes no public destroy; close() sends attention and
            // tears down; socket-level errors surface through the router.
            this.connection.close();
        } catch {
            // already dead
        }
        this.handleLoss("network");
    }

    private routeMessage(message: TediousMessage, isError: boolean): void {
        const normalized = {
            number: message.number ?? 0,
            severity: message.class ?? (isError ? 16 : 0),
            ...(message.state !== undefined ? { state: message.state } : {}),
            message: message.message ?? "",
            ...(message.procName ? { procedure: message.procName } : {}),
            ...(message.lineNumber !== undefined ? { lineNumber: message.lineNumber } : {}),
            isError,
        };
        const lease = this.activeLease;
        if (lease && !lease.terminal) {
            lease.emit({ kind: "message", driverSeq: lease.nextSeq(), message: normalized });
        } else {
            this.observer.onOrphanMessage(normalized);
        }
    }

    private handleLoss(category: TdsErrorCategory, detail?: Error): void {
        if (this.lostFired || this.state === "closed" || this.state === "closing") {
            return;
        }
        this.lostFired = true;
        this.state = "lost";
        const lease = this.activeLease;
        this.activeLease = undefined;
        if (lease && !lease.terminal) {
            lease.complete({
                ok: false,
                error: {
                    category,
                    message: detail?.message ?? "connection lost",
                },
            });
        }
        this.connection.removeAllListeners();
        this.observer.onLost(category, detail ? { category, message: detail.message } : undefined);
    }
}

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

class TediousLease implements ITdsQueryLease {
    terminal = false;
    private seq = 0;
    private request: Request | undefined;
    private connection: Connection | undefined;
    private readonly pauseReasons = new Set<TdsPauseReason>();
    readonly accepted: Promise<void>;
    readonly completed: Promise<TdsCompletion>;
    private acceptResolve!: () => void;
    private acceptReject!: (error: Error) => void;
    private completeResolve!: (completion: TdsCompletion) => void;
    private acceptedSettled = false;

    constructor(
        readonly generation: number,
        private readonly observer: TdsQueryObserver,
    ) {
        this.accepted = new Promise<void>((resolve, reject) => {
            this.acceptResolve = resolve;
            this.acceptReject = reject;
        });
        this.accepted.catch(() => undefined);
        this.completed = new Promise<TdsCompletion>((resolve) => {
            this.completeResolve = resolve;
        });
    }

    bind(request: Request, connection: Connection): void {
        this.request = request;
        this.connection = connection;
    }

    nextSeq(): number {
        return this.seq++;
    }

    emit(event: TdsQueryEvent): void {
        if (!this.terminal) {
            this.observer.onEvent(event);
        }
    }

    resolveAccepted(): void {
        if (!this.acceptedSettled) {
            this.acceptedSettled = true;
            this.acceptResolve();
        }
    }

    rejectAccepted(error: Error): void {
        if (!this.acceptedSettled) {
            this.acceptedSettled = true;
            this.acceptReject(error);
        }
    }

    complete(completion: TdsCompletion): void {
        if (this.terminal) {
            return;
        }
        this.terminal = true;
        this.rejectAccepted(new Error("completed before acceptance"));
        this.request?.removeAllListeners();
        this.request = undefined;
        this.connection = undefined;
        this.completeResolve(completion);
    }

    pause(reason: TdsPauseReason): void {
        this.pauseReasons.add(reason);
        this.request?.pause();
    }

    resume(reason: TdsPauseReason): void {
        this.pauseReasons.delete(reason);
        if (this.pauseReasons.size === 0) {
            this.request?.resume();
        }
    }

    async cancel(_reason: TdsCancelReason): Promise<TdsCancelResult> {
        const connection = this.connection;
        if (!connection || this.terminal) {
            return { delivered: this.terminal };
        }
        try {
            // TDS attention for the CURRENT request (tedious cancels the
            // active request; ECANCEL surfaces through the callback).
            const delivered = connection.cancel();
            // A paused parser never observes the attention ack — resume.
            if (this.pauseReasons.size > 0) {
                this.pauseReasons.clear();
                this.request?.resume();
            }
            return { delivered: delivered !== false };
        } catch {
            return { delivered: false };
        }
    }
}

// ---------------------------------------------------------------------------
// Config / normalization
// ---------------------------------------------------------------------------

interface TediousMessage {
    number?: number;
    state?: number;
    class?: number;
    message?: string;
    procName?: string;
    lineNumber?: number;
}

interface TediousRowColumn {
    value: unknown;
    metadata?: TediousColumnMeta;
}

function buildConfig(request: TdsOpenRequest): ConnectionConfiguration {
    const authentication =
        request.auth.kind === "sqlLogin"
            ? {
                  type: "default" as const,
                  options: { userName: request.auth.user, password: request.auth.password },
              }
            : {
                  type: "azure-active-directory-access-token" as const,
                  options: { token: request.auth.token },
              };
    return {
        server: request.server,
        authentication,
        options: {
            ...(request.database !== undefined ? { database: request.database } : {}),
            ...(request.instanceName !== undefined
                ? { instanceName: request.instanceName }
                : { port: request.port ?? 1433 }),
            appName: request.applicationName,
            encrypt: request.encrypt,
            trustServerCertificate: request.trustServerCertificate,
            connectTimeout: request.connectTimeoutMs,
            // Domain absolute timer is authoritative (§2.4).
            requestTimeout: 0,
            cancelTimeout: 5_000,
            rowCollectionOnDone: false,
            rowCollectionOnRequestCompletion: false,
            useColumnNames: false,
            useUTC: true,
            // Never let tedious log payloads/tokens in any product mode.
            debug: { data: false, packet: false, payload: false, token: false },
        },
    };
}

function scrubAuth(config: ConnectionConfiguration): void {
    const options = (config.authentication as { options?: Record<string, unknown> })?.options;
    if (options) {
        delete options.password;
        delete options.token;
    }
}

function normalizeColumn(column: TediousColumnMeta): TdsColumn {
    return {
        name: column.colName,
        typeName: (column.type?.name ?? "unknown").toLowerCase(),
        ...(column.udtInfo?.typeName ? { udtName: column.udtInfo.typeName.toLowerCase() } : {}),
        ...(column.precision !== undefined ? { precision: column.precision } : {}),
        ...(column.scale !== undefined ? { scale: column.scale } : {}),
        ...(typeof column.dataLength === "number" && column.dataLength > 0
            ? { maxLength: column.dataLength }
            : {}),
    };
}

function normalizeCell(column: TediousRowColumn): TdsCell {
    const value = column.value;
    const nanos = (value as { nanosecondsDelta?: number } | null)?.nanosecondsDelta;
    return {
        value,
        // tedious carries sub-ms fractions as a non-enumerable property on
        // the Date; surface it explicitly (never reach into driver objects
        // above this adapter).
        ...(typeof nanos === "number" && nanos > 0
            ? { nanosecondsDelta: Math.round(nanos * 1e9) }
            : {}),
    };
}

function categorize(error: Error): TdsErrorCategory {
    const code = (error as { code?: string }).code;
    switch (code) {
        case "ECANCEL":
            return "cancel";
        case "ETIMEOUT":
            return "timeout";
        case "ESOCKET":
        case "ECONNRESET":
        case "ECONNCLOSED":
        case "EPIPE":
            return "network";
        case "ELOGIN":
            return "auth";
        default:
            return (error as { number?: number }).number !== undefined ? "server" : "internal";
    }
}

function mapConnectError(error: Error): TdsError & Error {
    const category = categorize(error);
    const enriched = error as TdsError & Error;
    const number = (error as { number?: number }).number;
    enriched.category =
        category === "auth" || (number !== undefined && AUTH_ERROR_NUMBERS.has(number))
            ? "auth"
            : category === "server"
              ? "network"
              : category;
    if (number !== undefined) {
        enriched.serverDetail = { number };
    }
    return enriched;
}

function mapRequestError(error: Error): TdsError {
    const category = categorize(error);
    const detail = error as {
        number?: number;
        state?: number;
        class?: number;
        lineNumber?: number;
        procName?: string;
    };
    return {
        category,
        message: error.message,
        ...(detail.number !== undefined
            ? {
                  serverDetail: {
                      number: detail.number,
                      ...(detail.class !== undefined ? { severity: detail.class } : {}),
                      ...(detail.state !== undefined ? { state: detail.state } : {}),
                      ...(detail.lineNumber !== undefined ? { line: detail.lineNumber } : {}),
                      ...(detail.procName !== undefined ? { procedure: detail.procName } : {}),
                  },
              }
            : {}),
    };
}
