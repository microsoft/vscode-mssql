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
import { QsConnectionState } from "../sharedInterfaces/queryStudio";

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
    private onChangeHandlers = new Set<() => void>();

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
            backend: info?.backendKind ?? "sts2-jsonrpc",
            ...(this.lostReason ? { lostReason: this.lostReason } : {}),
        };
    }

    get activeSession(): ISqlSession | undefined {
        return this.stateKind === "connected" || this.stateKind === "executing"
            ? this.session
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

    private async open(stored: StoredProfile, store: ConnectionStoreSeam): Promise<boolean> {
        this.stateKind = "connecting";
        this.lostReason = undefined;
        this.fireChange();
        Perf.marker("mssql.queryStudio.connect.begin", "begin");
        const authKind = (stored.authenticationType ?? "").toLowerCase().includes("integrated")
            ? ("integrated" as const)
            : ("sql" as const);
        const profileRef: SqlConnectionProfileRef = {
            profileFingerprint: `qsfp_${Buffer.from(`${stored.server}|${stored.database}|${stored.user}|${authKind}`).toString("base64url").slice(0, 24)}`,
            server: stored.server!,
            ...(stored.database ? { database: stored.database } : {}),
            authKind,
            ...(stored.user ? { user: stored.user } : {}),
            ...(stored.encrypt !== undefined ? { encrypt: stored.encrypt } : {}),
            ...(stored.trustServerCertificate !== undefined
                ? { trustServerCertificate: stored.trustServerCertificate }
                : {}),
        };
        try {
            const service = await SqlDataPlaneService.get().service();
            const session = await service.openSession({
                profile: profileRef,
                applicationName: "vscode-mssql-querystudio",
                auth: {
                    // Password exists only inside this provider call chain.
                    passwordProvider: async () =>
                        authKind === "sql" ? store.lookupPassword(stored) : undefined,
                },
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
            session.onDidChangeDatabase(() => this.fireChange());
            this.stateKind = "connected";
            Perf.marker("mssql.queryStudio.connect.ready", "end", {
                backend: session.info.backendKind,
                authKind,
                encrypted: session.info.encrypted === true,
                metadataSession: false,
            });
            this.fireChange();
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

    private async probeSpid(session: ISqlSession): Promise<void> {
        try {
            const spid = await new Promise<number | undefined>((resolve) => {
                let value: number | undefined;
                const sink: IQueryEventSink = {
                    onResultSetStarted: () => undefined,
                    onRowsPage: (page) => {
                        const cell = page.compact.values[0]?.[0];
                        value = typeof cell === "number" ? cell : Number(cell);
                    },
                    onMessage: () => undefined,
                    onComplete: () => resolve(Number.isFinite(value) ? value : undefined),
                };
                session.execute(
                    "SELECT @@SPID;",
                    {
                        priority: "background",
                        commandKind: "metadata",
                        tag: "queryStudio:spidProbe",
                    },
                    sink,
                );
            });
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
        this.stateKind = "disconnecting";
        this.fireChange();
        await this.session.close().catch(() => undefined);
        this.session = undefined;
        this.spid = undefined;
        this.stateKind = "disconnected";
        this.fireChange();
        return true;
    }

    dispose(): void {
        void this.session?.close().catch(() => undefined);
        this.onChangeHandlers.clear();
    }
}
