/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TsNativeSession (TSQ2 addendum §5.3-5.4): one ISqlSession owning one
 * physical driver connection. The connection event router lives here — one
 * observer installed at open, generation-stamped routing to the active query
 * engine, late events to diagnostics; `execute` while active throws Busy
 * synchronously; close/loss settle the active query exactly once.
 */

import {
    CloseOptions,
    DataPlaneErrorCodes,
    DataPlaneEvent,
    DatabaseContextChange,
    ExecuteOptions,
    IQueryEventSink,
    ISqlSession,
    QueryHandle,
    ServerMessage,
    SessionInfo,
    SessionState,
    SessionStateChange,
    SqlBackendCapabilities,
    SqlDataPlaneError,
} from "../sqlDataPlane/api";
import {
    EngineClock,
    EngineIds,
    ITdsConnection,
    TdsErrorCategory,
    TdsServerMessage,
} from "./driver/tdsDriver";
import {
    DEFAULT_SLICE_POLICY,
    EngineDeadlines,
    EngineObserver,
    EngineSlicePolicy,
    TsNativeQuery,
} from "./queryEngine";

// --- tiny local emitter (no vscode dependency) ------------------------------

class Emitter<T> {
    private listeners = new Set<(e: T) => void>();
    readonly event: DataPlaneEvent<T> = (listener) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    };
    fire(e: T): void {
        for (const listener of [...this.listeners]) {
            listener(e);
        }
    }
    clear(): void {
        this.listeners.clear();
    }
}

export interface TsNativeSessionDeps {
    clock: EngineClock;
    ids: EngineIds;
    deadlines: EngineDeadlines & { closeMs: number };
    slice?: EngineSlicePolicy;
    observer?: EngineObserver;
    lossyPreview?: boolean;
    /** Called when the session leaves the live pool (closed or lost). */
    onFinalized?: (sessionId: string) => void;
}

export class TsNativeSession implements ISqlSession {
    readonly sessionId: string;
    readonly connectionId: string;
    readonly info: SessionInfo;
    readonly capabilities: SqlBackendCapabilities;
    state: SessionState = "open";

    private readonly stateEmitter = new Emitter<SessionStateChange>();
    private readonly databaseEmitter = new Emitter<DatabaseContextChange>();
    private readonly infoMessageEmitter = new Emitter<ServerMessage>();
    readonly onDidChangeState = this.stateEmitter.event;
    readonly onDidChangeDatabase = this.databaseEmitter.event;
    readonly onServerInfoMessage = this.infoMessageEmitter.event;

    private activeQuery: TsNativeQuery | undefined;
    private finalized = false;

    constructor(
        private readonly connection: ITdsConnection,
        info: SessionInfo,
        capabilities: SqlBackendCapabilities,
        private readonly deps: TsNativeSessionDeps,
    ) {
        this.sessionId = deps.ids.next("tns");
        this.connectionId = connection.id;
        this.info = info;
        this.capabilities = capabilities;
    }

    // --- connection event router hooks (installed by the backend at open) ---

    /** Socket/fatal loss: settle the active query once, transition, finalize. */
    handleConnectionLost(reason: TdsErrorCategory): void {
        if (this.state === "closed" || this.state === "lost") {
            return;
        }
        this.transition("lost", `connection lost (${reason})`);
        this.activeQuery?.markLost(`connection lost (${reason})`);
        this.activeQuery = undefined;
        this.finalize();
    }

    handleDatabaseChanged(database: string): void {
        this.info.database = database;
        this.databaseEmitter.fire({ database, source: "backend" });
    }

    handleOrphanMessage(message: TdsServerMessage): void {
        this.infoMessageEmitter.fire({
            kind: message.isError ? "error" : "info",
            text: message.message,
            number: message.number,
            severity: message.severity,
        });
    }

    // --- ISqlSession ---------------------------------------------------------

    signalDatabaseChanged(database: string, source: DatabaseContextChange["source"]): void {
        this.info.database = database;
        this.databaseEmitter.fire({ database, source });
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
                "a query is already active on this session",
                true,
            );
        }
        const query = new TsNativeQuery(
            (observer) =>
                this.connection.execute({ batchText: text }, observer, {
                    operationId: this.deps.ids.next("op"),
                }),
            text,
            opts,
            sink,
            {
                clock: this.deps.clock,
                ids: this.deps.ids,
                deadlines: this.deps.deadlines,
                slice: this.deps.slice ?? DEFAULT_SLICE_POLICY,
                ...(this.deps.observer ? { observer: this.deps.observer } : {}),
                ...(this.deps.lossyPreview !== undefined
                    ? { lossyPreview: this.deps.lossyPreview }
                    : {}),
                forceAbort: (reason) => this.connection.destroy(reason),
                onDatabaseChanged: (database) => this.handleDatabaseChanged(database),
                onTerminal: () => {
                    if (this.activeQuery === query) {
                        this.activeQuery = undefined;
                    }
                },
            },
        );
        this.activeQuery = query;
        return query.handle;
    }

    async close(opts?: CloseOptions): Promise<void> {
        if (this.state === "closed" || this.state === "closing") {
            return;
        }
        this.transition("closing", opts?.reason ?? "close requested");
        const active = this.activeQuery;
        if (active) {
            // Shared conformance rule: an active query on session close
            // settles as connectionLost (synthesized) unless already terminal.
            await active.cancel("sessionClose").catch(() => undefined);
            active.markLost("session closed");
            this.activeQuery = undefined;
        }
        const timeoutMs = opts?.timeoutMs ?? this.deps.deadlines.closeMs;
        await Promise.race([
            this.connection.close({ operationId: this.deps.ids.next("op") }).catch(() => undefined),
            new Promise<void>((resolve) =>
                this.deps.clock.setTimeout(() => {
                    this.connection.destroy("close deadline expired");
                    resolve();
                }, timeoutMs),
            ),
        ]);
        this.transition("closed", "closed");
        this.finalize();
    }

    dispose(): void {
        void this.close({ reason: "dispose" });
    }

    /** Diagnostic snapshot for status/support surfaces. */
    snapshot(): Record<string, unknown> {
        return {
            sessionId: this.sessionId,
            connectionId: this.connectionId,
            state: this.state,
            database: this.info.database,
            spid: this.info.spid,
            activeQuery: this.activeQuery?.snapshot(),
        };
    }

    private transition(next: SessionState, reason: string): void {
        const previous = this.state;
        this.state = next;
        this.stateEmitter.fire({ previous, current: next, reason });
    }

    private finalize(): void {
        if (this.finalized) {
            return;
        }
        this.finalized = true;
        this.deps.onFinalized?.(this.sessionId);
        this.stateEmitter.clear();
        this.databaseEmitter.clear();
        this.infoMessageEmitter.clear();
    }
}
