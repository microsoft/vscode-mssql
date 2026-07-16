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
import type { FreshCatalogResult } from "../../../services/metadata/cache/metadataFreshness";
import { CatalogLanguageMetadataProvider } from "../../../sqlLanguage/provider/catalogProvider";
import { createStrictScriptingService } from "../../../sqlLanguage/host/scriptingHost";
import type { ScriptOperation } from "../../../sqlScripting/api";
import { OeV2Node } from "./oeV2Node";
import { childrenOfGroup, ConnectionNodeFacts, rootChildren } from "./oeV2NodeFactory";
import { errorNode, loadingNode, noItemsNode, statusNode } from "./oeV2Readiness";

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
    restart(containerName: string, connectionId: string): Promise<boolean>;
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
    };
}

interface ConnectionRuntime {
    prepared: PreparedConnection;
    coordinator: OeV2MetadataCoordinator;
    subscription: { dispose(): void };
}

const DEFAULT_SETTINGS: OeV2BrowseSettings = { groupBySchema: false, showSystemDatabases: true };

export class OeV2TreeController {
    private tree: OeV2ProfileTree | undefined;
    private listeners = new Set<(node?: OeV2Node) => void>();
    private runtimes = new Map<string, ConnectionRuntime>();
    private explicitlyDisconnected = new Set<string>();
    private registrySubscription: { dispose(): void } | undefined;

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
    ): Promise<{ schema: string; name: string; kind: string }[]> {
        const runtime = this.runtimes.get(connectionId);
        if (!runtime) {
            return [];
        }
        await runtime.coordinator.ensureDatabase(database).catch(() => undefined);
        const snapshot = runtime.coordinator.databaseSnapshot(database);
        if (!snapshot) {
            return [];
        }
        return snapshot
            .search(term, limit)
            .map((info) => ({ schema: info.schema, name: info.name, kind: info.kind }));
    }

    async scriptObject(
        node: OeV2Node,
        operation: Extract<ScriptOperation, "create" | "drop" | "execute">,
        offlineMode: boolean,
    ): Promise<{ script?: string; error?: string }> {
        if (!node.connectionId || !node.database || !node.schema || !node.objectName) {
            return { error: "Select a database object to script." };
        }
        const runtime = this.runtimes.get(node.connectionId);
        if (!runtime) {
            return { error: "Connect this profile in Object Explorer v2 first." };
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
                script: `-- Cannot script ${node.schema}.${node.objectName}: object is not present in the current metadata snapshot.\r\n`,
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
    async connectProfile(connectionId: string): Promise<boolean> {
        this.explicitlyDisconnected.delete(connectionId);
        const { sessions, secrets, tokens, coordinatorFactory } = this.deps;
        if (!sessions || !secrets || !coordinatorFactory) {
            return false;
        }
        const profile = await this.findProfile(connectionId);
        if (!profile) {
            return false;
        }
        // Container pre-flight (DOCK-3): stopped containers start before the
        // data-plane open, exactly like v1's expand-while-stopped behavior.
        if (profile.stored.containerName) {
            const ready = await this.ensureContainerReady(
                connectionId,
                profile.stored.containerName,
            );
            if (!ready) {
                return false;
            }
        }
        let prepared: PreparedConnection;
        try {
            prepared = prepareConnection(profile.stored, secrets, tokens);
        } catch (error) {
            sessions.recordPreparationFailure(
                connectionId,
                error instanceof Error ? error.message : "Connection profile preparation failed.",
                error,
            );
            return false;
        }
        const session = profile.stored.containerName
            ? await this.openContainerSessionWithRetry(connectionId, prepared)
            : await sessions.connect(connectionId, prepared);
        if (session.state !== "connected") {
            return false;
        }
        if (!this.runtimes.has(connectionId)) {
            const coordinator = coordinatorFactory(prepared);
            const subscription = coordinator.onDidChange(() => this.fireChange());
            this.runtimes.set(connectionId, { prepared, coordinator, subscription });
            // Kick the server catalog so Databases is warm by first expand.
            void coordinator.ensureServer().catch(() => undefined);
        }
        return true;
    }

    /**
     * Cancel an in-flight connect. The node returns to disconnected at once;
     * the pending open self-supersedes when its deadline settles it.
     */
    cancelConnect(connectionId: string): void {
        this.deps.sessions?.cancelConnect(connectionId);
        this.explicitlyDisconnected.add(connectionId);
    }

    async disconnectProfile(connectionId: string): Promise<void> {
        const runtime = this.runtimes.get(connectionId);
        if (runtime) {
            runtime.subscription.dispose();
            runtime.coordinator.dispose();
            this.runtimes.delete(connectionId);
        }
        await this.deps.sessions?.disconnect(connectionId);
        this.explicitlyDisconnected.add(connectionId);
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
                    `Expansion failed: ${error instanceof Error ? error.message : String(error)}. Refresh to retry.`,
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
                const children = databaseFolderChildren(
                    path.connectionId,
                    path.database,
                    path.folder,
                    runtime.coordinator.databaseStatus(path.database),
                    runtime.coordinator.databaseSnapshot(path.database),
                    settings.groupBySchema,
                    path.kind === "schemaFolder" ? path.schema : undefined,
                    toFreshnessFacts(fresh),
                    await this.databaseScopeFacts(path.connectionId, path.database),
                    runtime.coordinator.databaseAuxiliary(path.database),
                );
                return this.applyFolderFilter(node, children);
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
        this.registrySubscription?.dispose();
        for (const runtime of this.runtimes.values()) {
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

    setContainerActivity(connectionId: string, text: string | undefined): void {
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
    ): Promise<boolean> {
        const containers = this.deps.containers;
        if (!containers) {
            return true; // no docker seam wired (tests/shell) — open directly
        }
        const span = diag.startSpan({
            feature: "objectExplorer",
            kind: "span",
            type: "objectExplorerV2.container.preflight",
            fields: {},
        });
        try {
            const outcome = await boundedWait(
                containers.restart(containerName, connectionId),
                this.deps.waits?.containerPreflightMs ?? CONTAINER_PREFLIGHT_WAIT_MS,
            );
            if (outcome === true) {
                span.end("ok");
                return true;
            }
            const timedOut = outcome === undefined;
            const reason = timedOut
                ? "The SQL container did not become ready in time — Docker may be unresponsive."
                : "The SQL container could not be started. Check the Docker logs and try again.";
            this.deps.sessions?.recordPreparationFailure(connectionId, reason, new Error(reason));
            span.end("error", {
                errorClass: {
                    raw: timedOut ? "preflightTimeout" : "preflightFailed",
                    cls: "diagnostic.metadata",
                },
            });
            return false;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.deps.sessions?.recordPreparationFailure(connectionId, reason, error);
            span.end("error", {
                errorClass: { raw: "preflightError", cls: "diagnostic.metadata" },
            });
            return false;
        } finally {
            this.setContainerActivity(connectionId, undefined);
        }
    }

    /**
     * A container reports "ready" (its log line appears) a beat before SQL
     * Server will actually accept a session: during that boot window the
     * server briefly resets the pre-login endpoint (TCP "forcibly closed").
     * Real SQL clients ride this out with a short retry, so does the OE v2
     * open — but ONLY for container profiles and ONLY on transient startup
     * errors, so a genuine failure (wrong password → "Login failed") still
     * surfaces on the first attempt. v1's shared restart/readiness path is
     * untouched; this resilience lives entirely in the v2 open.
     */
    private async openContainerSessionWithRetry(
        connectionId: string,
        prepared: PreparedConnection,
    ): Promise<OeV2ConnectionSession> {
        const sessions = this.deps.sessions!;
        const backoffMs =
            this.deps.waits?.containerOpenRetryBackoffMs ?? CONTAINER_OPEN_RETRY_BACKOFF_MS;
        const budgetMs =
            this.deps.waits?.containerOpenRetryBudgetMs ?? CONTAINER_OPEN_RETRY_BUDGET_MS;
        const startedAt = Date.now();
        let session = await sessions.connect(connectionId, prepared);
        let attempt = 0;
        while (
            session.state !== "connected" &&
            isRetryableContainerOpenError(session.failureReason) &&
            Date.now() - startedAt < budgetMs
        ) {
            attempt++;
            const span = diag.startSpan({
                feature: "deployment",
                kind: "span",
                type: "objectExplorerV2.container.openRetry",
                fields: { attempt: { raw: attempt, cls: "diagnostic.metadata" } },
            });
            await delay(backoffMs);
            session = await sessions.connect(connectionId, prepared);
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
                        "Connection lost. Reconnect from the context menu.",
                        connectionId,
                        "lost",
                    ),
                ];
            case "failed": {
                const reason = this.deps.sessions?.get(connectionId)?.failureReason;
                return [
                    errorNode(
                        `connection/${connectionId}`,
                        `Connect failed: ${reason ?? "unknown error"}.`,
                        connectionId,
                        "connectFailed",
                    ),
                ];
            }
            default:
                return [disconnectedHint(connectionId)];
        }
    }

    private async rootLevel(): Promise<OeV2Node[]> {
        if (!this.deps.dataPlane.enabled()) {
            return [
                statusNode(
                    "dataPlane",
                    "Object Explorer v2 requires the SQL Data Plane. Enable mssql.sqlDataPlane.enabled, then reload.",
                ),
            ];
        }
        const tree = await this.profileTree();
        const children = rootChildren(tree, (id) => this.connectionFacts(id));
        if (children.length === 0) {
            return [
                statusNode(
                    "root",
                    "No saved connection profiles. Create one with 'MS SQL: Add Connection'.",
                ),
            ];
        }
        return children;
    }

    /**
     * In-memory filter over an expanded folder's OBJECT nodes (status/error
     * children always pass through). A fully-filtered folder shows an honest
     * "no matches" note rather than pretending emptiness.
     */
    private applyFolderFilter(folderNode: OeV2Node, children: OeV2Node[]): OeV2Node[] {
        const filter = this.folderFilters.get(folderNode.id);
        if (!filter) {
            return children;
        }
        const needle = filter.toLowerCase();
        const kept = children.filter(
            (child) =>
                (child.kind !== "object" && child.kind !== "schema") ||
                (child.objectName ?? child.label).toLowerCase().includes(needle),
        );
        const objectCount = children.filter((child) => child.kind === "object").length;
        const keptCount = kept.filter((child) => child.kind === "object").length;
        if (keptCount === 0 && objectCount > 0) {
            return [
                statusNode(
                    `${folderNode.id}#filterEmpty`,
                    `No matches for filter '${filter}'. Use Clear Filters to remove it.`,
                    folderNode.connectionId,
                ),
            ];
        }
        if (objectCount > 0) {
            kept.push(
                statusNode(
                    `${folderNode.id}#filterNote`,
                    `Filter: '${filter}' (${keptCount} of ${objectCount} shown)`,
                    folderNode.connectionId,
                ),
            );
        }
        return kept;
    }

    private async findProfile(connectionId: string): Promise<OeV2ProfileRecord | undefined> {
        const tree = await this.profileTree();
        return tree.profiles.find((profile) => profile.profileId === connectionId);
    }

    /** Stored profile + server fingerprint for the legacy handoff door. */
    async handoffFacts(
        connectionId: string,
    ): Promise<{ stored: Record<string, unknown>; fingerprint: string } | undefined> {
        const profile = await this.findProfile(connectionId);
        const prepared = this.deps.sessions?.get(connectionId)?.prepared;
        if (!profile || !prepared) {
            return undefined;
        }
        return {
            stored: profile.stored as Record<string, unknown>,
            fingerprint: prepared.serverFingerprint,
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
    if (!reason) {
        return false;
    }
    return /pre-login handshake|forcibly closed|transport-level|being established|actively refused|not currently available|error occurred (while|during)|semaphore timeout/i.test(
        reason,
    );
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        (timer as { unref?: () => void }).unref?.();
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
    return statusNode(
        `connection/${connectionId}`,
        "Use 'Connect' on this profile to browse (OE v2 preview).",
        connectionId,
    );
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
