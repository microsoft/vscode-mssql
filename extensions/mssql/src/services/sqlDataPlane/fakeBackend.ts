/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * FakeBackend — deterministic, transcript-driven ISqlConnectionService for
 * unit tests, conformance transcripts, perftest, and self-test (doc 03
 * §16.4). Scripts declare the exact event stream a query produces; chaos
 * knobs inject the failure modes the conformance suite must survive
 * (delays, duplicate/gapped pages, rows-before-metadata, missing terminal,
 * fatal mid-stream).
 *
 * The fake enforces the SINK contract exactly like a real binding must:
 * callbacks serialized per query, onRowsPage awaited before the next event
 * (backpressure), one terminal, no events after terminal unless the chaos
 * knob explicitly violates it (to prove the consumer-side invariant checks).
 */

import {
    CancelAck,
    CellValue,
    CompactPage,
    DataPlaneAvailability,
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
    RowsPage,
    ServerMessage,
    SessionInfo,
    SessionState,
    SessionStateChange,
    SqlBackendCapabilities,
    SqlDataPlaneError,
    DataPlaneErrorCodes,
    packBitmap,
} from "./api";

// --- tiny local emitter (no vscode dependency) ------------------------------

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
                // listener errors never break the backend
            }
        }
    }
}

// --- transcripts -------------------------------------------------------------

export type FakeQueryEvent =
    | { type: "accepted"; delayMs?: number }
    | {
          type: "resultSet";
          columns: string[];
          /** Rows as display values; null = NULL cell. */
          rows: (string | number | boolean | null)[][];
          pageSize?: number;
          isPlanResult?: boolean;
          delayMs?: number;
          /** Pacing between pages (streaming/cancel tests). */
          pageDelayMs?: number;
      }
    | {
          type: "message";
          kind: "info" | "warning" | "error";
          text: string;
          line?: number;
          rowsAffected?: number;
      }
    | { type: "plan"; xml: string }
    | { type: "complete"; status: QueryCompletionStatus; rowsAffected?: number; delayMs?: number }
    // chaos knobs (conformance suite provocations)
    | { type: "chaos:duplicatePage" }
    | { type: "chaos:gapPage" }
    | { type: "chaos:rowsBeforeMetadata" }
    | { type: "chaos:eventAfterComplete" }
    | { type: "chaos:noTerminal" }
    | { type: "chaos:fatal" };

export interface FakeScript {
    /** Matched against the executed text (exact or predicate). */
    match: string | ((text: string) => boolean);
    events: FakeQueryEvent[];
}

export interface FakeBackendOptions {
    scripts?: FakeScript[];
    openDelayMs?: number;
    failOpen?: { code: string; message: string };
    capabilities?: Partial<SqlBackendCapabilities>;
    database?: string;
    spid?: number;
}

const FAKE_CAPABILITIES: SqlBackendCapabilities = {
    protocolVersion: "fake/1",
    streamingRows: true,
    creditBackpressure: true,
    cancel: true,
    dispose: true,
    oneActiveQueryPerSession: true,
    multipleResultSets: true,
    serverMessagesVerbatim: true,
    rowsAffectedStructured: true,
    executionPlanXml: true,
    estimatedPlan: true,
    actualPlan: true,
    typedCells: true,
    maxCellBytesHonored: true,
    pageRowsHonored: false,
    pageBytesHonored: false,
    queryTimeoutHonored: false,
    compactRows: false,
    captureControl: false,
    replayDescriptors: true,
    resumeAfterDisconnect: false,
};

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${(++idCounter).toString(36)}`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function toCompact(rows: (string | number | boolean | null)[][]): CompactPage {
    const bits: boolean[] = [];
    const values: unknown[][] = rows.map((row) =>
        row.map((cell) => {
            bits.push(cell === null);
            return cell === null ? undefined : cell;
        }),
    );
    return { values, nullBitmap: packBitmap(bits) };
}

// --- session -----------------------------------------------------------------

class FakeSession implements ISqlSession {
    readonly sessionId = nextId("fsess");
    readonly connectionId = nextId("fconn");
    readonly capabilities: SqlBackendCapabilities;
    state: SessionState = "open";
    readonly info: SessionInfo;

    private stateEmitter = new Emitter<SessionStateChange>();
    private dbEmitter = new Emitter<DatabaseContextChange>();
    private msgEmitter = new Emitter<ServerMessage>();
    readonly onDidChangeState = this.stateEmitter.event;
    readonly onDidChangeDatabase = this.dbEmitter.event;
    readonly onServerInfoMessage = this.msgEmitter.event;

    private activeQuery: FakeQuery | undefined;

    constructor(
        private readonly backend: FakeBackend,
        params: OpenSessionParams,
        caps: SqlBackendCapabilities,
    ) {
        this.capabilities = caps;
        this.info = {
            serverDisplayName: params.profile.server,
            serverVersion: "17.0 FAKE",
            database:
                params.database ??
                params.profile.database ??
                this.backend.options.database ??
                "FakeDb",
            loginName: params.profile.user ?? "fake",
            spid: this.backend.options.spid ?? 159,
            encrypted: true,
            backendKind: "fake",
        };
    }

    execute(text: string, opts: ExecuteOptions, sink: IQueryEventSink): QueryHandle {
        if (this.state !== "open") {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.unavailable,
                `session is ${this.state}`,
                false,
            );
        }
        if (this.activeQuery && this.capabilities.oneActiveQueryPerSession) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.busy,
                "one active query per session (fake enforces like STS2)",
                true,
            );
        }
        const script = this.backend.findScript(text);
        const query = new FakeQuery(this, script, opts, sink);
        this.activeQuery = query;
        // Clear the active slot via the COMPLETION promise, registered before
        // any caller's await — promise reactions run in registration order,
        // so a sequential batch loop can execute again immediately.
        void query.handle.completion.finally(() => {
            if (this.activeQuery === query) {
                this.activeQuery = undefined;
            }
        });
        void query.run();
        return query.handle;
    }

    /** Chaos entry: kill the session mid-flight (fatal / transport down). */
    fatal(reason: string): void {
        this.transition("lost", reason);
        this.activeQuery?.connectionLost(reason);
    }

    signalDatabase(database: string): void {
        this.info.database = database;
        this.dbEmitter.fire({ database, source: "backend" });
    }

    signalDatabaseChanged(database: string, source: DatabaseContextChange["source"]): void {
        this.info.database = database;
        this.dbEmitter.fire({ database, source });
    }

    async close(): Promise<void> {
        if (this.state === "closed") {
            return; // idempotent
        }
        this.transition("closing", "close requested");
        if (this.activeQuery) {
            this.activeQuery.connectionLost("session closed during query");
        }
        this.transition("closed", "closed");
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

// --- query -------------------------------------------------------------------

class FakeQuery {
    readonly clientQueryId = nextId("fq");
    readonly handle: QueryHandle;
    private completeResolve!: (s: QueryCompleteSummary) => void;
    private backendIdResolve!: (s: string) => void;
    private cancelRequested = false;
    private terminalSent = false;
    private lost: string | undefined;
    private totalRows = 0;
    private resultSets = 0;
    private errors = 0;
    private startMs = Date.now();

    constructor(
        private readonly session: FakeSession,
        private readonly script: FakeScript | undefined,
        _opts: ExecuteOptions,
        private readonly sink: IQueryEventSink,
    ) {
        const completion = new Promise<QueryCompleteSummary>((resolve) => {
            this.completeResolve = resolve;
        });
        const backendQueryId = new Promise<string>((resolve) => {
            this.backendIdResolve = resolve;
        });
        this.handle = {
            clientQueryId: this.clientQueryId,
            backendQueryId,
            completion,
            cancel: async (): Promise<CancelAck> => {
                this.cancelRequested = true;
                return { acknowledged: true };
            },
            dispose: async (): Promise<void> => {
                this.cancelRequested = true;
                if (!this.terminalSent) {
                    await this.terminal("disposed");
                }
            },
        };
    }

    connectionLost(reason: string): void {
        this.lost = reason;
        void this.terminal("connectionLost");
    }

    async run(): Promise<void> {
        const backendId = nextId("fbq");
        this.backendIdResolve(backendId);
        if (!this.script) {
            await this.deliver(() =>
                this.sink.onMessage({
                    kind: "error",
                    text: `FakeBackend has no script for this text`,
                }),
            );
            this.errors++;
            await this.terminal("failed");
            return;
        }
        let sawTerminalEvent = false;
        let pageSeqByResultSet = new Map<string, number>();
        let currentResultSet: ResultSetMetadata | undefined;
        try {
            for (const event of this.script.events) {
                if (this.terminalSent) {
                    return;
                }
                if (this.cancelRequested && event.type !== "complete") {
                    await this.terminal("canceled");
                    return;
                }
                if (this.lost) {
                    return;
                }
                switch (event.type) {
                    case "accepted": {
                        if (event.delayMs) await sleep(event.delayMs);
                        await this.deliver(() =>
                            this.sink.onAccepted?.({
                                clientQueryId: this.clientQueryId,
                                backendQueryId: backendId,
                            }),
                        );
                        break;
                    }
                    case "resultSet": {
                        if (event.delayMs) await sleep(event.delayMs);
                        this.resultSets++;
                        const meta: ResultSetMetadata = {
                            resultSetId: nextId("frs"),
                            batchOrdinal: 0,
                            columns: event.columns.map((name, ordinal) => ({
                                ordinal,
                                name,
                                displayName: name,
                            })),
                            ...(event.isPlanResult ? { isPlanResult: true } : {}),
                        };
                        currentResultSet = meta;
                        pageSeqByResultSet.set(meta.resultSetId, 0);
                        await this.deliver(() => this.sink.onResultSetStarted(meta));
                        const pageSize = event.pageSize ?? Math.max(1, event.rows.length);
                        for (let offset = 0; offset < event.rows.length; offset += pageSize) {
                            if (event.pageDelayMs) await sleep(event.pageDelayMs);
                            if (this.cancelRequested) {
                                await this.deliver(() =>
                                    this.sink.onResultSetEnded?.({
                                        resultSetId: meta.resultSetId,
                                        rowCount: this.totalRows,
                                        truncatedReason: "cancelled",
                                    }),
                                );
                                await this.terminal("canceled");
                                return;
                            }
                            const slice = event.rows.slice(offset, offset + pageSize);
                            const pageSeq = pageSeqByResultSet.get(meta.resultSetId)!;
                            pageSeqByResultSet.set(meta.resultSetId, pageSeq + 1);
                            const page: RowsPage = {
                                resultSetId: meta.resultSetId,
                                pageSeq,
                                rowOffset: offset,
                                compact: toCompact(slice),
                                rowCount: slice.length,
                                approxBytes: JSON.stringify(slice).length,
                            };
                            this.totalRows += slice.length;
                            // Backpressure: await durable acceptance.
                            await this.deliver(() => this.sink.onRowsPage(page));
                        }
                        await this.deliver(() =>
                            this.sink.onResultSetEnded?.({
                                resultSetId: meta.resultSetId,
                                rowCount: event.rows.length,
                            }),
                        );
                        break;
                    }
                    case "message": {
                        if (event.kind === "error") this.errors++;
                        await this.deliver(() =>
                            this.sink.onMessage({
                                kind: event.kind,
                                text: event.text,
                                ...(event.line !== undefined ? { line: event.line } : {}),
                                ...(event.rowsAffected !== undefined
                                    ? { rowsAffected: event.rowsAffected }
                                    : {}),
                            }),
                        );
                        break;
                    }
                    case "plan": {
                        await this.deliver(() =>
                            this.sink.onPlan?.({
                                planId: nextId("fplan"),
                                format: "showplanXml",
                                xml: event.xml,
                            }),
                        );
                        break;
                    }
                    case "complete": {
                        if (event.delayMs) await sleep(event.delayMs);
                        sawTerminalEvent = true;
                        await this.terminal(event.status, event.rowsAffected);
                        break;
                    }
                    case "chaos:duplicatePage": {
                        if (currentResultSet) {
                            const dup: RowsPage = {
                                resultSetId: currentResultSet.resultSetId,
                                pageSeq: 0,
                                rowOffset: 0,
                                compact: { values: [["dup"]] },
                                rowCount: 1,
                                approxBytes: 8,
                            };
                            await this.deliver(() => this.sink.onRowsPage(dup));
                        }
                        break;
                    }
                    case "chaos:gapPage": {
                        if (currentResultSet) {
                            const gap: RowsPage = {
                                resultSetId: currentResultSet.resultSetId,
                                pageSeq: 99,
                                rowOffset: 424242,
                                compact: { values: [["gap"]] },
                                rowCount: 1,
                                approxBytes: 8,
                            };
                            await this.deliver(() => this.sink.onRowsPage(gap));
                        }
                        break;
                    }
                    case "chaos:rowsBeforeMetadata": {
                        const rogue: RowsPage = {
                            resultSetId: "never-announced",
                            pageSeq: 0,
                            rowOffset: 0,
                            compact: { values: [["rogue"]] },
                            rowCount: 1,
                            approxBytes: 8,
                        };
                        await this.deliver(() => this.sink.onRowsPage(rogue));
                        break;
                    }
                    case "chaos:eventAfterComplete": {
                        await this.terminal("succeeded");
                        await this.deliver(() =>
                            this.sink.onMessage({ kind: "info", text: "zombie message" }),
                        );
                        return;
                    }
                    case "chaos:noTerminal": {
                        return; // hang: consumers' deadline machinery must synthesize
                    }
                    case "chaos:fatal": {
                        this.session.fatal("chaos fatal");
                        return;
                    }
                }
            }
            if (!sawTerminalEvent && !this.terminalSent) {
                await this.terminal(this.errors > 0 ? "completedWithErrors" : "succeeded");
            }
        } catch (error) {
            // Sink threw: adapter contract — fail locally, stop calling sink.
            if (!this.terminalSent) {
                this.terminalSent = true;
                this.completeResolve({
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
            }
        }
    }

    private async terminal(status: QueryCompletionStatus, rowsAffected?: number): Promise<void> {
        if (this.terminalSent) {
            return;
        }
        this.terminalSent = true;
        const summary: QueryCompleteSummary = {
            clientQueryId: this.clientQueryId,
            status,
            resultSetCount: this.resultSets,
            totalRows: this.totalRows,
            errorCount: this.errors,
            durationMs: Date.now() - this.startMs,
            ...(rowsAffected !== undefined ? { rowsAffected } : {}),
        };
        try {
            await this.sink.onComplete(summary);
        } catch {
            // terminal delivery failure must not block completion settlement
        }
        this.completeResolve(summary);
    }

    /** Serialized sink delivery (one callback in flight per query). */
    private async deliver(fn: () => void | Promise<void> | undefined): Promise<void> {
        await fn();
    }
}

// --- service -----------------------------------------------------------------

export class FakeBackend implements ISqlConnectionService {
    availability: DataPlaneAvailability;
    private availabilityEmitter = new Emitter<DataPlaneAvailability>();
    readonly onDidChangeAvailability = this.availabilityEmitter.event;
    readonly backendInfo = { kind: "fake", displayName: "Fake backend" };
    readonly sessions: FakeSession[] = [];

    constructor(readonly options: FakeBackendOptions = {}) {
        this.availability = {
            state: "available",
            backend: "fake",
            capabilities: { ...FAKE_CAPABILITIES, ...options.capabilities },
        };
    }

    findScript(text: string): FakeScript | undefined {
        return this.options.scripts?.find((s) =>
            typeof s.match === "string" ? s.match === text : s.match(text),
        );
    }

    setUnavailable(reason: string): void {
        this.availability = { state: "unavailable", backend: "fake", reason, retryable: true };
        this.availabilityEmitter.fire(this.availability);
        for (const session of this.sessions) {
            session.fatal(reason);
        }
    }

    async canOpen(): Promise<{ ok: boolean; reason?: string }> {
        return this.availability.state === "available"
            ? { ok: true }
            : { ok: false, reason: "unavailable" };
    }

    async openSession(params: OpenSessionParams): Promise<ISqlSession> {
        if (this.options.openDelayMs) {
            await sleep(this.options.openDelayMs);
        }
        if (this.options.failOpen) {
            throw new SqlDataPlaneError(
                this.options.failOpen.code,
                this.options.failOpen.message,
                true,
            );
        }
        if (this.availability.state !== "available") {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.unavailable,
                "backend unavailable",
                true,
            );
        }
        const caps =
            this.availability.state === "available"
                ? this.availability.capabilities
                : FAKE_CAPABILITIES;
        const session = new FakeSession(this, params, caps);
        this.sessions.push(session);
        return session;
    }
}

export { CellValue };
