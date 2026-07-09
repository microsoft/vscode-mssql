/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * STS2 JSON-RPC backend binding (AD-2): the protocol engine that turns the
 * pinned v2 wire (wire/v2.ts) into the SQL Data Plane domain contract.
 *
 * Responsibilities (doc 03 §8):
 *  - correlation + per-query ordered lanes (one sink callback in flight);
 *  - ack/credit ledger: high-water `v2/query.ack` sent only AFTER the sink
 *    durably accepts a page — never ack unseen, never regress, stop after
 *    terminal (§8.5);
 *  - invariant checks BEFORE sink delivery: metadata-before-rows, gapless
 *    pageSeq, monotonic rowOffset, exactly one terminal, silence after
 *    terminal (§8.6) — violations fail the query as ProtocolViolation, the
 *    partial result is never presented as truth;
 *  - deadlines + SYNTHESIZED terminals (§8.7): completion always settles;
 *  - fatal/availability (§8.8): sessions transition lost, sinks receive
 *    connectionLost, no v1 fallback here or anywhere.
 *
 * Privacy: SQL text and cell values never enter diagnostics; the wire
 * profile's auth object exists only inside openSession's request closure.
 */

import { diag } from "../../diagnostics/diagnosticsCore";
import {
    CancelAck,
    CompactPage,
    DataPlaneAvailability,
    DataPlaneErrorCodes,
    DataPlaneEvent,
    DatabaseContextChange,
    ExecuteOptions,
    IQueryEventSink,
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
    QueryCompleteSummary,
    QueryCompletionStatus,
    QueryHandle,
    ResultSetMetadata,
    ServerMessage,
    SessionInfo,
    SessionState,
    SessionStateChange,
    SqlBackendCapabilities,
    SqlDataPlaneError,
    TruncatedCellEncoding,
    packBitmap,
} from "../sqlDataPlane/api";
import {
    STS2_ERROR_CODES,
    STS2_METHODS,
    sts2ErrorCode,
    totalRowsAffected,
    V2CompleteNotification,
    V2ConnectionOpenResult,
    V2ConnectionProfile,
    V2FatalNotification,
    V2InitializeResult,
    V2MessageNotification,
    V2QueryExecuteResult,
    V2ResultSetNotification,
    V2RowsNotification,
    V2TruncatedCell,
    isV2TruncatedCell,
    wireColumnName,
    wireColumnNullable,
    wireColumnType,
} from "./wire/v2";

// ---------------------------------------------------------------------------
// Transport port (the real one wraps SqlToolsServiceClient; tests script it)
// ---------------------------------------------------------------------------

export interface Sts2Rpc {
    sendRequest<R>(method: string, params: unknown): Promise<R>;
    sendNotification(method: string, params: unknown): void;
    onNotification(method: string, handler: (params: unknown) => void): { dispose(): void };
}

export interface Sts2Deadlines {
    openMs: number;
    cancelAckMs: number;
    closeMs: number;
    disposeDrainMs: number;
    completeAfterCancelMs: number;
}

export const DEFAULT_DEADLINES: Sts2Deadlines = {
    openMs: 30_000,
    cancelAckMs: 10_000,
    closeMs: 15_000,
    disposeDrainMs: 10_000,
    completeAfterCancelMs: 30_000,
};

const STS2_CAPABILITIES: SqlBackendCapabilities = {
    streamingRows: true,
    creditBackpressure: true,
    cancel: true,
    dispose: true,
    oneActiveQueryPerSession: true,
    multipleResultSets: true,
    serverMessagesVerbatim: true,
    rowsAffectedStructured: true,
    executionPlanXml: false, // plan orchestration is Query Studio SET-wrapper territory (M3)
    estimatedPlan: true, // via SET wrappers driven by the feature
    actualPlan: true,
    typedCells: true,
    maxCellBytesHonored: false,
    pageRowsHonored: false,
    pageBytesHonored: false,
    queryTimeoutHonored: false,
    captureControl: true,
    replayDescriptors: true,
    resumeAfterDisconnect: false,
};

class Emitter<T> {
    private listeners = new Set<(e: T) => void>();
    readonly event: DataPlaneEvent<T> = (listener) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    };
    fire(e: T): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(e);
            } catch {
                /* listener isolation */
            }
        }
    }
}

let localIds = 0;
const nextLocalId = (prefix: string) => `${prefix}_${(++localIds).toString(36)}`;

/** Wire truncated-cell marker → backend-neutral compact encoding (validated). */
function toTruncatedCellEncoding(cell: V2TruncatedCell): TruncatedCellEncoding {
    return {
        $t: "truncated",
        of: cell.of === "binary" ? "binary" : "string",
        ...(typeof cell.bytes === "number" ? { bytes: cell.bytes } : {}),
        ...(typeof cell.digest === "string" ? { digest: cell.digest } : {}),
        v: typeof cell.v === "string" ? cell.v : "",
    };
}

/** engineType → compact typeHint (lazy CellValue decoding key). */
function typeHintFor(engineType: string | undefined): string {
    const t = (engineType ?? "").toLowerCase();
    if (!t) return "string";
    if (t === "bit") return "boolean";
    if (["int", "smallint", "tinyint", "float", "real"].includes(t)) return "number";
    if (["bigint", "decimal", "numeric", "money", "smallmoney"].includes(t)) return "number:approx";
    if (t.startsWith("date") || t.startsWith("time") || t === "smalldatetime") return "datetime";
    if (["varbinary", "binary", "image", "timestamp", "rowversion"].includes(t)) return "binary";
    if (t === "xml") return "xml";
    return "string";
}

// ---------------------------------------------------------------------------
// Backend service
// ---------------------------------------------------------------------------

export class Sts2Backend implements ISqlConnectionService {
    availability: DataPlaneAvailability = { state: "unknown" };
    private availabilityEmitter = new Emitter<DataPlaneAvailability>();
    readonly onDidChangeAvailability = this.availabilityEmitter.event;
    readonly backendInfo = { kind: "sts2-jsonrpc", displayName: "STS2 (JSON-RPC)" };

    private sessions = new Map<string, Sts2Session>();
    /** queryId → active query lane (engine-level demux). */
    private queries = new Map<string, Sts2Query>();
    /**
     * Notifications can race the execute response dispatch; unknown queryIds
     * buffer briefly until the execute result registers the lane.
     */
    private orphanBuffer = new Map<string, unknown[][]>();
    private notificationSubs: Array<{ dispose(): void }> = [];

    constructor(
        private readonly rpc: Sts2Rpc,
        readonly deadlines: Sts2Deadlines = DEFAULT_DEADLINES,
    ) {}

    /** v2/initialize handshake; MethodNotFound ⇒ notEnabledOnService. */
    async start(): Promise<DataPlaneAvailability> {
        this.subscribe();
        try {
            const result = await this.rpc.sendRequest<V2InitializeResult>(STS2_METHODS.initialize, {
                clientName: "vscode-mssql-sqlDataPlane",
                requestedSpecVersion: "2.0",
            });
            this.availability = {
                state: "available",
                backend: this.backendInfo.kind,
                capabilities: {
                    ...STS2_CAPABILITIES,
                    // Service-declared, honestly false unless explicitly true.
                    maxCellBytesHonored: result.capabilities?.["maxCellBytesHonored"] === true,
                    pageRowsHonored: result.capabilities?.["pageRowsHonored"] === true,
                    pageBytesHonored: result.capabilities?.["pageBytesHonored"] === true,
                    queryTimeoutHonored: result.capabilities?.["queryTimeoutHonored"] === true,
                    protocolVersion: result.specVersion,
                },
            };
        } catch (error) {
            const code = sts2ErrorCode(error);
            const message = error instanceof Error ? error.message : String(error);
            const notEnabled =
                /method not found|unhandled method/i.test(message) || code === undefined;
            this.availability = {
                state: "unavailable",
                backend: this.backendInfo.kind,
                reason: notEnabled
                    ? "notEnabledOnService (launch STS with --enable-sts2)"
                    : `${code ?? "error"}: ${message}`,
                retryable: true,
            };
        }
        this.availabilityEmitter.fire(this.availability);
        return this.availability;
    }

    private subscribe(): void {
        if (this.notificationSubs.length > 0) {
            return;
        }
        const route = <T extends { queryId: string }>(
            method: string,
            deliver: (query: Sts2Query, params: T) => void,
        ) =>
            this.rpc.onNotification(method, (raw) => {
                const params = raw as T;
                const query = this.queries.get(params.queryId);
                if (query) {
                    deliver(query, params);
                } else {
                    const buffered = this.orphanBuffer.get(params.queryId) ?? [];
                    buffered.push([method, params]);
                    this.orphanBuffer.set(params.queryId, buffered);
                }
            });
        this.notificationSubs.push(
            route<V2ResultSetNotification>(STS2_METHODS.queryResultSet, (q, p) =>
                q.onWireResultSet(p),
            ),
            route<V2RowsNotification>(STS2_METHODS.queryRows, (q, p) => q.onWireRows(p)),
            route<V2MessageNotification>(STS2_METHODS.queryMessage, (q, p) => q.onWireMessage(p)),
            route<V2CompleteNotification>(STS2_METHODS.queryComplete, (q, p) =>
                q.onWireComplete(p),
            ),
            this.rpc.onNotification(STS2_METHODS.fatal, (raw) => {
                this.onFatal((raw as V2FatalNotification)?.reason ?? "v2/fatal");
            }),
        );
    }

    registerQuery(query: Sts2Query): void {
        this.queries.set(query.backendId, query);
        // Drain anything that arrived before the execute result dispatched.
        const buffered = this.orphanBuffer.get(query.backendId);
        if (buffered) {
            this.orphanBuffer.delete(query.backendId);
            for (const [method, params] of buffered) {
                switch (method) {
                    case STS2_METHODS.queryResultSet:
                        query.onWireResultSet(params as V2ResultSetNotification);
                        break;
                    case STS2_METHODS.queryRows:
                        query.onWireRows(params as V2RowsNotification);
                        break;
                    case STS2_METHODS.queryMessage:
                        query.onWireMessage(params as V2MessageNotification);
                        break;
                    case STS2_METHODS.queryComplete:
                        query.onWireComplete(params as V2CompleteNotification);
                        break;
                }
            }
        }
    }

    unregisterQuery(backendId: string): void {
        this.queries.delete(backendId);
        this.orphanBuffer.delete(backendId);
    }

    private onFatal(reason: string): void {
        this.availability = {
            state: "unavailable",
            backend: this.backendInfo.kind,
            reason,
            retryable: true,
        };
        this.availabilityEmitter.fire(this.availability);
        for (const session of [...this.sessions.values()]) {
            session.markLost(reason);
        }
        diag.emit({
            feature: "sqlDataPlane",
            type: "sqlDataPlane.fatal",
            status: "error",
            fields: { reason: { raw: reason, cls: "diagnostic.metadata" } },
        });
    }

    async canOpen(): Promise<{ ok: boolean; reason?: string }> {
        if (this.availability.state === "unknown") {
            await this.start();
        }
        return this.availability.state === "available"
            ? { ok: true }
            : {
                  ok: false,
                  reason:
                      this.availability.state === "unavailable"
                          ? this.availability.reason
                          : "unknown",
              };
    }

    async openSession(params: OpenSessionParams): Promise<ISqlSession> {
        const check = await this.canOpen();
        if (!check.ok) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.unavailable,
                check.reason ?? "STS2 unavailable",
                true,
            );
        }
        // Secrets exist ONLY inside this request payload; the service
        // tokenizes them pre-journal (SPEC §8.5). Never store or log.
        const auth: V2ConnectionProfile["auth"] = { kind: "integrated" };
        if (params.profile.authKind === "sql") {
            auth.kind = "sqlLogin";
            auth.user = params.profile.user;
            auth.password = (await params.auth?.passwordProvider?.()) ?? "";
        } else if (params.profile.authKind === "aad" || params.profile.authKind === "bearer") {
            auth.kind = "accessToken";
            auth.accessToken = (await params.auth?.tokenProvider?.()) ?? "";
        }
        const profile: V2ConnectionProfile = {
            server: params.profile.server,
            ...((params.database ?? params.profile.database)
                ? { database: params.database ?? params.profile.database }
                : {}),
            driver: "sqlclient",
            auth,
            options: {
                applicationName: params.applicationName,
                ...(params.openTimeoutMs ? { connectTimeoutMs: params.openTimeoutMs } : {}),
                ...(params.profile.encrypt !== undefined
                    ? { encrypt: String(params.profile.encrypt) }
                    : {}),
                ...(params.profile.trustServerCertificate !== undefined
                    ? {
                          trustServerCertificate: String(params.profile.trustServerCertificate),
                      }
                    : {}),
            },
        };
        const openId = nextLocalId("open");
        const span = diag.startSpan({
            feature: "sqlDataPlane",
            kind: "request",
            type: "sqlDataPlane.openSession",
            fields: {
                backend: { raw: this.backendInfo.kind, cls: "diagnostic.metadata" },
                authKind: { raw: auth.kind, cls: "diagnostic.metadata" },
            },
        });
        try {
            const result = await withDeadline(
                this.rpc.sendRequest<V2ConnectionOpenResult>(STS2_METHODS.connectionOpen, {
                    openId,
                    profile,
                }),
                params.openTimeoutMs ?? this.deadlines.openMs,
                () => {
                    // Bounded open: cancel the in-flight open server-side.
                    void this.rpc
                        .sendRequest(STS2_METHODS.connectionCancel, { openId })
                        .catch(() => undefined);
                },
            );
            const session = new Sts2Session(this, this.rpc, params, result);
            this.sessions.set(session.sessionId, session);
            span.end("ok");
            return session;
        } catch (error) {
            span.fail(error);
            throw mapOpenError(error);
        }
    }

    removeSession(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    /** Safe status summary for the data-plane status command. */
    status(): Record<string, unknown> {
        return {
            availability: this.availability,
            openSessions: this.sessions.size,
            activeQueries: this.queries.size,
        };
    }
}

function mapOpenError(error: unknown): SqlDataPlaneError {
    if (error instanceof SqlDataPlaneError) {
        return error;
    }
    const code = sts2ErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    if (code === STS2_ERROR_CODES.connectionFailedAuth) {
        return new SqlDataPlaneError(DataPlaneErrorCodes.auth, message, false, {
            backend: { kind: "sts2-jsonrpc", code },
        });
    }
    if (code === STS2_ERROR_CODES.busy) {
        return new SqlDataPlaneError(DataPlaneErrorCodes.busy, message, true, {
            backend: { kind: "sts2-jsonrpc", code },
        });
    }
    return new SqlDataPlaneError(DataPlaneErrorCodes.unavailable, message, true, {
        backend: { kind: "sts2-jsonrpc", ...(code ? { code } : {}) },
    });
}

function withDeadline<T>(promise: Promise<T>, ms: number, onExpire?: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            onExpire?.();
            reject(
                new SqlDataPlaneError(
                    DataPlaneErrorCodes.clientTimeout,
                    `deadline expired after ${ms}ms`,
                    true,
                    { synthesized: true },
                ),
            );
        }, ms);
        (timer as { unref?: () => void }).unref?.();
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export class Sts2Session implements ISqlSession {
    readonly sessionId = nextLocalId("s2s");
    readonly connectionId: string;
    readonly capabilities: SqlBackendCapabilities;
    readonly info: SessionInfo;
    state: SessionState = "open";

    private stateEmitter = new Emitter<SessionStateChange>();
    private dbEmitter = new Emitter<DatabaseContextChange>();
    private msgEmitter = new Emitter<ServerMessage>();
    readonly onDidChangeState = this.stateEmitter.event;
    readonly onDidChangeDatabase = this.dbEmitter.event;
    readonly onServerInfoMessage = this.msgEmitter.event;

    private activeQuery: Sts2Query | undefined;

    constructor(
        private readonly backend: Sts2Backend,
        private readonly rpc: Sts2Rpc,
        params: OpenSessionParams,
        openResult: V2ConnectionOpenResult,
    ) {
        this.connectionId = openResult.connectionId;
        this.capabilities =
            this.backend.availability.state === "available"
                ? this.backend.availability.capabilities
                : STS2_CAPABILITIES;
        this.info = {
            serverDisplayName: params.profile.server,
            serverVersion: openResult.serverInfo?.version,
            engineEdition: openResult.serverInfo?.engineEdition,
            database: params.database ?? params.profile.database,
            loginName: params.profile.user,
            backendKind: "sts2-jsonrpc",
        };
    }

    execute(text: string, opts: ExecuteOptions, sink: IQueryEventSink): QueryHandle {
        if (this.state !== "open") {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.unavailable,
                `session is ${this.state}`,
                this.state === "lost",
            );
        }
        if (this.activeQuery) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.busy,
                "one active query per STS2 session",
                true,
            );
        }
        const query = new Sts2Query(this.backend, this.rpc, this, text, opts, sink);
        this.activeQuery = query;
        void query.handle.completion.finally(() => {
            if (this.activeQuery === query) {
                this.activeQuery = undefined;
            }
        });
        return query.handle;
    }

    signalDatabaseChanged(database: string, source: DatabaseContextChange["source"]): void {
        this.info.database = database;
        this.dbEmitter.fire({ database, source });
    }

    markLost(reason: string): void {
        if (this.state === "closed" || this.state === "lost") {
            return;
        }
        this.transition("lost", reason);
        this.activeQuery?.synthesizeTerminal("connectionLost", reason);
        this.backend.removeSession(this.sessionId);
    }

    async close(): Promise<void> {
        if (this.state === "closed" || this.state === "closing") {
            return;
        }
        this.transition("closing", "close requested");
        try {
            // The service cancels an active query first (CONTRACT close).
            await withDeadline(
                this.rpc.sendRequest(STS2_METHODS.connectionClose, {
                    connectionId: this.connectionId,
                }),
                this.backend.deadlines.closeMs,
            );
        } catch {
            // Bounded close: proceed to closed; the active query synthesizes.
        }
        this.activeQuery?.synthesizeTerminal("connectionLost", "session closed");
        this.transition("closed", "closed");
        this.backend.removeSession(this.sessionId);
    }

    dispose(): void {
        void this.close();
    }

    private transition(next: SessionState, reason: string): void {
        const previous = this.state;
        this.state = next;
        this.stateEmitter.fire({ previous, current: next, reason });
    }
}

// ---------------------------------------------------------------------------
// Query lane: ordered delivery, invariants, ledger, synthesized terminals
// ---------------------------------------------------------------------------

interface ResultSetLedger {
    metadataSeen: boolean;
    nextPageSeq: number;
    nextRowOffset: number;
    columnCount: number;
    typeHints: string[];
}

export class Sts2Query {
    readonly clientQueryId = nextLocalId("s2q");
    backendId = ""; // set when execute result arrives
    readonly handle: QueryHandle;

    private completionResolve!: (s: QueryCompleteSummary) => void;
    private backendIdResolve!: (s: string) => void;
    private terminalSent = false;
    private cancelRequested = false;
    private cancelDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    private lane: Promise<void> = Promise.resolve();
    private ledgers = new Map<number, ResultSetLedger>();
    private highestAckedPageSeq = -1;
    private totalRows = 0;
    private resultSets = 0;
    private errors = 0;
    private startMs = Date.now();
    // Row-pipeline attribution accumulators (QO-2), reported on the
    // sqlDataPlane.execute span at terminal.
    private pagesSeen = 0;
    private wireApproxBytes = 0;
    private convertMsTotal = 0;
    private sinkWaitMsTotal = 0;

    constructor(
        private readonly backend: Sts2Backend,
        private readonly rpc: Sts2Rpc,
        private readonly session: Sts2Session,
        text: string,
        private readonly opts: ExecuteOptions,
        private readonly sink: IQueryEventSink,
    ) {
        const completion = new Promise<QueryCompleteSummary>((resolve) => {
            this.completionResolve = resolve;
        });
        const backendQueryId = new Promise<string>((resolve) => {
            this.backendIdResolve = resolve;
        });
        this.handle = {
            clientQueryId: this.clientQueryId,
            backendQueryId,
            completion,
            cancel: () => this.cancel(),
            dispose: () => this.disposeQuery(),
        };
        // Adapter execute span: construct -> terminal. Protocol metadata only
        // (ids/counts/status) — SQL text never rides the diag substrate.
        const executeSpan = diag.startSpan({
            feature: "sqlDataPlane",
            kind: "span",
            type: "sqlDataPlane.execute",
            fields: {
                clientQueryId: { raw: this.clientQueryId, cls: "diagnostic.metadata" },
            },
        });
        void completion.then((summary) => {
            executeSpan.end(
                summary.status === "succeeded"
                    ? "ok"
                    : summary.status === "failed"
                      ? "error"
                      : "warning",
                {
                    status: { raw: summary.status, cls: "diagnostic.metadata" },
                    resultSets: { raw: this.resultSets, cls: "diagnostic.metadata" },
                    rows: { raw: this.totalRows, cls: "diagnostic.metadata" },
                    errors: { raw: this.errors, cls: "diagnostic.metadata" },
                    canceled: { raw: this.cancelRequested, cls: "diagnostic.metadata" },
                    // Binding row-pipeline aggregates (QO-2): what the
                    // extension-side page path cost for this query.
                    pages: { raw: this.pagesSeen, cls: "diagnostic.metadata" },
                    wireApproxBytes: { raw: this.wireApproxBytes, cls: "diagnostic.metadata" },
                    convertMsTotal: {
                        raw: Math.round(this.convertMsTotal * 100) / 100,
                        cls: "diagnostic.metadata",
                    },
                    sinkWaitMsTotal: {
                        raw: Math.round(this.sinkWaitMsTotal * 100) / 100,
                        cls: "diagnostic.metadata",
                    },
                },
            );
        });
        void this.start(text);
    }

    private async start(text: string): Promise<void> {
        try {
            // Execute options ride `options` per SPEC §7.5 (QO-3): page limits are
            // lower-only server-side; timeout 0/absent = provider default; capped
            // cells arrive as truncated markers. NOTE: pageRows previously rode
            // top-level where the service ignored it — options.* is the honored shape.
            const options: Record<string, number> = {};
            if (this.opts.pageRows) {
                options.pageRows = this.opts.pageRows;
            }
            if (this.opts.pageBytes) {
                options.pageBytes = this.opts.pageBytes;
            }
            if (this.opts.maxCellBytes) {
                options.maxCellBytes = this.opts.maxCellBytes;
            }
            if (this.opts.timeoutMs) {
                options.queryTimeoutMs = this.opts.timeoutMs;
            }
            const result = await this.rpc.sendRequest<V2QueryExecuteResult>(
                STS2_METHODS.queryExecute,
                {
                    connectionId: this.session.connectionId,
                    sql: text,
                    ...(Object.keys(options).length > 0 ? { options } : {}),
                },
            );
            this.backendId = result.queryId;
            this.backendIdResolve(result.queryId);
            this.backend.registerQuery(this);
            this.enqueue(() =>
                this.sink.onAccepted?.({
                    clientQueryId: this.clientQueryId,
                    backendQueryId: result.queryId,
                }),
            );
        } catch (error) {
            const code = sts2ErrorCode(error);
            this.errors++;
            this.synthesizeTerminal(
                "failed",
                `execute rejected: ${code ?? (error instanceof Error ? error.message : String(error))}`,
                false,
            );
        }
    }

    // --- wire deliveries (engine demux calls these) -------------------------

    onWireResultSet(params: V2ResultSetNotification): void {
        if (this.terminalGuard("resultSet")) return;
        const ledger: ResultSetLedger = {
            metadataSeen: true,
            nextPageSeq: 0,
            nextRowOffset: 0,
            columnCount: params.columns.length,
            typeHints: params.columns.map((c) => typeHintFor(wireColumnType(c))),
        };
        this.ledgers.set(params.resultSetId, ledger);
        this.resultSets++;
        const meta: ResultSetMetadata = {
            resultSetId: String(params.resultSetId),
            batchOrdinal: 0,
            columns: params.columns.map((column, ordinal) => ({
                ordinal,
                name: wireColumnName(column),
                displayName: wireColumnName(column),
                sqlType: wireColumnType(column),
                allowNull: wireColumnNullable(column),
            })),
        };
        this.enqueue(() => this.sink.onResultSetStarted(meta));
    }

    onWireRows(params: V2RowsNotification): void {
        if (this.terminalGuard("rows")) return;
        const ledger = this.ledgers.get(params.resultSetId);
        if (!ledger) {
            this.protocolViolation(`rows for result set ${params.resultSetId} before metadata`);
            return;
        }
        if (params.pageSeq !== ledger.nextPageSeq) {
            this.protocolViolation(
                `pageSeq gap in result set ${params.resultSetId}: expected ${ledger.nextPageSeq}, got ${params.pageSeq}`,
            );
            return;
        }
        if (params.rowOffset !== ledger.nextRowOffset) {
            this.protocolViolation(
                `rowOffset mismatch: expected ${ledger.nextRowOffset}, got ${params.rowOffset}`,
            );
            return;
        }
        ledger.nextPageSeq++;
        ledger.nextRowOffset += params.rows.length;
        this.totalRows += params.rows.length;
        this.pagesSeen++;

        const convertStartedAt = performance.now();
        const bits: boolean[] = [];
        const values: unknown[][] = params.rows.map((row) =>
            row.map((cell) => {
                bits.push(cell === null || cell === undefined);
                if (isV2TruncatedCell(cell)) {
                    // Byte-capped cell (maxCellBytes): normalize the wire
                    // marker into the backend-neutral compact encoding HERE —
                    // wire DTOs never leave sts2/, and downstream decode
                    // fallbacks would String() the raw object.
                    return toTruncatedCellEncoding(cell);
                }
                return cell === null ? undefined : cell;
            }),
        );
        const compact: CompactPage = {
            values,
            nullBitmap: packBitmap(bits),
            typeHints: ledger.typeHints,
        };
        const page = {
            resultSetId: String(params.resultSetId),
            pageSeq: params.pageSeq,
            rowOffset: params.rowOffset,
            compact,
            rowCount: params.rows.length,
            approxBytes: JSON.stringify(params.rows).length,
        };
        this.convertMsTotal += performance.now() - convertStartedAt;
        this.wireApproxBytes += page.approxBytes;
        this.enqueue(async () => {
            // Durable acceptance first, THEN the high-water ack (§8.5).
            const sinkStartedAt = performance.now();
            await this.sink.onRowsPage(page);
            this.sinkWaitMsTotal += performance.now() - sinkStartedAt;
            if (!this.terminalSent && params.pageSeq > this.highestAckedPageSeq) {
                this.highestAckedPageSeq = params.pageSeq;
                this.rpc.sendNotification(STS2_METHODS.queryAck, {
                    queryId: this.backendId,
                    throughPageSeq: params.pageSeq,
                });
            }
        });
    }

    onWireMessage(params: V2MessageNotification): void {
        if (this.terminalGuard("message")) return;
        const kind =
            params.messageClass === "error"
                ? "error"
                : params.messageClass === "warning"
                  ? "warning"
                  : "info";
        if (kind === "error") {
            this.errors++;
        }
        const message: ServerMessage = {
            kind,
            text: params.text,
            ...(params.number !== undefined ? { number: params.number } : {}),
            ...(params.severity !== undefined ? { severity: params.severity } : {}),
            ...(params.line !== undefined ? { line: params.line } : {}),
        };
        this.enqueue(() => this.sink.onMessage(message));
    }

    onWireComplete(params: V2CompleteNotification): void {
        if (this.terminalSent) {
            // Duplicate terminal: diag + drop (§8.3).
            diag.emit({
                feature: "sqlDataPlane",
                type: "sqlDataPlane.protocolViolation",
                status: "warning",
                fields: {
                    expectation: { raw: "one terminal", cls: "diagnostic.metadata" },
                    observation: { raw: "duplicate complete", cls: "diagnostic.metadata" },
                },
            });
            return;
        }
        const status: QueryCompletionStatus =
            params.status === "succeeded"
                ? this.errors > 0
                    ? "completedWithErrors"
                    : "succeeded"
                : params.status === "canceled"
                  ? "canceled"
                  : params.status === "disposed"
                    ? "disposed"
                    : "failed";
        // Backend database truth (ENVCHANGE): a USE executed in the script
        // changes the connection's database; reconcile session info + fire
        // the change event (sources-of-truth ladder: backend wins, doc 04
        // §11.4). No-op when unchanged.
        if (
            typeof params.database === "string" &&
            params.database.length > 0 &&
            params.database !== this.session.info.database
        ) {
            this.session.signalDatabaseChanged(params.database, "backend");
        }
        this.finishTerminal({
            clientQueryId: this.clientQueryId,
            status,
            resultSetCount: this.resultSets,
            totalRows: this.totalRows,
            errorCount: this.errors,
            durationMs: Date.now() - this.startMs,
            ...(totalRowsAffected(params.rowsAffected) !== undefined
                ? { rowsAffected: totalRowsAffected(params.rowsAffected) }
                : {}),
            ...(params.error
                ? {
                      error: {
                          code: params.error.code ?? STS2_ERROR_CODES.queryFailedServer,
                          message: params.error.message ?? "query failed",
                          retryable: false,
                          ...(params.error.server ? { server: params.error.server } : {}),
                      },
                  }
                : {}),
        });
    }

    // --- control -------------------------------------------------------------

    private async cancel(): Promise<CancelAck> {
        this.cancelRequested = true;
        try {
            await withDeadline(
                this.rpc.sendRequest(STS2_METHODS.queryCancel, { queryId: this.backendId }),
                this.backend.deadlines.cancelAckMs,
            );
            // Terminal must still arrive; synthesize if it never does (§8.7).
            this.armCancelCompletionDeadline();
            return { acknowledged: true };
        } catch (error) {
            this.armCancelCompletionDeadline();
            return {
                acknowledged: false,
                uncertain: true,
                reason: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private armCancelCompletionDeadline(): void {
        if (this.cancelDeadlineTimer || this.terminalSent) {
            return;
        }
        this.cancelDeadlineTimer = setTimeout(() => {
            this.synthesizeTerminal(
                "canceled",
                `no terminal within ${this.backend.deadlines.completeAfterCancelMs}ms of cancel`,
            );
        }, this.backend.deadlines.completeAfterCancelMs);
        (this.cancelDeadlineTimer as { unref?: () => void }).unref?.();
    }

    private async disposeQuery(): Promise<void> {
        try {
            await withDeadline(
                this.rpc.sendRequest(STS2_METHODS.queryDispose, { queryId: this.backendId }),
                this.backend.deadlines.disposeDrainMs,
            );
            // D-0011: the wire complete(disposed) is the single terminal; give
            // it the drain window, then synthesize.
            setTimeout(() => {
                this.synthesizeTerminal("disposed", "dispose drain expired");
            }, this.backend.deadlines.disposeDrainMs).unref?.();
        } catch {
            this.synthesizeTerminal("disposed", "dispose request failed/expired");
        }
    }

    /** Adapter-fabricated terminal (§8.7): visible, honest, always settles. */
    synthesizeTerminal(status: QueryCompletionStatus, reason: string, viaDiag = true): void {
        if (this.terminalSent) {
            return;
        }
        if (viaDiag) {
            diag.emit({
                feature: "sqlDataPlane",
                type: "sqlDataPlane.deadline",
                status: "warning",
                fields: {
                    operation: { raw: "queryTerminal", cls: "diagnostic.metadata" },
                    reason: { raw: reason, cls: "diagnostic.metadata" },
                },
            });
        }
        this.finishTerminal({
            clientQueryId: this.clientQueryId,
            status,
            resultSetCount: this.resultSets,
            totalRows: this.totalRows,
            errorCount: this.errors,
            durationMs: Date.now() - this.startMs,
            synthesized: true,
            error: {
                code:
                    status === "connectionLost"
                        ? DataPlaneErrorCodes.unavailable
                        : DataPlaneErrorCodes.clientTimeout,
                message: reason,
                retryable: status === "connectionLost",
                synthesized: true,
            },
        });
    }

    private protocolViolation(observation: string): void {
        diag.emit({
            feature: "sqlDataPlane",
            type: "sqlDataPlane.protocolViolation",
            status: "error",
            fields: {
                observation: { raw: observation, cls: "diagnostic.metadata" },
                backend: { raw: "sts2-jsonrpc", cls: "diagnostic.metadata" },
            },
        });
        // Best-effort backend cancel; the partial grid is not truth (§8.6).
        void this.rpc
            .sendRequest(STS2_METHODS.queryCancel, { queryId: this.backendId })
            .catch(() => undefined);
        this.finishTerminal({
            clientQueryId: this.clientQueryId,
            status: "failed",
            resultSetCount: this.resultSets,
            totalRows: this.totalRows,
            errorCount: this.errors + 1,
            durationMs: Date.now() - this.startMs,
            error: {
                code: DataPlaneErrorCodes.protocolViolation,
                message: observation,
                retryable: false,
            },
        });
    }

    private finishTerminal(summary: QueryCompleteSummary): void {
        if (this.terminalSent) {
            return;
        }
        this.terminalSent = true;
        if (this.cancelDeadlineTimer) {
            clearTimeout(this.cancelDeadlineTimer);
        }
        this.enqueue(async () => {
            try {
                await this.sink.onComplete(summary);
            } finally {
                this.completionResolve(summary);
                this.backend.unregisterQuery(this.backendId);
            }
        });
    }

    /** True when events must be dropped (after terminal). */
    private terminalGuard(what: string): boolean {
        if (!this.terminalSent) {
            return false;
        }
        diag.emit({
            feature: "sqlDataPlane",
            type: "sqlDataPlane.protocolViolation",
            status: "warning",
            fields: {
                observation: { raw: `${what} after terminal`, cls: "diagnostic.metadata" },
            },
        });
        return true;
    }

    /** One sink callback in flight per query — the ordered lane. */
    private enqueue(step: () => void | Promise<void> | undefined): void {
        this.lane = this.lane
            .then(async () => {
                await step();
            })
            .catch((error) => {
                // Sink failure: local fail, stop delivering (doc 03 §4.4).
                if (!this.terminalSent) {
                    this.terminalSent = true;
                    this.completionResolve({
                        clientQueryId: this.clientQueryId,
                        status: "failed",
                        resultSetCount: this.resultSets,
                        totalRows: this.totalRows,
                        errorCount: this.errors + 1,
                        durationMs: Date.now() - this.startMs,
                        error: {
                            code: DataPlaneErrorCodes.sinkError,
                            message: error instanceof Error ? error.message : String(error),
                            retryable: false,
                        },
                    });
                    this.backend.unregisterQuery(this.backendId);
                    void this.rpc
                        .sendRequest(STS2_METHODS.queryCancel, { queryId: this.backendId })
                        .catch(() => undefined);
                }
            });
    }

    get wasCancelRequested(): boolean {
        return this.cancelRequested;
    }
}
