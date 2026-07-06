/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DocumentSessionBinding (M1): the shared per-document data-plane session —
 * profile selection, open/close/lost, connect markers, SPID probe.
 *
 * Profile selection (M1): a quick pick over saved connection profiles read
 * through the product's connection store (passwords resolved from the
 * credential store at open time only — the same seam the self-test uses).
 * The full selectConnectionProfile() factoring of the classic connection UI
 * is a recorded M3/B4 item; this deviation is noted in the build journal.
 *
 * No v1 execution fallback exists here — connect failures surface honestly
 * with Retry / Open-in-classic guidance (doc 04 §4.3).
 */

import * as vscode from "vscode";
import { Perf } from "../perf/perfTelemetry";
import {
    IQueryEventSink,
    ISqlSession,
    SqlConnectionProfileRef,
} from "../services/sqlDataPlane/api";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import {
    DataPlaneMetadataSessionSource,
    MetadataService,
    MetadataStatus,
} from "../services/metadata/metadataService";
import {
    buildAuthBundle,
    buildProfileRef,
    resolveAuthKind,
} from "../services/metadata/profileAuthAdapter";
import { QsConnectionState } from "../sharedInterfaces/queryStudio";
import { buildSessionOptionsBatch, readQuerySessionOptions } from "./sessionOptions";

interface StoredProfile {
    server?: string;
    database?: string;
    user?: string;
    authenticationType?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
    profileName?: string;
    savePassword?: boolean;
}

interface ConnectionStoreSeam {
    readAllConnections(includeRecent?: boolean): Promise<StoredProfile[]>;
    lookupPassword(credentials: unknown, isConnectionString?: boolean): Promise<string>;
}

async function connectionStore(): Promise<ConnectionStoreSeam | undefined> {
    const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
        | { connectionManager?: { connectionStore?: ConnectionStoreSeam } }
        | undefined;
    return controller?.connectionManager?.connectionStore;
}

export class DocumentSessionBinding implements vscode.Disposable {
    private session: ISqlSession | undefined;
    private stateKind: QsConnectionState["kind"] = "disconnected";
    private lostReason: string | undefined;
    private spid: number | undefined;
    private openTransactions: number | undefined;
    private lastProfileRef: SqlConnectionProfileRef | undefined;
    private lastStore: ConnectionStoreSeam | undefined;
    private lastAuthKind: "sql" | "integrated" | undefined;
    private onChangeHandlers = new Set<() => void>();
    private metadataService: MetadataService | undefined;
    private metadataHandle: ReturnType<MetadataService["acquire"]> | undefined;
    metadataStatus: MetadataStatus | undefined;

    onDidChange(handler: () => void): vscode.Disposable {
        this.onChangeHandlers.add(handler);
        return { dispose: () => this.onChangeHandlers.delete(handler) };
    }

    private fireChange(): void {
        for (const handler of [...this.onChangeHandlers]) {
            handler();
        }
    }

    get connectionState(): QsConnectionState {
        const info = this.session?.info;
        return {
            kind: this.stateKind,
            ...(info?.serverDisplayName ? { serverDisplayName: info.serverDisplayName } : {}),
            ...(info?.serverVersion ? { serverVersion: info.serverVersion } : {}),
            ...(info?.loginName ? { loginName: info.loginName } : {}),
            ...(this.spid !== undefined ? { spid: this.spid } : {}),
            ...(info?.database ? { database: info.database } : {}),
            ...(info?.encrypted !== undefined ? { encrypted: info.encrypted } : {}),
            ...(this.openTransactions !== undefined && this.openTransactions > 0
                ? { openTransactions: this.openTransactions }
                : {}),
            backend: info?.backendKind ?? "sts2-jsonrpc",
            ...(this.lostReason ? { lostReason: this.lostReason } : {}),
        };
    }

    get activeSession(): ISqlSession | undefined {
        return this.stateKind === "connected" || this.stateKind === "executing"
            ? this.session
            : undefined;
    }

    /**
     * The stored profile of the current connection, for the language-service
     * shadow STS v1 connection (design 05 §9.3). Credentials are NOT included
     * — the consumer resolves passwords through the connection store exactly
     * like the data-plane path does.
     */
    get shadowConnectionProfile(): Record<string, unknown> | undefined {
        return this.stateKind === "connected" || this.stateKind === "executing"
            ? (this.lastStoredProfile as Record<string, unknown> | undefined)
            : undefined;
    }

    setExecuting(executing: boolean): void {
        if (this.stateKind === "connected" && executing) {
            this.stateKind = "executing";
            this.fireChange();
        } else if (this.stateKind === "executing" && !executing) {
            this.stateKind = "connected";
            this.fireChange();
        }
    }

    /** Connect flow (doc 04 §11.2). Returns false on cancel/failure. */
    async connect(): Promise<boolean> {
        const dataPlane = SqlDataPlaneService.get();
        if (!dataPlane.enabled) {
            void vscode.window.showErrorMessage(
                "The SQL data plane is disabled. Enable mssql.sqlDataPlane.enabled (and reload) to use Query Studio connections.",
            );
            return false;
        }
        const store = await connectionStore();
        if (!store) {
            void vscode.window.showErrorMessage("Connection store unavailable.");
            return false;
        }
        const profiles = (await store.readAllConnections(false)).filter((p) => p.server);
        if (profiles.length === 0) {
            void vscode.window.showInformationMessage(
                "No saved connection profiles. Create one with 'MS SQL: Add Connection' first.",
            );
            return false;
        }
        if (Perf.enabled && profiles.length === 1) {
            // PERF_MODE harness seam: a quick-pick would hang a headless
            // scenario; exactly-one saved profile auto-selects. Outside perf
            // mode behavior is unchanged.
            return this.open(profiles[0], store);
        }
        const picked = await vscode.window.showQuickPick(
            profiles.map((profile) => ({
                label: profile.profileName || `${profile.server}`,
                description: `${profile.server}${profile.database ? ` · ${profile.database}` : ""}${profile.user ? ` · ${profile.user}` : " · integrated"}`,
                profile,
            })),
            { title: "Query Studio: connect with saved profile" },
        );
        if (!picked) {
            return false;
        }
        return this.open(picked.profile, store);
    }

    private lastStoredProfile: StoredProfile | undefined;

    private async open(stored: StoredProfile, store: ConnectionStoreSeam): Promise<boolean> {
        this.lastStoredProfile = stored;
        this.stateKind = "connecting";
        this.lostReason = undefined;
        this.fireChange();
        Perf.marker("mssql.queryStudio.connect.begin", "begin");
        // Shared profile-preparation seam (MetadataStore MD-0): fingerprint
        // recipe is now hash-based (non-reversible, per the profileRef
        // contract) — in-memory keys only, so no persisted state shifts.
        const authKind = resolveAuthKind(stored);
        const profileRef: SqlConnectionProfileRef = buildProfileRef(stored);
        this.lastProfileRef = profileRef;
        this.lastStore = store;
        this.lastAuthKind = authKind;
        try {
            const service = await SqlDataPlaneService.get().service();
            const session = await service.openSession({
                profile: profileRef,
                applicationName: "vscode-mssql-querystudio",
                // Password exists only inside the provider closure.
                auth: buildAuthBundle(stored, store),
            });
            this.session = session;
            session.onDidChangeState((change) => {
                if (change.current === "lost") {
                    this.stateKind = "lost";
                    this.lostReason = change.reason;
                    this.fireChange();
                } else if (change.current === "closed" && this.stateKind !== "lost") {
                    this.stateKind = "disconnected";
                    this.fireChange();
                }
            });
            session.onDidChangeDatabase((change) => {
                // USE (typed or dropdown) moved the session to a different
                // database: the metadata catalog is keyed by database, so
                // re-acquire against the new one (fresh dedicated session).
                this.reacquireMetadataForDatabase(change.database);
                this.fireChange();
            });
            this.stateKind = "connected";
            Perf.marker("mssql.queryStudio.connect.ready", "end", {
                backend: session.info.backendKind,
                authKind,
                encrypted: session.info.encrypted === true,
                metadataSession: false,
            });
            this.fireChange();
            // Session options (SSMS parity): apply the mssql.query.* SET
            // batch FIRST — the session serializes queries, so anything the
            // user runs right after connect queues behind the configured
            // state. Reconnect flows re-enter open(), reapplying naturally.
            void this.applySessionOptions(session);
            // Metadata catalog (design §8.2): dedicated session over the
            // same profile; hydration never contends with the user's F5.
            this.acquireMetadata(profileRef, store, authKind);
            // SPID probe only because the open result lacks it (worksheet #5).
            void this.probeSpid(session);
            return true;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            Perf.marker("mssql.queryStudio.connect.ready", "end", {
                error: true,
                reason: reason.slice(0, 120),
            });
            this.stateKind = "disconnected";
            this.fireChange();
            const action = await vscode.window.showErrorMessage(
                `Query Studio could not connect: ${reason}`,
                "Retry",
                "Open in classic editor",
            );
            if (action === "Retry") {
                return this.open(stored, store);
            }
            if (action === "Open in classic editor") {
                void vscode.commands.executeCommand("mssql.queryStudio.openInClassicEditor");
            }
            return false;
        }
    }

    /**
     * Apply the mssql.query.* options as one SET batch on the user session
     * (SSMS parity — SET state is per-connection). Failures surface as a
     * status change only; the connection stays usable.
     */
    private async applySessionOptions(session: ISqlSession): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration();
            const batch = buildSessionOptionsBatch(
                readQuerySessionOptions((key, fallback) => config.get(key, fallback)),
            );
            const sink: IQueryEventSink = {
                onResultSetStarted: () => undefined,
                onRowsPage: () => undefined,
                onMessage: () => undefined,
                onComplete: () => undefined,
            };
            const handle = session.execute(
                batch,
                {
                    priority: "background",
                    commandKind: "metadata",
                    tag: "queryStudio:sessionOptions",
                },
                sink,
            );
            await handle.completion;
        } catch {
            // Options are best-effort; server defaults apply.
        }
    }

    /** Re-key the metadata catalog when the session's database changes. */
    private reacquireMetadataForDatabase(database: string): void {
        if (
            this.lastProfileRef === undefined ||
            this.lastStore === undefined ||
            this.lastAuthKind === undefined
        ) {
            return;
        }
        this.releaseMetadata();
        this.acquireMetadata(
            { ...this.lastProfileRef, database },
            this.lastStore,
            this.lastAuthKind,
        );
    }

    /**
     * Open-transaction probe (SSMS parity): after each run, ask the SAME
     * session for @@TRANCOUNT so a BEGIN TRAN left open across executions is
     * visible in the status bar and guarded at disconnect. Best-effort.
     */
    async probeTransactionState(): Promise<void> {
        const session = this.activeSession;
        if (session === undefined) {
            return;
        }
        try {
            let value: number | undefined;
            const sink: IQueryEventSink = {
                onResultSetStarted: () => undefined,
                onRowsPage: (page) => {
                    const cell = page.compact.values[0]?.[0];
                    value = typeof cell === "number" ? cell : Number(cell);
                },
                onMessage: () => undefined,
                onComplete: () => undefined,
            };
            const handle = session.execute(
                "SELECT @@TRANCOUNT;",
                {
                    priority: "background",
                    commandKind: "metadata",
                    tag: "queryStudio:tranProbe",
                },
                sink,
            );
            await handle.completion;
            const count = Number.isFinite(value) ? Number(value) : undefined;
            if (count !== undefined && count !== this.openTransactions) {
                this.openTransactions = count;
                this.fireChange();
            }
        } catch {
            // Best-effort; the indicator simply stays at its last value.
        }
    }

    private async probeSpid(session: ISqlSession): Promise<void> {
        try {
            let value: number | undefined;
            const sink: IQueryEventSink = {
                onResultSetStarted: () => undefined,
                onRowsPage: (page) => {
                    const cell = page.compact.values[0]?.[0];
                    value = typeof cell === "number" ? cell : Number(cell);
                },
                onMessage: () => undefined,
                onComplete: () => undefined,
            };
            const handle = session.execute(
                "SELECT @@SPID;",
                {
                    priority: "background",
                    commandKind: "metadata",
                    tag: "queryStudio:spidProbe",
                },
                sink,
            );
            // Await the HANDLE completion — the session frees its active
            // slot in completion reaction order; resolving on the sink
            // callback would race the user's first execute into Busy.
            await handle.completion;
            const spid = Number.isFinite(value) ? value : undefined;
            if (spid !== undefined) {
                this.spid = spid;
                this.fireChange();
            }
        } catch {
            // Probe is best-effort; SPID stays blank.
        }
    }

    async disconnect(): Promise<boolean> {
        if (!this.session) {
            return false;
        }
        // Transaction guard (SSMS parity): closing the connection rolls back
        // any open transaction server-side — make that explicit and stoppable.
        if ((this.openTransactions ?? 0) > 0) {
            const disconnectAnyway = "Disconnect (roll back)";
            const choice = await vscode.window.showWarningMessage(
                `This session has ${this.openTransactions} open transaction(s). Disconnecting will roll them back.`,
                { modal: true },
                disconnectAnyway,
            );
            if (choice !== disconnectAnyway) {
                return false;
            }
        }
        this.releaseMetadata();
        this.stateKind = "disconnecting";
        this.fireChange();
        await this.session.close().catch(() => undefined);
        this.session = undefined;
        this.spid = undefined;
        this.openTransactions = undefined;
        this.stateKind = "disconnected";
        this.fireChange();
        return true;
    }

    private acquireMetadata(
        profileRef: SqlConnectionProfileRef,
        store: ConnectionStoreSeam,
        authKind: "sql" | "integrated",
    ): void {
        void (async () => {
            try {
                const service = await SqlDataPlaneService.get().service();
                const source = new DataPlaneMetadataSessionSource(service, {
                    profile: profileRef,
                    applicationName: "vscode-mssql-metadata",
                    auth: {
                        passwordProvider: async () =>
                            authKind === "sql"
                                ? store.lookupPassword(this.lastStoredProfile ?? {})
                                : undefined,
                    },
                });
                this.metadataService = new MetadataService(source);
                this.metadataHandle = this.metadataService.acquire(
                    {
                        serverFingerprint: profileRef.profileFingerprint,
                        database: this.connectionState.database ?? "",
                    },
                    (status) => {
                        this.metadataStatus = status;
                        this.fireChange();
                    },
                );
            } catch {
                // Metadata is an enhancement; connect stays healthy without it.
            }
        })();
    }

    /** DDL sniff feed (metadata design §9.1). */
    notifyExecutedBatch(text: string, succeeded: boolean): void {
        this.metadataHandle?.notifyExecutedBatch({ text, succeeded });
    }

    get metadataHandleForConsumers(): ReturnType<MetadataService["acquire"]> | undefined {
        return this.metadataHandle;
    }

    private releaseMetadata(): void {
        this.metadataHandle?.dispose();
        this.metadataHandle = undefined;
        this.metadataService?.dispose();
        this.metadataService = undefined;
        this.metadataStatus = undefined;
    }

    dispose(): void {
        this.releaseMetadata();
        void this.session?.close().catch(() => undefined);
        this.onChangeHandlers.clear();
    }
}
