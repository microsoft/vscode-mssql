/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OeV2TreeController (B17 shell + B18 browse): computes tree children from
 * injected sources — saved profiles/groups, the data-plane availability
 * probe, the session registry, and per-connection metadata coordinators
 * over the SHARED MetadataStore. Pure module: no vscode, no singletons, NO
 * classic OE anything (the no-v1 rule is structural — no import path here
 * can reach ConnectionManager or classic OE RPCs).
 *
 * Expansion rules per oe_view_design §10: pin once per expand; database
 * catalogs acquire lazily on database expand; readiness renders honestly
 * (failure ≠ emptiness); saved connection expansion opens through the data
 * plane like classic OE unless the user explicitly disconnected it.
 */

import { diag } from "../../../diagnostics/diagnosticsCore";
import {
    PreparedConnection,
    prepareConnection,
    ProfileSecretSource,
    ProfileTokenSource,
} from "../../../services/metadata/profileAuthAdapter";
import { ObjectExplorerV2 } from "../../../constants/locConstants";
import { OeV2MetadataCoordinator } from "../metadata/oeV2MetadataCoordinator";
import {
    ConnectionProfileSource,
    OeV2ProfileRecord,
    OeV2ProfileTree,
    readProfileTree,
} from "../sessions/oeV2ProfileAdapter";
import { OeV2ConnectionSession, OeV2SessionRegistry } from "../sessions/oeV2SessionRegistry";
import {
    databaseChildren,
    databaseFolderChildren,
    databasesFolderChildren,
    objectChildren,
    objectFolderChildren,
    OeV2FreshnessFacts,
    serverAuxFolderChildren,
    serverChildren,
    SYSTEM_DATABASES_FOLDER,
    systemDatabasesFolderChildren,
} from "./oeV2Browse";
import { folderDef, isSystemDatabaseName, OeV2ScopeFacts, resolveFolders } from "./oeV2Hierarchy";
import { CatalogLanguageMetadataProvider } from "../../../sqlLanguage/provider/catalogProvider";
import { createStrictScriptingService } from "../../../sqlLanguage/host/scriptingHost";
import type { ScriptOperation } from "../../../sqlScripting/api";
import type { FreshCatalogResult } from "../../../services/metadata/cache/metadataFreshness";
import { OeV2Node } from "./oeV2Node";
import {
    childrenOfGroup,
    connectionNode,
    ConnectionNodeFacts,
    rootChildren,
} from "./oeV2NodeFactory";
import { errorNode, loadingNode, noItemsNode, statusNode } from "./oeV2Readiness";
import { encodePath } from "./oeV2Path";

export interface DataPlaneProbe {
    enabled(): boolean;
    availabilityState(): "unknown" | "available" | "unavailable";
}

export interface OeV2BrowseSettings {
    readonly groupBySchema: boolean;
    readonly showSystemDatabases: boolean;
}

/**
 * Docker operations seam (DOCK-3): the activation edge supplies the real
 * implementation over the shared docker core (which owns Docker Desktop
 * launch, container start and readiness); tests supply fakes. `restart`
 * reports its progress through the controller's container-activity text.
 */
export interface OeV2ContainerOps {
    restart(
        containerName: string,
        connectionId: string,
        signal: AbortSignal,
    ): Promise<boolean | undefined>;
}

export interface OeV2TreeControllerDeps {
    readonly profiles: ConnectionProfileSource;
    readonly dataPlane: DataPlaneProbe;
    /** B18 browse deps — absent means shell-only behavior (B17 tests). */
    readonly secrets?: ProfileSecretSource;
    readonly tokens?: ProfileTokenSource;
    readonly sessions?: OeV2SessionRegistry;
    readonly coordinatorFactory?: (prepared: PreparedConnection) => OeV2MetadataCoordinator;
    readonly settings?: () => OeV2BrowseSettings;
    /** Container lifecycle (DOCK-3) — absent means no docker pre-flight. */
    readonly containers?: OeV2ContainerOps;
    /** Test seam: expansion wait ceilings (defaults EXPAND/CONNECT_KICK). */
    readonly waits?: {
        expandMs?: number;
        connectKickMs?: number;
        containerPreflightMs?: number;
        containerOpenRetryBackoffMs?: number;
        containerOpenRetryBudgetMs?: number;
        containerLoginRetryGraceMs?: number;
    };
}

interface ConnectionRuntime {
    prepared: PreparedConnection;
    coordinator: OeV2MetadataCoordinator;
    subscription: { dispose(): void };
    clearTransientAuth?: () => void;
}

export interface OeV2ConnectOptions {
    /** Wizard credential: scoped to this connection, never saved by the tree. */
    readonly password?: string;
    /** Only the wizard's first open may retry the brief initial-login race. */
    readonly freshContainer?: boolean;
}

const DEFAULT_SETTINGS: OeV2BrowseSettings = { groupBySchema: false, showSystemDatabases: true };

export class OeV2TreeController {
    private disposed = false;
    private tree: OeV2ProfileTree | undefined;
    private listeners = new Set<(node?: OeV2Node) => void>();
    private runtimes = new Map<string, ConnectionRuntime>();
    private explicitlyDisconnected = new Set<string>();
    private registrySubscription: { dispose(): void } | undefined;
    private readonly profileLookupEpoch = new Map<string, number>();
    private readonly containerConnects = new Map<
        string,
        { cancellation: AbortController; pending: Promise<boolean> }
    >();

    constructor(private readonly deps: OeV2TreeControllerDeps) {
        this.registrySubscription = deps.sessions?.onDidChange(() => this.fireChange());
    }

    onDidChange(listener: (node?: OeV2Node) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private fireChange(node?: OeV2Node): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(node);
            } catch {
                /* listener isolation */
            }
        }
    }

    /** Invalidate cached sources and notify the view (config/store change). */
    refresh(): void {
        this.tree = undefined;
        this.fireChange();
    }

    /** Re-render only transient connection rows (for elapsed-time labels). */
    async refreshTransientConnections(): Promise<void> {
        const tree = await this.profileTree();
        for (const profile of tree.profiles) {
            const facts = this.connectionFacts(profile.profileId);
            if (facts?.state !== "connecting" && facts?.state !== "disconnecting") {
                continue;
            }
            const tiedWith = tree.profiles
                .filter(
                    (candidate) =>
                        candidate !== profile &&
                        candidate.groupId === profile.groupId &&
                        candidate.displayName === profile.displayName,
                )
                .map((candidate) => candidate.stored);
            this.fireChange(connectionNode(profile, facts, tiedWith));
        }
    }

    // -- folder filters (in-memory over pinned metadata — design §10.8) -------

    private folderFilters = new Map<string, string>();

    setFolderFilter(node: OeV2Node, filterText: string): void {
        const trimmed = filterText.trim();
        if (trimmed) {
            this.folderFilters.set(node.id, trimmed);
        } else {
            this.folderFilters.delete(node.id);
        }
        this.fireChange();
    }

    clearFolderFilter(node?: OeV2Node): void {
        if (node) {
            this.folderFilters.delete(node.id);
        } else {
            this.folderFilters.clear();
        }
        this.fireChange();
    }

    folderFilter(node: OeV2Node): string | undefined {
        return this.folderFilters.get(node.id);
    }

    /** Name search over a connected database's pinned snapshot (§11.2). */
    async searchObjects(
        connectionId: string,
        database: string,
        term: string,
        limit = 50,
    ): Promise<{ schema: string; name: string; kind: string }[] | undefined> {
        const runtime = this.runtimes.get(connectionId);
        if (!runtime) {
            return [];
        }
        const lease = await boundedWait(
            runtime.coordinator.ensureDatabase(database),
            this.deps.waits?.expandMs ?? EXPAND_WAIT_MS,
        );
        if (!lease) {
            return undefined;
        }
        const snapshot = runtime.coordinator.databaseSnapshot(database);
        if (!snapshot) {
            return undefined;
        }
        return snapshot
            .search(term, limit)
            .map((info) => ({ schema: info.schema, name: info.name, kind: info.kind }));
    }

    async scriptObject(
        node: OeV2Node,
        operation: Extract<ScriptOperation, "create" | "alter" | "drop" | "execute">,
        offlineMode: boolean,
    ): Promise<{ script?: string; error?: string }> {
        if (!node.connectionId || !node.database || !node.schema || !node.objectName) {
            return { error: ObjectExplorerV2.selectObjectToScript };
        }
        const runtime = this.runtimes.get(node.connectionId);
        if (!runtime) {
            return { error: ObjectExplorerV2.connectBeforeScripting };
        }
        const lease = await runtime.coordinator.ensureDatabase(node.database);
        const session = this.deps.sessions?.get(node.connectionId);
        const provider = new CatalogLanguageMetadataProvider({
            handle: () => lease,
            serverVersion: () => session?.serverVersion,
            currentDatabase: () => node.database,
            databases: () => undefined,
            subscribeStatus: () => () => undefined,
        });
        const resolution = provider.pin().resolveObject([node.schema, node.objectName]);
        if (resolution.kind !== "resolved") {
            return {
                script:
                    ObjectExplorerV2.objectMissingForScript(node.schema, node.objectName) + "\r\n",
            };
        }
        const scripting = createStrictScriptingService({
            lease: () => lease,
            pin: () => provider.pin(),
            offlineMode: () => offlineMode,
        });
        const result = await scripting.script({
            target: { ref: resolution.ref },
            operation,
        });
        return { script: result.text };
    }

    // -- commands (wired by activation) ---------------------------------------

    /** Explicit connect: opens the data-plane session + metadata coordinator. */
    async connectProfile(connectionId: string, options?: OeV2ConnectOptions): Promise<boolean> {
        if (this.disposed) {
            return false;
        }
        this.explicitlyDisconnected.delete(connectionId);
        const lookupEpoch = this.profileLookupEpoch.get(connectionId);
        const { sessions, secrets, coordinatorFactory } = this.deps;
        if (!sessions || !secrets || !coordinatorFactory) {
            return false;
        }
        const profile = await this.findProfile(connectionId);
        if (
            this.disposed ||
            !profile ||
            this.profileLookupEpoch.get(connectionId) !== lookupEpoch
        ) {
            return false;
        }
        if (!profile.stored.containerName) {
            return this.connectPreparedProfile(connectionId, profile, undefined, options);
        }
        // The wizard and profile-change reconciliation can request the same
        // connection together. Share the entire startup, including Docker.
        const existing = this.containerConnects.get(connectionId);
        if (existing) {
            return existing.pending;
        }
        const cancellation = new AbortController();
        const pending = this.connectPreparedProfile(
            connectionId,
            profile,
            cancellation,
            options,
        ).finally(() => {
            if (this.containerConnects.get(connectionId)?.cancellation === cancellation) {
                this.containerConnects.delete(connectionId);
                this.setContainerActivity(connectionId, undefined);
            }
        });
        this.containerConnects.set(connectionId, { cancellation, pending });
        this.fireChange();
        return pending;
    }

    private async connectPreparedProfile(
        connectionId: string,
        profile: OeV2ProfileRecord,
        cancellation?: AbortController,
        options?: OeV2ConnectOptions,
    ): Promise<boolean> {
        const { sessions, secrets, tokens, coordinatorFactory } = this.deps;
        // Container pre-flight (DOCK-3): stopped containers start before the
        // data-plane open, exactly like v1's expand-while-stopped behavior.
        let preflightWarning: string | undefined;
        if (profile.stored.containerName && cancellation) {
            const ready = await this.ensureContainerReady(
                connectionId,
                profile.stored.containerName,
                cancellation,
            );
            if (this.disposed || cancellation.signal.aborted || !ready.proceed) {
                return false;
            }
            preflightWarning = ready.warning;
        }
        let prepared: PreparedConnection;
        let password = options?.password;
        const clearTransientAuth = () => {
            password = undefined;
        };
        try {
            prepared =
                password === undefined
                    ? prepareConnection(profile.stored, secrets, tokens)
                    : prepareConnection(
                          { ...profile.stored, password: undefined },
                          {
                              lookupPassword: (credentials) =>
                                  password === undefined
                                      ? secrets.lookupPassword(credentials)
                                      : Promise.resolve(password),
                          },
                          tokens,
                      );
        } catch (error) {
            sessions.recordPreparationFailure(
                connectionId,
                error instanceof Error ? error.message : ObjectExplorerV2.profilePreparationFailed,
                error,
            );
            return false;
        }
        const existingRuntime = this.runtimes.get(connectionId);
        if (
            existingRuntime &&
            existingRuntime.prepared.profileRef.profileFingerprint !==
                prepared.profileRef.profileFingerprint
        ) {
            this.releaseRuntime(connectionId);
        }
        const session = cancellation
            ? await this.openContainerSessionWithRetry(
                  connectionId,
                  prepared,
                  cancellation.signal,
                  options?.freshContainer === true,
              )
            : await sessions.connect(connectionId, prepared);
        if (this.disposed || cancellation?.signal.aborted || session.state !== "connected") {
            clearTransientAuth();
            if (
                preflightWarning &&
                session.state === "failed" &&
                !cancellation?.signal.aborted &&
                !this.disposed
            ) {
                const reason = ObjectExplorerV2.containerAndConnectionFailed(
                    preflightWarning,
                    session.failureReason ?? ObjectExplorerV2.unknownError,
                );
                sessions.recordPreparationFailure(connectionId, reason, new Error(reason));
            }
            return false;
        }
        if (!this.runtimes.has(connectionId)) {
            const coordinator = coordinatorFactory(prepared);
            const subscription = coordinator.onDidChange(() => this.fireChange());
            this.runtimes.set(connectionId, {
                prepared,
                coordinator,
                subscription,
                clearTransientAuth,
            });
            // Kick the server catalog so Databases is warm by first expand.
            void coordinator.ensureServer().catch(() => undefined);
        } else {
            clearTransientAuth();
        }
        return true;
    }

    /**
     * Cancel an in-flight connect. The node returns to disconnected at once;
     * the pending open self-supersedes when its deadline settles it.
     */
    cancelConnect(connectionId: string): void {
        this.explicitlyDisconnected.add(connectionId);
        const hadContainerAttempt = this.containerConnects.has(connectionId);
        this.cancelContainerConnect(connectionId);
        const cancelled = this.deps.sessions?.cancelConnect(connectionId);
        if (
            !cancelled &&
            hadContainerAttempt &&
            this.deps.sessions?.stateOf(connectionId) === "failed"
        ) {
            void this.deps.sessions.disconnect(connectionId);
        }
    }

    async disconnectProfile(connectionId: string): Promise<void> {
        this.explicitlyDisconnected.add(connectionId);
        this.cancelContainerConnect(connectionId);
        this.releaseRuntime(connectionId);
        await this.deps.sessions?.disconnect(connectionId);
    }

    /**
     * Retire state invalidated by a shared saved-profile edit/removal. Unlike
     * an explicit user disconnect, a surviving edited profile may auto-open
     * again on its next expansion using the new connection facts.
     */
    async retireProfile(connectionId: string): Promise<void> {
        this.cancelContainerConnect(connectionId);
        this.releaseRuntime(connectionId);
        await this.deps.sessions?.disconnect(connectionId);
        this.explicitlyDisconnected.delete(connectionId);
    }

    /** Route a refresh request to the right lease scope. */
    async refreshNode(node: OeV2Node): Promise<void> {
        const runtime = node.connectionId ? this.runtimes.get(node.connectionId) : undefined;
        if (!runtime) {
            this.refresh();
            return;
        }
        switch (node.path.kind) {
            case "serverFolder": {
                // Aux leaves refresh their own section; everything else at
                // server scope refreshes the server catalog.
                const def = folderDef("server", node.path.folder);
                const aux = runtime.coordinator.serverAuxiliary();
                if (def && aux && aux.sectionKeys().includes(def.section)) {
                    await aux.refreshSection(def.section).catch(() => undefined);
                    break;
                }
                await runtime.coordinator.refreshServer().catch(() => undefined);
                break;
            }
            case "connection":
                await runtime.coordinator.refreshServer().catch(() => undefined);
                break;
            case "databaseFolder": {
                if (!node.database) {
                    break;
                }
                // Aux-backed leaves refresh their own section; folders with
                // facet-driven content refresh facets ALONGSIDE the catalog.
                const def = folderDef("database", node.path.folder);
                const aux = runtime.coordinator.databaseAuxiliary(node.database);
                const sections = auxSectionsFor(node.path.folder);
                if (def && aux && sections.length > 0) {
                    await Promise.all(
                        sections.map((section) =>
                            aux.refreshSection(section).catch(() => undefined),
                        ),
                    );
                    if (def.section !== "objects" && def.section !== "synonyms") {
                        break; // pure aux leaf — no catalog refresh needed
                    }
                }
                await runtime.coordinator.refreshDatabase(node.database).catch(() => undefined);
                break;
            }
            case "database":
            case "schemaFolder":
            case "object":
            case "objectFolder":
                if (node.database) {
                    await runtime.coordinator.refreshDatabase(node.database).catch(() => undefined);
                }
                break;
            default:
                this.refresh();
                return;
        }
        this.fireChange();
    }

    // -- expansion --------------------------------------------------------------

    /**
     * The tree edge (dogfood 2026-07-10, "async node expansion"): expansion
     * must NEVER hang getChildren (VS Code renders a hung promise as an
     * expanded-empty node — no spinner, no error) and must NEVER resolve to
     * a silent empty list. Every awaited dependency inside childrenCore is
     * bounded; anything slower renders the honest loading child and the
     * change stream re-renders when the work lands. A thrown expansion is
     * an explicit error child. One slow/sleeping connection can therefore
     * only ever affect its OWN subtree.
     */
    async children(node?: OeV2Node): Promise<OeV2Node[]> {
        let result: OeV2Node[];
        try {
            result = await this.childrenCore(node);
        } catch (error) {
            const scope = node ? `expand/${node.path.kind}` : "expand/root";
            return [
                errorNode(
                    scope,
                    ObjectExplorerV2.expansionFailed(
                        error instanceof Error ? error.message : String(error),
                    ),
                    node?.connectionId,
                ),
            ];
        }
        // Silent-empty tripwire: an expandable node with zero children must
        // say so ("No items"), never render as expanded nothing.
        if (node && node.collapsible && result.length === 0) {
            return [noItemsNode(`expand/${node.path.kind}`, node.connectionId)];
        }
        return result;
    }

    private async childrenCore(node?: OeV2Node): Promise<OeV2Node[]> {
        if (!node) {
            return this.rootLevel();
        }
        const settings = this.deps.settings?.() ?? DEFAULT_SETTINGS;
        const path = node.path;
        switch (path.kind) {
            case "connectionGroup":
                return childrenOfGroup(await this.profileTree(), path.groupId, (id) =>
                    this.connectionFacts(id),
                );
            case "connection":
                return this.connectionChildren(path.connectionId);
            case "serverFolder": {
                const runtime = this.runtimes.get(path.connectionId);
                if (!runtime) {
                    return [disconnectedHint(path.connectionId)];
                }
                if (path.folder === "databases") {
                    // §7.2 block-with-loading at server scope: expands beyond
                    // the TTL re-hydrate (validation ≡ re-hydration, §4.4)
                    // while the tree shows its busy state; within the TTL this
                    // answers instantly. Pin once per expand (below). BOUNDED:
                    // a stalled catalog renders loading and re-renders on the
                    // change stream — never a hung getChildren.
                    const serverFresh = await boundedWait(
                        runtime.coordinator.ensureServerFresh(),
                        this.deps.waits?.expandMs ?? EXPAND_WAIT_MS,
                    );
                    return databasesFolderChildren(
                        path.connectionId,
                        runtime.coordinator.serverStatus(),
                        runtime.coordinator.serverView(),
                        settings.showSystemDatabases,
                        serverFresh ? { freshness: serverFresh.freshness } : undefined,
                    );
                }
                if (path.folder === SYSTEM_DATABASES_FOLDER) {
                    const serverFresh = await boundedWait(
                        runtime.coordinator.ensureServerFresh(),
                        this.deps.waits?.expandMs ?? EXPAND_WAIT_MS,
                    );
                    return systemDatabasesFolderChildren(
                        path.connectionId,
                        runtime.coordinator.serverStatus(),
                        runtime.coordinator.serverView(),
                        serverFresh ? { freshness: serverFresh.freshness } : undefined,
                    );
                }
                // B23: Security/Server Objects — parent folders render
                // registry children instantly; aux leaves kick a LAZY
                // section hydrate and render current state (loading child
                // first; the change stream re-renders when rows land).
                const facts = await this.serverScopeFacts(path.connectionId);
                const def = folderDef("server", path.folder);
                const isLeaf =
                    def !== undefined &&
                    resolveFolders("server", facts, { parentId: def.id }).length === 0;
                const aux = runtime.coordinator.serverAuxiliary();
                if (isLeaf && def) {
                    void runtime.coordinator.ensureAuxSection(def.section).catch(() => undefined);
                }
                return serverAuxFolderChildren(
                    path.connectionId,
                    path.folder,
                    facts,
                    isLeaf && def && aux ? aux.status(def.section) : undefined,
                    isLeaf && def ? aux?.items(def.section) : undefined,
                );
            }
            case "database": {
                const runtime = this.runtimes.get(path.connectionId);
                if (!runtime) {
                    return [disconnectedHint(path.connectionId)];
                }
                // Lazy lease acquisition on database expand (design §10.5);
                // the folder list itself is static, so validation runs in
                // the background — folder expands below block on it.
                void runtime.coordinator.ensureDatabaseFresh(path.database).catch(() => undefined);
                return databaseChildren(
                    path.connectionId,
                    path.database,
                    await this.databaseScopeFacts(path.connectionId, path.database),
                );
            }
            case "databaseFolder":
            case "schemaFolder": {
                const runtime = this.runtimes.get(path.connectionId);
                if (!runtime) {
                    return [disconnectedHint(path.connectionId)];
                }
                // §7.2 block-with-loading: the FIRST expand beyond the TTL
                // runs T1 validation within the preset's wait budget (the
                // tree's loading child covers the wait); within the TTL the
                // validated generation answers with zero SQL. The verdict
                // rides to the pure layer as facts — never silent-stale.
                // BOUNDED (dogfood 2026-07-10): lease acquisition can stall
                // behind a sleeping/serverless connection's backend work —
                // past the bound we render loading and the change stream
                // re-renders, keeping OTHER connections' expands independent.
                const fresh = await boundedWait(
                    runtime.coordinator.ensureDatabaseFresh(path.database),
                    this.deps.waits?.expandMs ?? EXPAND_WAIT_MS,
                );
                // B24: kick the LAZY aux sections this folder needs — the
                // change stream re-renders when rows land.
                for (const section of auxSectionsFor(path.folder)) {
                    void runtime.coordinator
                        .ensureDatabaseAuxSection(path.database, section)
                        .catch(() => undefined);
                }
                const status = runtime.coordinator.databaseStatus(path.database);
                const snapshot = runtime.coordinator.databaseSnapshot(path.database);
                const freshness = toFreshnessFacts(fresh);
                const scopeFacts = await this.databaseScopeFacts(path.connectionId, path.database);
                const auxiliary = runtime.coordinator.databaseAuxiliary(path.database);
                const children = databaseFolderChildren(
                    path.connectionId,
                    path.database,
                    path.folder,
                    status,
                    snapshot,
                    settings.groupBySchema,
                    path.kind === "schemaFolder" ? path.schema : undefined,
                    freshness,
                    scopeFacts,
                    auxiliary,
                );
                if (
                    path.kind === "databaseFolder" &&
                    settings.groupBySchema &&
                    this.folderFilters.has(node.id)
                ) {
                    const groupedChildren = new Map<string, OeV2Node[]>();
                    for (const child of children) {
                        if (child.path.kind !== "schemaFolder") {
                            continue;
                        }
                        groupedChildren.set(
                            child.id,
                            databaseFolderChildren(
                                path.connectionId,
                                path.database,
                                path.folder,
                                status,
                                snapshot,
                                true,
                                child.path.schema,
                                freshness,
                                scopeFacts,
                                auxiliary,
                            ),
                        );
                    }
                    return this.applyFolderFilter(node, children, groupedChildren);
                }
                return this.applyFolderFilter(
                    node,
                    children,
                    undefined,
                    path.kind !== "schemaFolder",
                );
            }
            case "object": {
                const runtime = this.runtimes.get(path.connectionId);
                if (runtime && path.objectKind === "table") {
                    // K3: nest the history table when facets know about one.
                    const items = runtime.coordinator
                        .databaseAuxiliary(path.database)
                        ?.items("tableFacets");
                    const mine = items?.find(
                        (item) => item.schema === path.schema && item.name === path.name,
                    );
                    const historyId = mine?.facts?.historyTableId ?? 0;
                    if (historyId > 0) {
                        const history = items?.find((item) => item.objectId === historyId);
                        if (history?.schema) {
                            return objectChildren(path, {
                                schema: history.schema,
                                name: history.name,
                            });
                        }
                    }
                }
                return objectChildren(path);
            }
            case "objectFolder": {
                const runtime = this.runtimes.get(path.connectionId);
                if (!runtime) {
                    return [disconnectedHint(path.connectionId)];
                }
                const fresh = await boundedWait(
                    runtime.coordinator.ensureDatabaseFresh(path.database),
                    this.deps.waits?.expandMs ?? EXPAND_WAIT_MS,
                );
                return objectFolderChildren(
                    path,
                    runtime.coordinator.databaseStatus(path.database),
                    runtime.coordinator.databaseSnapshot(path.database),
                    toFreshnessFacts(fresh),
                );
            }
            default:
                return [];
        }
    }

    dispose(): void {
        this.disposed = true;
        for (const connectionId of this.containerConnects.keys()) {
            this.cancelContainerConnect(connectionId);
        }
        this.registrySubscription?.dispose();
        for (const runtime of this.runtimes.values()) {
            runtime.clearTransientAuth?.();
            runtime.subscription.dispose();
            runtime.coordinator.dispose();
        }
        this.runtimes.clear();
        this.listeners.clear();
    }

    // -- internals ---------------------------------------------------------------

    /** K2 gating facts at database scope (system db → system folders/objects). */
    private async databaseScopeFacts(
        connectionId: string,
        database: string,
    ): Promise<OeV2ScopeFacts> {
        const base = await this.serverScopeFacts(connectionId);
        return {
            ...base,
            ...(isSystemDatabaseName(database) ? { isSystemDatabase: true } : {}),
        };
    }

    /**
     * K1 gating facts: an explicit profile database = database-scoped
     * connection (no server-level folders); Azure detection from the live
     * server facts once connected.
     */
    private async serverScopeFacts(connectionId: string): Promise<OeV2ScopeFacts> {
        const profile = await this.findProfile(connectionId);
        const edition = this.runtimes.get(connectionId)?.coordinator.serverView()
            ?.serverInfo?.engineEdition;
        const isAzure = edition !== undefined && (edition === "5" || /azure/i.test(edition));
        return {
            ...(profile?.stored.database ? { databaseScopedConnection: true } : {}),
            ...(isAzure ? { isAzure: true } : {}),
        };
    }

    private connectionFacts(profileId: string): ConnectionNodeFacts | undefined {
        const session = this.deps.sessions?.get(profileId);
        const activityText = this.containerActivity.get(profileId);
        if (this.containerConnects.has(profileId)) {
            return { state: "connecting", ...(activityText !== undefined ? { activityText } : {}) };
        }
        if (!session) {
            return activityText !== undefined ? { state: "disconnected", activityText } : undefined;
        }
        return {
            state: session.state,
            ...(session.serverVersion ? { serverVersion: session.serverVersion } : {}),
            ...(session.failureReason ? { failureReason: session.failureReason } : {}),
            ...(session.connectingForMs !== undefined
                ? { connectingForMs: session.connectingForMs }
                : {}),
            ...(activityText !== undefined ? { activityText } : {}),
        };
    }

    // -- docker containers (DOCK-2/3) -----------------------------------------

    /** Transient per-connection docker activity text (renders as description). */
    private readonly containerActivity = new Map<string, string>();

    private cancelContainerConnect(connectionId: string): void {
        this.profileLookupEpoch.set(
            connectionId,
            (this.profileLookupEpoch.get(connectionId) ?? 0) + 1,
        );
        const pending = this.containerConnects.get(connectionId);
        if (pending) {
            pending.cancellation.abort();
            this.containerConnects.delete(connectionId);
            this.setContainerActivity(connectionId, undefined);
        }
    }

    setContainerActivity(connectionId: string, text: string | undefined): void {
        if (this.disposed) {
            return;
        }
        if (text === undefined) {
            this.containerActivity.delete(connectionId);
        } else {
            this.containerActivity.set(connectionId, text);
        }
        this.fireChange();
    }

    /**
     * Container pre-flight (DOCK-3): a stopped container transparently
     * starts (Docker Desktop launch → container start → readiness wait)
     * BEFORE the data-plane open. BOUNDED by a backstop above the shared
     * core's own 300s readiness cap — a wedged docker daemon fails the node
     * with an honest reason, never an infinite spinner.
     */
    private async ensureContainerReady(
        connectionId: string,
        containerName: string,
        cancellation: AbortController,
    ): Promise<{ proceed: boolean; warning?: string }> {
        const containers = this.deps.containers;
        if (!containers) {
            return { proceed: true }; // no docker seam wired (tests/shell) — open directly
        }
        const span = diag.startSpan({
            feature: "objectExplorer",
            kind: "span",
            type: "objectExplorerV2.container.preflight",
            fields: {},
        });
        try {
            const outcome = await waitForContainerResult(
                containers
                    .restart(containerName, connectionId, cancellation.signal)
                    .then((value) => ({ value })),
                cancellation.signal,
                this.deps.waits?.containerPreflightMs ?? CONTAINER_PREFLIGHT_WAIT_MS,
            );
            if (cancellation.signal.aborted) {
                span.end("info", { result: { raw: "canceled", cls: "diagnostic.metadata" } });
                return { proceed: false };
            }
            if (outcome?.value === true) {
                span.end("ok");
                return { proceed: true };
            }
            const timedOut = outcome === undefined;
            if (!timedOut && outcome.value === undefined) {
                cancellation.abort();
                span.end("info", { result: { raw: "canceled", cls: "diagnostic.metadata" } });
                return { proceed: false };
            }
            const reason = timedOut
                ? ObjectExplorerV2.containerStartupTimedOut
                : ObjectExplorerV2.containerStartupFailed;
            if (timedOut) {
                cancellation.abort();
                this.deps.sessions?.recordPreparationFailure(
                    connectionId,
                    reason,
                    new Error(reason),
                );
            }
            span.end("error", {
                errorClass: {
                    raw: timedOut ? "preflightTimeout" : "preflightFailed",
                    cls: "diagnostic.metadata",
                },
            });
            return timedOut ? { proceed: false } : { proceed: true, warning: reason };
        } catch (error) {
            if (cancellation.signal.aborted) {
                span.end("info", { result: { raw: "canceled", cls: "diagnostic.metadata" } });
                return { proceed: false };
            }
            const reason = error instanceof Error ? error.message : String(error);
            span.end("error", {
                errorClass: { raw: "preflightError", cls: "diagnostic.metadata" },
            });
            return { proceed: true, warning: reason };
        }
    }

    /**
     * A container reports "ready" (its log line appears) a beat before SQL
     * Server will actually accept a session: during that boot window the
     * server briefly resets the pre-login endpoint (TCP "forcibly closed").
     * Real SQL clients ride this out with a short retry, so does the OE v2
     * open retries transport failures for container profiles. Only the
     * wizard's initial connection gets a brief login-initialization grace
     * period; ordinary saved profiles still fail fast on bad credentials.
     */
    private async openContainerSessionWithRetry(
        connectionId: string,
        prepared: PreparedConnection,
        signal: AbortSignal,
        freshContainer = false,
    ): Promise<OeV2ConnectionSession> {
        const sessions = this.deps.sessions!;
        const backoffMs =
            this.deps.waits?.containerOpenRetryBackoffMs ?? CONTAINER_OPEN_RETRY_BACKOFF_MS;
        const budgetMs =
            this.deps.waits?.containerOpenRetryBudgetMs ?? CONTAINER_OPEN_RETRY_BUDGET_MS;
        const startedAt = Date.now();
        const loginGraceMs = freshContainer
            ? (this.deps.waits?.containerLoginRetryGraceMs ?? 5_000)
            : 0;
        const retryable = (reason: string | undefined) =>
            isRetryableContainerOpenError(reason) ||
            (Date.now() - startedAt < loginGraceMs &&
                /^(?:Login failed for user\b|SQL authentication failed\.?$)/i.test(reason ?? ""));
        let session = await sessions.connect(connectionId, prepared, signal);
        let attempt = 0;
        while (
            !this.disposed &&
            !signal.aborted &&
            session.state === "failed" &&
            retryable(session.failureReason) &&
            Date.now() - startedAt < budgetMs
        ) {
            attempt++;
            const span = diag.startSpan({
                feature: "objectExplorer",
                kind: "span",
                type: "objectExplorerV2.container.openRetry",
                fields: { attempt: { raw: attempt, cls: "diagnostic.metadata" } },
            });
            await waitForContainerResult(undefined, signal, backoffMs);
            if (
                this.disposed ||
                signal.aborted ||
                Date.now() - startedAt >= budgetMs ||
                !retryable(session.failureReason)
            ) {
                span.end("info", {
                    result: {
                        raw: signal.aborted || this.disposed ? "canceled" : "exhausted",
                        cls: "diagnostic.metadata",
                    },
                });
                break;
            }
            session = await sessions.connect(connectionId, prepared, signal);
            span.end(session.state === "connected" ? "ok" : "info", {
                result: {
                    raw: session.state === "connected" ? "recovered" : "retrying",
                    cls: "diagnostic.metadata",
                },
            });
        }
        return session;
    }

    private async connectionChildren(connectionId: string): Promise<OeV2Node[]> {
        let state = this.deps.sessions?.stateOf(connectionId) ?? "disconnected";
        if (state === "disconnected" && !this.explicitlyDisconnected.has(connectionId)) {
            // Kick the connect with a SHORT bound (dogfood 2026-07-10): fast
            // servers still render their children in one pass; a sleeping
            // serverless keeps connecting in the background while THIS node
            // shows the spinner — the registry change stream re-renders on
            // completion, and other connections' expands never wait on it.
            await boundedWait(
                this.connectProfile(connectionId),
                this.deps.waits?.connectKickMs ?? CONNECT_KICK_WAIT_MS,
            );
            state = this.deps.sessions?.stateOf(connectionId) ?? "disconnected";
        }
        switch (state) {
            case "connected":
                return serverChildren(connectionId, await this.serverScopeFacts(connectionId));
            case "connecting":
            case "disconnecting":
                return [loadingNode(`connection/${connectionId}`, connectionId)];
            case "lost":
                return [
                    errorNode(
                        `connection/${connectionId}`,
                        ObjectExplorerV2.connectionLost,
                        connectionId,
                        "lost",
                    ),
                ];
            case "failed": {
                const reason = this.deps.sessions?.get(connectionId)?.failureReason;
                return [
                    errorNode(
                        `connection/${connectionId}`,
                        ObjectExplorerV2.connectFailed(reason ?? ObjectExplorerV2.unknownError),
                        connectionId,
                        "connectFailed",
                    ),
                ];
            }
            default: {
                const profile = await this.findProfile(connectionId);
                if (profile?.stored.containerName) {
                    return [
                        {
                            ...statusNode(
                                `connection/${connectionId}`,
                                ObjectExplorerV2.startContainer,
                                connectionId,
                            ),
                            connectionId,
                            containerName: profile.stored.containerName,
                            action: "startContainer",
                        },
                    ];
                }
                return [disconnectedHint(connectionId)];
            }
        }
    }

    private async rootLevel(): Promise<OeV2Node[]> {
        if (!this.deps.dataPlane.enabled()) {
            return [statusNode("dataPlane", ObjectExplorerV2.dataPlaneRequired)];
        }
        if (this.deps.dataPlane.availabilityState() === "unavailable") {
            return [statusNode("dataPlane", ObjectExplorerV2.dataPlaneUnavailable)];
        }
        const tree = await this.profileTree();
        const children = rootChildren(tree, (id) => this.connectionFacts(id));
        if (children.length === 0) {
            return [statusNode("root", ObjectExplorerV2.noSavedProfiles)];
        }
        return children;
    }

    /**
     * In-memory filter over an expanded folder's OBJECT nodes (status/error
     * children always pass through). A fully-filtered folder shows an honest
     * "no matches" note rather than pretending emptiness.
     */
    private applyFolderFilter(
        folderNode: OeV2Node,
        children: OeV2Node[],
        groupedChildren?: ReadonlyMap<string, OeV2Node[]>,
        includeSummary = true,
    ): OeV2Node[] {
        const filter = this.filterForNode(folderNode);
        if (!filter) {
            return children;
        }
        const needle = filter.toLowerCase();
        const matches = (child: OeV2Node): boolean =>
            child.kind === "object" &&
            (child.objectName ?? child.label).toLowerCase().includes(needle);
        const allObjects = groupedChildren
            ? [...groupedChildren.values()].flat().filter((child) => child.kind === "object")
            : children.filter((child) => child.kind === "object");
        const kept = groupedChildren
            ? children.filter(
                  (child) =>
                      child.kind !== "schema" ||
                      (groupedChildren.get(child.id)?.some(matches) ?? false),
              )
            : children.filter((child) => child.kind !== "object" || matches(child));
        const objectCount = allObjects.length;
        const keptCount = allObjects.filter(matches).length;
        if (keptCount === 0 && objectCount > 0) {
            return [
                statusNode(
                    `${folderNode.id}#filterEmpty`,
                    ObjectExplorerV2.noFilterMatches(filter),
                    folderNode.connectionId,
                ),
            ];
        }
        if (includeSummary && objectCount > 0) {
            kept.push(
                statusNode(
                    `${folderNode.id}#filterNote`,
                    ObjectExplorerV2.filterSummary(filter, keptCount, objectCount),
                    folderNode.connectionId,
                ),
            );
        }
        return kept;
    }

    /** Schema folders inherit the filter set on their database-folder parent. */
    private filterForNode(node: OeV2Node): string | undefined {
        const direct = this.folderFilters.get(node.id);
        if (direct || node.path.kind !== "schemaFolder") {
            return direct;
        }
        return this.folderFilters.get(
            encodePath({
                kind: "databaseFolder",
                connectionId: node.path.connectionId,
                database: node.path.database,
                folder: node.path.folder,
            }),
        );
    }

    private async findProfile(connectionId: string): Promise<OeV2ProfileRecord | undefined> {
        const tree = await this.profileTree();
        return tree.profiles.find((profile) => profile.profileId === connectionId);
    }

    private releaseRuntime(connectionId: string): void {
        const runtime = this.runtimes.get(connectionId);
        if (!runtime) {
            return;
        }
        runtime.subscription.dispose();
        runtime.clearTransientAuth?.();
        runtime.coordinator.dispose();
        this.runtimes.delete(connectionId);
    }

    /** Stored profile + database-sensitive fingerprint for the legacy handoff door. */
    async handoffFacts(
        connectionId: string,
    ): Promise<{ stored: Record<string, unknown>; fingerprint: string } | undefined> {
        const profile = await this.findProfile(connectionId);
        if (!profile) {
            return undefined;
        }
        // Use the same saved profile for both identity and payload: a live
        // session may still represent the old database during reconciliation.
        // This also supports h0 commands on disconnected profiles without
        // resolving any secrets; credential providers remain lazy.
        let prepared: PreparedConnection | undefined;
        if (this.deps.secrets) {
            try {
                prepared = prepareConnection(profile.stored, this.deps.secrets, this.deps.tokens);
            } catch {
                return undefined; // unsupported auth type
            }
        }
        if (!prepared) {
            return undefined;
        }
        return {
            stored: profile.stored as Record<string, unknown>,
            fingerprint: prepared.profileRef.profileFingerprint,
        };
    }

    private async profileTree(): Promise<OeV2ProfileTree> {
        if (!this.tree) {
            this.tree = await readProfileTree(this.deps.profiles);
        }
        return this.tree;
    }
}

/**
 * Expansion wait ceilings (dogfood 2026-07-10): freshness/lease work gets a
 * bound just above the oeBrowse 5s race budget (defense in depth against
 * stalls BELOW the policy race — e.g. lease acquisition queued behind a
 * sleeping serverless resume); the first-expand connect kick stays short so
 * fast servers render in one pass while slow ones show the spinner.
 */
const EXPAND_WAIT_MS = 6_000;
const CONNECT_KICK_WAIT_MS = 400;
/** DOCK-3 backstop ABOVE the docker core's 300s readiness cap: even a wedged
 *  dockerode call (npipe hang) fails the node honestly, never spins forever. */
const CONTAINER_PREFLIGHT_WAIT_MS = 360_000;

/**
 * A container can be *running yet not accepting connections* — its SQL Server
 * is mid-boot (the `alreadyRunning` pre-flight short-circuit is v1-correct, but
 * "running" ≠ "ready"). This happens on a full cold boot (docker auto-start on
 * machine login, or a restart raced by another connect). The open then retries
 * on the transient reset until SQL is up. Bound by wall-clock, not attempt
 * count, because each failed open itself takes a variable moment; 60s covers a
 * cold SQL Server boot and is well under the 300s readiness-log ceiling.
 */
const CONTAINER_OPEN_RETRY_BUDGET_MS = 60_000;
const CONTAINER_OPEN_RETRY_BACKOFF_MS = 2_000;

/**
 * True only for the transient errors a still-booting SQL container throws —
 * transport/pre-login resets, "server not currently available". Explicitly
 * NOT "Login failed" (a wrong password must fail fast, not retry for 10s).
 */
function isRetryableContainerOpenError(reason: string | undefined): boolean {
    if (!reason || /login failed|password|certificate|authentication/i.test(reason)) {
        return false;
    }
    return /pre-login handshake|forcibly closed|transport-level|being established|actively refused|not currently available|semaphore timeout/i.test(
        reason,
    );
}

/** Stop waiting immediately on cancellation; observe late errors without reviving the attempt. */
function waitForContainerResult<T>(
    promise: Promise<T> | undefined,
    signal: AbortSignal,
    ms: number,
): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", cancelled);
        };
        const cancelled = () => {
            cleanup();
            resolve(undefined);
        };
        const timer = setTimeout(cancelled, ms);
        signal.addEventListener("abort", cancelled, { once: true });
        promise?.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            },
        );
        if (signal.aborted) {
            cancelled();
        }
    });
}

/**
 * Race a promise against a ceiling: undefined past the deadline, and the
 * underlying work always continues (its completion drives change events).
 * Rejections resolve undefined too — expansion renders current state.
 */
async function boundedWait<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
        (timer as { unref?: () => void }).unref?.();
    });
    try {
        return await Promise.race([work.catch(() => undefined), deadline]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

/** Aux sections a database folder's expand must lazily hydrate (B24). */
function auxSectionsFor(folderId: string): string[] {
    const def = folderDef("database", folderId);
    if (!def) {
        return [];
    }
    if (def.id === "tables") {
        return ["tableFacets"];
    }
    if (def.id === "views") {
        return ["viewFacets"];
    }
    if (
        def.special !== undefined ||
        def.section === "objects" ||
        def.section === "synonyms" ||
        def.section === "aux"
    ) {
        return [];
    }
    return [def.section];
}

function disconnectedHint(connectionId: string) {
    return statusNode(`connection/${connectionId}`, ObjectExplorerV2.connectHint, connectionId);
}

/** Map the ensureFresh verdict onto the pure layer's data-only facts. */
function toFreshnessFacts(fresh: FreshCatalogResult | undefined): OeV2FreshnessFacts | undefined {
    if (!fresh) {
        return undefined;
    }
    return {
        freshness: fresh.freshness,
        ...(fresh.validation?.staleReason ? { staleReason: fresh.validation.staleReason } : {}),
    };
}
