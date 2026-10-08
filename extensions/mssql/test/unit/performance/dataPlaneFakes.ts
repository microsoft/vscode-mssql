/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CancelAck,
    DataPlaneAvailability,
    DataPlaneEvent,
    ExecuteOptions,
    IQueryEventSink,
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
    QueryAcceptance,
    QueryCompleteSummary,
    QueryCompletionStatus,
    QueryHandle,
    ServerMessage,
    SessionState,
    SessionStateChange,
    SqlBackendCapabilities,
    SqlDataPlaneErrorInfo,
} from "../../../src/services/sqlDataPlane/api";
import {
    PreparedConnection,
    prepareConnection,
} from "../../../src/services/metadata/profileAuthAdapter";
import { PerformanceDataPlaneHost } from "../../../src/performance/performanceSessionPool";

export interface ScriptedResultSet {
    readonly columns: readonly string[];
    /** Compact page values, as the data plane delivers them. */
    readonly values: unknown[][];
    readonly typeHints?: string[];
    readonly nullBitmap?: string;
    readonly truncatedReason?: string;
}

/** How a fake query answers. */
export interface QueryScript {
    readonly resultSets?: readonly ScriptedResultSet[];
    readonly messages?: readonly ServerMessage[];
    readonly status?: QueryCompletionStatus;
    readonly error?: SqlDataPlaneErrorInfo;
    /** The query runs until `complete` or a honored cancel. */
    readonly hang?: boolean;
    /** False when cancel does not stop a hanging query. */
    readonly honorsCancel?: boolean;
}

export type QueryResponder = (text: string, options: ExecuteOptions) => QueryScript;

class Emitter<T> {
    private readonly _listeners = new Set<(event: T) => void>();
    readonly event: DataPlaneEvent<T> = (listener) => {
        this._listeners.add(listener);
        return { dispose: () => this._listeners.delete(listener) };
    };
    fire(event: T): void {
        for (const listener of [...this._listeners]) {
            listener(event);
        }
    }
}

let nextId = 0;

export class FakeQuery implements QueryHandle {
    readonly clientQueryId = `q${++nextId}`;
    readonly accepted: Promise<QueryAcceptance>;
    readonly completion: Promise<QueryCompleteSummary>;
    cancelCount = 0;
    disposeCount = 0;
    private _resolve!: (summary: QueryCompleteSummary) => void;
    private _done = false;

    constructor(
        readonly text: string,
        readonly options: ExecuteOptions,
        private readonly _sink: IQueryEventSink,
        private readonly _script: QueryScript,
        private readonly _onDone: () => void,
    ) {
        this.accepted = Promise.resolve({
            status: "accepted",
            clientQueryId: this.clientQueryId,
            acceptedEpochMs: 0,
        });
        this.completion = new Promise((resolve) => {
            this._resolve = resolve;
        });
        if (!_script.hang) {
            void Promise.resolve().then(() => this.complete());
        }
    }

    get done(): boolean {
        return this._done;
    }

    async cancel(): Promise<CancelAck> {
        this.cancelCount++;
        if (this._script.honorsCancel !== false) {
            await this.complete({ status: "canceled" });
        }
        return { acknowledged: true };
    }

    async dispose(): Promise<void> {
        this.disposeCount++;
    }

    /** Delivers the scripted events, then settles the completion. */
    async complete(overrides: Partial<QueryScript> = {}): Promise<void> {
        if (this._done) {
            return;
        }
        this._done = true;
        const script = { ...this._script, ...overrides };
        const resultSets = overrides.status === "canceled" ? [] : (script.resultSets ?? []);
        let index = 0;
        for (const resultSet of resultSets) {
            const resultSetId = `rs${index++}`;
            await this._sink.onResultSetStarted({
                resultSetId,
                batchOrdinal: 0,
                columns: resultSet.columns.map((name, ordinal) => ({
                    ordinal,
                    name,
                    displayName: name,
                })),
            });
            await this._sink.onRowsPage({
                resultSetId,
                pageSeq: 0,
                rowOffset: 0,
                compact: {
                    values: resultSet.values,
                    ...(resultSet.typeHints ? { typeHints: resultSet.typeHints } : {}),
                    ...(resultSet.nullBitmap ? { nullBitmap: resultSet.nullBitmap } : {}),
                },
                rowCount: resultSet.values.length,
                approxBytes: 0,
            });
            await this._sink.onResultSetEnded?.({
                resultSetId,
                rowCount: resultSet.values.length,
                ...(resultSet.truncatedReason
                    ? { truncatedReason: resultSet.truncatedReason }
                    : {}),
            });
        }
        for (const message of overrides.status === "canceled" ? [] : (script.messages ?? [])) {
            await this._sink.onMessage(message);
        }
        const summary: QueryCompleteSummary = {
            clientQueryId: this.clientQueryId,
            status: script.status ?? "succeeded",
            resultSetCount: resultSets.length,
            totalRows: 0,
            errorCount: (script.messages ?? []).filter((m) => m.kind === "error").length,
            ...(script.error ? { error: script.error } : {}),
        };
        await this._sink.onComplete(summary);
        this._onDone();
        this._resolve(summary);
    }
}

export class FakeSession implements ISqlSession {
    readonly sessionId = `s${++nextId}`;
    readonly connectionId = this.sessionId;
    readonly info = { backendKind: "fake" };
    readonly capabilities = {} as SqlBackendCapabilities;
    state: SessionState = "open";
    readonly queries: FakeQuery[] = [];
    disposeCount = 0;
    /** Most queries that ran at the same time. */
    maxActive = 0;
    private _active = 0;
    private readonly _stateChanges = new Emitter<SessionStateChange>();

    readonly onDidChangeState = this._stateChanges.event;
    readonly onDidChangeDatabase: DataPlaneEvent<never> = () => ({ dispose: () => undefined });
    readonly onServerInfoMessage: DataPlaneEvent<ServerMessage> = () => ({
        dispose: () => undefined,
    });

    constructor(
        readonly params: OpenSessionParams,
        private readonly _respond: QueryResponder,
    ) {}

    signalDatabaseChanged(): void {}

    execute(text: string, options: ExecuteOptions, sink: IQueryEventSink): QueryHandle {
        if (this.state !== "open") {
            throw new Error(`session is ${this.state}`);
        }
        if (this._active > 0) {
            throw new Error("one active query per session");
        }
        this._active++;
        this.maxActive = Math.max(this.maxActive, this._active);
        const query = new FakeQuery(text, options, sink, this._respond(text, options), () => {
            this._active--;
        });
        this.queries.push(query);
        return query;
    }

    setState(next: SessionState): void {
        const previous = this.state;
        this.state = next;
        this._stateChanges.fire({ previous, current: next });
    }

    async close(): Promise<void> {
        this.setState("closed");
    }

    dispose(): void {
        this.disposeCount++;
        this.setState("closed");
    }
}

/** A data plane service that opens fake sessions. */
export class FakeConnectionService implements ISqlConnectionService {
    availability: DataPlaneAvailability = {
        state: "available",
        backend: "fake",
        capabilities: {} as SqlBackendCapabilities,
    };
    readonly onDidChangeAvailability: DataPlaneEvent<DataPlaneAvailability> = () => ({
        dispose: () => undefined,
    });
    readonly sessions: FakeSession[] = [];
    readonly openParams: OpenSessionParams[] = [];
    /** When set, the next opens fail with this error. */
    openError: unknown;

    constructor(public respond: QueryResponder = () => ({})) {}

    async openSession(params: OpenSessionParams): Promise<ISqlSession> {
        this.openParams.push(params);
        if (this.openError) {
            throw this.openError;
        }
        const session = new FakeSession(params, (text, options) => this.respond(text, options));
        this.sessions.push(session);
        return session;
    }

    async canOpen() {
        return { ok: true };
    }

    get lastSession(): FakeSession {
        return this.sessions[this.sessions.length - 1];
    }
}

export function fakeHost(
    service: ISqlConnectionService,
    overrides: Partial<PerformanceDataPlaneHost> = {},
): PerformanceDataPlaneHost {
    return {
        isEnabled: () => true,
        wasEnabledAtActivation: () => true,
        serviceForProfile: async () => service,
        ...overrides,
    };
}

export function testConnection(server = "perf-server", user = "perf-user"): PreparedConnection {
    return prepareConnection(
        { server, user, authenticationType: "SqlLogin", database: "AppDb" },
        { lookupPassword: async () => "secret" },
    );
}

/** Lets pending promise callbacks run. */
export async function flushPromises(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}
