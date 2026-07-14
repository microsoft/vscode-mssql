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
import { diagnosticErrorClass } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import {
    IQueryEventSink,
    ISqlSession,
    SqlConnectionProfileRef,
} from "../services/sqlDataPlane/api";
import { SqlBackendKind } from "../services/sqlDataPlane/backendFactory";
import {
    CAPABILITY_FALLBACK_SETTING,
    CapabilityFallbackPolicy,
    resolveCapabilityFallback,
} from "../services/sqlDataPlane/providerSuggestions";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import { MetadataStatus, runMetadataQuery } from "../services/metadata/metadataService";
import { DatabaseCatalogLease } from "../services/metadata/metadataStore";
import { MetadataStoreService } from "../services/metadata/metadataStoreService";
import {
    buildProfileRef,
    prepareConnection,
    PreparedConnection,
    ResolvedAuthKind,
    stableProfileId,
} from "../services/metadata/profileAuthAdapter";
import { vscodeSqlTokenSource } from "../services/sqlDataPlane/vscodeSqlTokenSource";
import { QsConnectionState } from "../sharedInterfaces/queryStudio";
import { accentTextColor } from "../sharedInterfaces/colorContrast";
import { buildSessionOptionsBatch, readQuerySessionOptions } from "./sessionOptions";

interface StoredProfile {
    id?: string;
    server?: string;
    database?: string;
    user?: string;
    email?: string;
    accountId?: string;
    tenantId?: string;
    authenticationType?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
    profileName?: string;
    savePassword?: boolean;
}

interface ConnectionStoreSeam {
    readAllConnections(includeRecent?: boolean): Promise<StoredProfile[]>;
    /** Production safety: group color + the settings-JSON-only production flag. */
    readAllConnectionGroups?(): Promise<
        { id?: string; name?: string; color?: string; production?: boolean }[]
    >;
    lookupPassword(credentials: unknown, isConnectionString?: boolean): Promise<string>;
}

async function connectionStore(): Promise<ConnectionStoreSeam | undefined> {
    const controller = (await vscode.commands.executeCommand("mssql.getControllerForTests")) as
        | { connectionManager?: { connectionStore?: ConnectionStoreSeam } }
        | undefined;
    return controller?.connectionManager?.connectionStore;
}

/** Auxiliary-session purposes (VEC-7) — each maps to a distinct application
 *  name so sys.dm_exec_sessions shows WHY the extra session exists. */
export type AuxiliarySessionPurpose = "vectorDiagnostics" | "vectorModelCall";

export interface AuxiliarySessionLease {
    readonly session: ISqlSession;
    dispose(): void;
}

/** Hard cap on concurrently open auxiliary sessions per binding. */
const MAX_AUX_SESSIONS = 2;

const AUX_APPLICATION_NAMES: Record<AuxiliarySessionPurpose, string> = {
    vectorDiagnostics: "vscode-mssql-querystudio-vectordiag",
    vectorModelCall: "vscode-mssql-querystudio-vectormodel",
};

export class DocumentSessionBinding implements vscode.Disposable {
    private session: ISqlSession | undefined;
    private stateKind: QsConnectionState["kind"] = "disconnected";
    private lostReason: string | undefined;
    private spid: number | undefined;
    private openTransactions: number | undefined;
    private lastProfileRef: SqlConnectionProfileRef | undefined;
    private lastPrepared: PreparedConnection | undefined;
    private lastStore: ConnectionStoreSeam | undefined;
    private lastAuthKind: ResolvedAuthKind | undefined;
    /** Production safety: the connected profile's group facts (color + flag). */
    private groupAccent: { color?: string; production: boolean } | undefined;
    private onChangeHandlers = new Set<() => void>();
    private metadataLease: DatabaseCatalogLease | undefined;
    private userSessionReady: Promise<void> = Promise.resolve();
    /** Open auxiliary sessions (VEC-7) — capped, closed with the binding. */
    private auxSessions = new Set<ISqlSession>();
    metadataStatus: MetadataStatus | undefined;

    onDidChange(handler: () => void): vscode.Disposable {
        this.onChangeHandlers.add(handler);
        return { dispose: () => this.onChangeHandlers.delete(handler) };
    }

    private async resolveGroupAccent(
        stored: StoredProfile,
        store: ConnectionStoreSeam,
    ): Promise<void> {
        try {
            const groupId = (stored as { groupId?: string }).groupId;
            if (!groupId || !store.readAllConnectionGroups) {
                return;
            }
            const groups = await store.readAllConnectionGroups();
            const group = groups.find((candidate) => candidate.id === groupId);
            if (!group) {
                return;
            }
            const production = group.production === true;
            if (group.color !== undefined || production) {
                this.groupAccent = {
                    ...(group.color !== undefined ? { color: group.color } : {}),
                    production,
                };
                this.fireChange();
            }
        } catch {
            // Accent/guard facts are best-effort; absence means "off".
        }
    }

    /**
     * Stable id of the profile this document last connected with (save-as
     * continuity: the adopted document reconnects to the same profile).
     */
    get currentProfileId(): string | undefined {
        return this.lastProfileRef ? stableProfileId(this.lastProfileRef) : undefined;
    }

    private fireChange(): void {
        for (const handler of [...this.onChangeHandlers]) {
            handler();
        }
    }

    /**
     * Production-safety guard fact: warn setting on AND the connected
     * profile's group carries `"production": true` (settings-JSON only).
     */
    get productionWarnActive(): boolean {
        return (
            this.groupAccent?.production === true &&
            vscode.workspace
                .getConfiguration()
                .get<boolean>("mssql.queryStudio.warnWhenModifyingProduction", false) &&
            (this.stateKind === "connected" || this.stateKind === "executing")
        );
    }

    /** Status-bar accent per the option matrix (undefined = default chrome). */
    private accentFacts():
        | { accentColor: string; accentTextColor: string; production?: boolean }
        | undefined {
        const accent = this.groupAccent;
        if (!accent || (this.stateKind !== "connected" && this.stateKind !== "executing")) {
            return undefined;
        }
        const config = vscode.workspace.getConfiguration();
        const colorOption = config.get<boolean>("mssql.queryStudio.statusBarGroupColor", false);
        const warnOption = config.get<boolean>(
            "mssql.queryStudio.warnWhenModifyingProduction",
            false,
        );
        // Color shows when the color option is on, OR the connection is
        // production and the warn option is on (production visibility rides
        // the safety setting even without the cosmetic one).
        if (!(colorOption || (accent.production && warnOption))) {
            return undefined;
        }
        const accentColor = accent.color ?? (accent.production ? "#B71C1C" : undefined);
        if (!accentColor) {
            return undefined;
        }
        return {
            accentColor,
            accentTextColor: accentTextColor(accentColor),
            ...(accent.production ? { production: true } : {}),
        };
    }

    get connectionState(): QsConnectionState {
        const info = this.session?.info;
        // Prefer the numeric engineEditionId (D-0017); the legacy field only
        // parses when a service ever sends a number there.
        const engineEdition =
            info?.engineEditionId !== undefined && Number.isFinite(Number(info.engineEditionId))
                ? Number(info.engineEditionId)
                : info?.engineEdition !== undefined && Number.isFinite(Number(info.engineEdition))
                  ? Number(info.engineEdition)
                  : undefined;
        return {
            ...(this.accentFacts() ?? {}),
            kind: this.stateKind,
            ...(info?.serverDisplayName ? { serverDisplayName: info.serverDisplayName } : {}),
            ...(info?.serverVersion ? { serverVersion: info.serverVersion } : {}),
            ...(engineEdition !== undefined ? { engineEdition } : {}),
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

    async waitForUserSessionReady(): Promise<void> {
        await this.userSessionReady;
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

    /**
     * Per-document provider override (TSQ2 §3.5): resolution order is
     * explicit override > setting default. Applies at the NEXT connect for
     * this document; a live session keeps the provider it was bound to
     * (nothing pretends — session.info.backendKind is the truth).
     */
    private backendOverride: SqlBackendKind | undefined;

    get documentBackendOverride(): SqlBackendKind | undefined {
        return this.backendOverride;
    }

    /** The provider the LIVE session is actually bound to, if connected. */
    get activeBackendKind(): string | undefined {
        return this.session?.info.backendKind;
    }

    setDocumentBackendOverride(kind: SqlBackendKind | undefined): void {
        this.backendOverride = kind;
        this.fireChange();
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

    /**
     * Azure SQL Database (engine edition 5): USE is not supported there.
     * Exact when the service sends the numeric engineEditionId (STS2
     * D-0017); older services only carry serverproperty('Edition')'s NAME
     * ("SQL Azure") in engineEdition — Number() of that is NaN, which is
     * exactly the dogfood bug where the DB selector silently ran USE. Name
     * sniff is the OE v2 recipe (oeV2TreeController.serverScopeFacts); it
     * also matches Managed Instance, where switch-by-reconnect still works,
     * just heavier than the USE the numeric id would have picked.
     */
    get isAzureSqlDb(): boolean {
        const info = this.session?.info;
        if (info?.engineEditionId !== undefined) {
            return Number(info.engineEditionId) === 5;
        }
        const edition = info?.engineEdition;
        return edition !== undefined && (Number(edition) === 5 || /azure/i.test(String(edition)));
    }

    /**
     * Database switch for servers where USE cannot work (Azure SQL DB):
     * close the session and reconnect with the new database — the exact
     * semantic of STS v1's ChangeConnectionDatabaseContext IsCloud branch
     * (ConnectionService.cs: close + rebuild with the new database).
     */
    async switchDatabaseByReconnect(database: string): Promise<boolean> {
        const stored = this.lastStoredProfile;
        const store = this.lastStore;
        if (!stored || !store) {
            return false;
        }
        const previous = this.session;
        this.session = undefined;
        this.releaseMetadata();
        void previous?.close().catch(() => undefined);
        this.masterDbListCache = undefined;
        return this.open({ ...stored, database }, store);
    }

    /**
     * SQLCMD :connect session (SQLCMD_MODE_PLAN.md §3.3): open a session to
     * an arbitrary server named in the script — SQL auth when -U/-P were
     * given (the password lives ONLY in this closure, STS's
     * ConnectSqlCmdCommand shape), integrated otherwise. Encrypt/trust ride
     * the document's connected profile so the script stays in the same
     * transport-trust context. Run-scoped: the orchestrator closes it.
     */
    async openSqlcmdConnectSession(target: {
        server: string;
        user?: string;
        password?: string;
    }): Promise<ISqlSession> {
        const service = await SqlDataPlaneService.get().service();
        const base = this.lastStoredProfile;
        const stored: StoredProfile = {
            server: target.server,
            authenticationType: target.user ? "SqlLogin" : "Integrated",
            ...(target.user ? { user: target.user } : {}),
            ...(base?.encrypt !== undefined ? { encrypt: base.encrypt } : {}),
            ...(base?.trustServerCertificate !== undefined
                ? { trustServerCertificate: base.trustServerCertificate }
                : {}),
        };
        return service.openSession({
            profile: buildProfileRef(stored),
            applicationName: "vscode-mssql-querystudio-sqlcmd",
            auth: { passwordProvider: async () => target.password },
        });
    }

    /**
     * Auxiliary diagnostic/model session (VEC-7, RR §6.4): a NARROW separate
     * session on the SAME saved profile and the user session's CURRENT
     * database — same principal, same auth material, never elevated. The
     * application name carries the purpose so server-side diagnostics show
     * why the session exists. Refuses honestly (undefined) when the binding
     * has no active profile, the cap (2) is reached, or the open fails.
     *
     * NEVER hands out the user session or the metadata session — callers get
     * a fresh session they must dispose (idempotent; closing releases the
     * cap slot). All outstanding auxiliary sessions close on disconnect,
     * reconnect, and binding dispose.
     */
    async acquireAuxiliarySession(
        purpose: AuxiliarySessionPurpose,
    ): Promise<AuxiliarySessionLease | undefined> {
        const stored = this.lastStoredProfile;
        const store = this.lastStore;
        const profileRef = this.lastProfileRef;
        if (
            !stored ||
            !store ||
            !profileRef ||
            (this.stateKind !== "connected" && this.stateKind !== "executing")
        ) {
            return undefined; // no active profile — honest refusal
        }
        if (this.auxSessions.size >= MAX_AUX_SESSIONS) {
            return undefined; // cap reached — the caller must dispose first
        }
        // Follow the CURRENT database (post-USE), not the profile default.
        const database = this.session?.info?.database;
        try {
            const service = await SqlDataPlaneService.get().service();
            const session = await service.openSession({
                profile: profileRef,
                ...(database ? { database } : {}),
                applicationName: AUX_APPLICATION_NAMES[purpose],
                // Password exists only inside the provider closure.
                auth: this.lastPrepared?.auth,
            });
            this.auxSessions.add(session);
            session.onDidChangeState((change) => {
                if (change.current === "closed" || change.current === "lost") {
                    this.auxSessions.delete(session);
                }
            });
            let disposed = false;
            return {
                session,
                dispose: () => {
                    if (disposed) {
                        return;
                    }
                    disposed = true;
                    this.auxSessions.delete(session);
                    void session.close().catch(() => undefined);
                },
            };
        } catch {
            return undefined; // open failed — refusal, never a throw
        }
    }

    /** Open auxiliary-session count (cap introspection for tests/diag). */
    get auxiliarySessionCount(): number {
        return this.auxSessions.size;
    }

    private closeAuxSessions(): void {
        for (const session of [...this.auxSessions]) {
            void session.close().catch(() => undefined);
        }
        this.auxSessions.clear();
    }

    private masterDbListCache: { at: number; names: string[] } | undefined;

    /**
     * Database list via a transient MASTER-scoped session — sys.databases
     * from a user database only lists master + itself on Azure SQL DB. This
     * mirrors STS v1's ListDatabaseRequestHandler: try master FIRST (for
     * every server kind), and the caller falls back to the current session's
     * list when master is not accessible (their 18456/40532 fallback).
     */
    async listDatabasesViaMaster(): Promise<string[] | undefined> {
        const stored = this.lastStoredProfile;
        const store = this.lastStore;
        const profileRef = this.lastProfileRef;
        if (!stored || !store || !profileRef || this.stateKind !== "connected") {
            return undefined;
        }
        if ((this.session?.info?.database ?? "").toLowerCase() === "master") {
            return undefined; // the current session already sees everything
        }
        const cached = this.masterDbListCache;
        if (cached && Date.now() - cached.at < 15_000) {
            return cached.names;
        }
        try {
            const service = await SqlDataPlaneService.get().service();
            const session = await service.openSession({
                profile: profileRef,
                database: "master",
                applicationName: "vscode-mssql-querystudio-dblist",
                auth: this.lastPrepared?.auth,
            });
            try {
                const rows = await runMetadataQuery(
                    session,
                    "SELECT name FROM sys.databases WHERE state = 0 ORDER BY name;",
                    "queryStudio:dbListMaster",
                );
                const names = rows
                    .map((row) => (row[0] === null || row[0] === undefined ? "" : String(row[0])))
                    .filter((name) => name.length > 0);
                this.masterDbListCache = { at: Date.now(), names };
                return names;
            } finally {
                void session.close().catch(() => undefined);
            }
        } catch {
            return undefined; // no master access — caller falls back
        }
    }

    /**
     * Connect directly to a saved profile by id (OE v2 open-from-context,
     * oe_view_design §11.3) — no quick pick; optional database override.
     * Credentials still resolve through the connection store at open time.
     */
    async connectToProfile(profileId: string, database?: string): Promise<boolean> {
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
        const stored = (await store.readAllConnections(false)).find(
            (profile) => stableProfileId(profile) === profileId,
        );
        if (!stored) {
            void vscode.window.showErrorMessage(
                "The connection profile for this request no longer exists.",
            );
            return false;
        }
        return this.open(database ? { ...stored, database } : stored, store);
    }

    private async open(stored: StoredProfile, store: ConnectionStoreSeam): Promise<boolean> {
        // Auxiliary sessions belong to the PREVIOUS connection context.
        this.closeAuxSessions();
        this.lastStoredProfile = stored;
        this.lastProfileRef = undefined;
        this.lastPrepared = undefined;
        this.lastStore = undefined;
        this.lastAuthKind = undefined;
        this.userSessionReady = Promise.resolve();
        this.stateKind = "connecting";
        this.lostReason = undefined;
        this.fireChange();
        Perf.marker("mssql.queryStudio.connect.begin", "begin");
        // Shared profile-preparation seam (MetadataStore MD-0): fingerprint
        // recipe is now hash-based (non-reversible, per the profileRef
        // contract) — in-memory keys only, so no persisted state shifts.
        try {
            const prepared = prepareConnection(stored, store, vscodeSqlTokenSource);
            const { authKind, profileRef } = prepared;
            this.lastProfileRef = profileRef;
            this.lastPrepared = prepared;
            this.lastStore = store;
            this.lastAuthKind = authKind;
            // Production safety: resolve the profile's group facts in the
            // background (accent + production flag); absence is simply "off".
            this.groupAccent = undefined;
            void this.resolveGroupAccent(stored, store);
            const dataPlane = SqlDataPlaneService.get();
            const params = {
                profile: profileRef,
                applicationName: "vscode-mssql-querystudio",
                // Password exists only inside the provider closure.
                auth: prepared.auth,
            };
            // Capability-routed open (TSQ2 §8.2): requirements are evaluated
            // BEFORE any credential resolution; a provider that cannot open
            // this profile triggers the fallback policy (prompt/auto/off).
            let backendKind = this.backendOverride;
            const check = await dataPlane.canOpen(
                params,
                backendKind ? { backendKind } : undefined,
            );
            if (!check.ok) {
                const policy = vscode.workspace
                    .getConfiguration()
                    .get<CapabilityFallbackPolicy>(CAPABILITY_FALLBACK_SETTING, "prompt");
                const decision = await resolveCapabilityFallback({
                    check,
                    policy,
                    currentKind: backendKind ?? dataPlane.defaultBackendKind(),
                    displayNameFor: (kind) => dataPlane.displayNameFor(kind),
                    interaction: {
                        prompt: (message, actions) =>
                            Promise.resolve(vscode.window.showWarningMessage(message, ...actions)),
                        notify: (message) => void vscode.window.showInformationMessage(message),
                    },
                });
                if (decision.kind !== "useAlternative" || !decision.alternative) {
                    throw new Error(
                        check.reason ??
                            "the selected SQL data plane provider cannot open this profile",
                    );
                }
                backendKind = decision.alternative;
            }
            const session = await dataPlane.openSession(
                params,
                backendKind ? { backendKind } : undefined,
            );
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
            this.spid = session.info.spid;
            this.fireChange();
            // Session options (SSMS parity): apply the mssql.query.* SET
            // batch FIRST — the session serializes queries, so anything the
            // user runs right after connect queues behind the configured
            // state. Reconnect flows re-enter open(), reapplying naturally.
            const initialization = this.initializeUserSession(session).catch(() => undefined);
            this.userSessionReady = initialization;
            void initialization;
            // Metadata catalog (design §8.2): dedicated session over the
            // same profile; hydration never contends with the user's F5.
            this.acquireMetadata(profileRef, store, authKind);
            return true;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            Perf.marker("mssql.queryStudio.connect.ready", "end", {
                error: true,
                reason: diagnosticErrorClass(error),
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

    private async initializeUserSession(session: ISqlSession): Promise<void> {
        await this.applySessionOptions(session);
        if (this.session !== session || session.state !== "open" || this.spid !== undefined) {
            return;
        }
        // SPID probe only because some backends' open result lacks it
        // (worksheet #5). Run it after session options so the two background
        // probes do not collide on the one-active-query user session.
        await this.probeSpid(session);
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
     * Post-run session probe (SSMS parity): after each run, ask the SAME
     * session for @@TRANCOUNT (a BEGIN TRAN left open across executions is
     * visible in the status bar and guarded at disconnect) AND @@SPID — if
     * the connection was killed and transparently re-established, the next
     * run carries a NEW spid, and the status bar must show the session the
     * DBA can actually reference (dogfood 2026-07-10; SSMS updates the same
     * way on the next execution). Best-effort, one round trip.
     */
    async probeTransactionState(): Promise<void> {
        const session = this.activeSession;
        if (session === undefined) {
            return;
        }
        try {
            let tranCount: number | undefined;
            let spid: number | undefined;
            const sink: IQueryEventSink = {
                onResultSetStarted: () => undefined,
                onRowsPage: (page) => {
                    const row = page.compact.values[0];
                    const tranCell = row?.[0];
                    const spidCell = row?.[1];
                    tranCount = typeof tranCell === "number" ? tranCell : Number(tranCell);
                    spid = typeof spidCell === "number" ? spidCell : Number(spidCell);
                },
                onMessage: () => undefined,
                onComplete: () => undefined,
            };
            const handle = session.execute(
                "SELECT @@TRANCOUNT, @@SPID;",
                {
                    priority: "background",
                    commandKind: "metadata",
                    tag: "queryStudio:tranProbe",
                },
                sink,
            );
            await handle.completion;
            let changed = false;
            const count = Number.isFinite(tranCount) ? Number(tranCount) : undefined;
            if (count !== undefined && count !== this.openTransactions) {
                this.openTransactions = count;
                changed = true;
            }
            const liveSpid = Number.isFinite(spid) ? Number(spid) : undefined;
            if (liveSpid !== undefined && this.session === session && liveSpid !== this.spid) {
                this.spid = liveSpid;
                changed = true;
            }
            if (changed) {
                this.fireChange();
            }
        } catch {
            // Best-effort; the indicators simply stay at their last values.
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
            if (spid !== undefined && this.session === session) {
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
        this.closeAuxSessions();
        this.stateKind = "disconnecting";
        this.fireChange();
        await this.session.close().catch(() => undefined);
        this.session = undefined;
        this.userSessionReady = Promise.resolve();
        this.spid = undefined;
        this.openTransactions = undefined;
        this.stateKind = "disconnected";
        this.fireChange();
        return true;
    }

    /**
     * Catalog acquisition now goes through the SHARED MetadataStore (MD-4):
     * one lease per {server, database} key across all features. Releasing a
     * lease leaves the engine warm for the store's idle TTL, so reconnect
     * and database switches re-acquire instantly.
     */
    private acquireMetadata(
        _profileRef: SqlConnectionProfileRef,
        store: ConnectionStoreSeam,
        _authKind: ResolvedAuthKind,
    ): void {
        void (async () => {
            try {
                const prepared = prepareConnection(
                    this.lastStoredProfile ?? {},
                    store,
                    vscodeSqlTokenSource,
                );
                this.metadataLease = await MetadataStoreService.get()
                    .store()
                    .acquireDatabase(prepared, this.connectionState.database ?? "", (status) => {
                        this.metadataStatus = status;
                        this.fireChange();
                    });
            } catch {
                // Metadata is an enhancement; connect stays healthy without it.
            }
        })();
    }

    /** DDL sniff feed (metadata design §9.1). */
    notifyExecutedBatch(text: string, succeeded: boolean): void {
        this.metadataLease?.notifyExecutedBatch({ text, succeeded });
    }

    get metadataHandleForConsumers(): DatabaseCatalogLease | undefined {
        return this.metadataLease;
    }

    private releaseMetadata(): void {
        this.metadataLease?.dispose();
        this.metadataLease = undefined;
        this.metadataStatus = undefined;
    }

    dispose(): void {
        this.releaseMetadata();
        this.closeAuxSessions();
        this.userSessionReady = Promise.resolve();
        void this.session?.close().catch(() => undefined);
        this.onChangeHandlers.clear();
    }
}
