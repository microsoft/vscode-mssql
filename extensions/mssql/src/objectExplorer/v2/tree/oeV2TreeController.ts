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

import {
    PreparedConnection,
    prepareConnection,
    ProfileSecretSource,
} from "../../../services/metadata/profileAuthAdapter";
import { OeV2MetadataCoordinator } from "../metadata/oeV2MetadataCoordinator";
import {
    ConnectionProfileSource,
    OeV2ProfileRecord,
    OeV2ProfileTree,
    readProfileTree,
} from "../sessions/oeV2ProfileAdapter";
import { OeV2SessionRegistry } from "../sessions/oeV2SessionRegistry";
import {
    databaseChildren,
    databaseFolderChildren,
    databasesFolderChildren,
    objectChildren,
    objectFolderChildren,
    OeV2FreshnessFacts,
    serverAuxFolderChildren,
    serverChildren,
} from "./oeV2Browse";
import { folderDef, isSystemDatabaseName, OeV2ScopeFacts, resolveFolders } from "./oeV2Hierarchy";
import type { FreshCatalogResult } from "../../../services/metadata/cache/metadataFreshness";
import { CatalogLanguageMetadataProvider } from "../../../sqlLanguage/provider/catalogProvider";
import { createStrictScriptingService } from "../../../sqlLanguage/host/scriptingHost";
import type { ScriptOperation } from "../../../sqlScripting/api";
import { OeV2Node } from "./oeV2Node";
import { childrenOfGroup, ConnectionNodeFacts, rootChildren } from "./oeV2NodeFactory";
import { errorNode, loadingNode, statusNode } from "./oeV2Readiness";

export interface DataPlaneProbe {
    enabled(): boolean;
    availabilityState(): "unknown" | "available" | "unavailable";
}

export interface OeV2BrowseSettings {
    readonly groupBySchema: boolean;
    readonly showSystemDatabases: boolean;
}

export interface OeV2TreeControllerDeps {
    readonly profiles: ConnectionProfileSource;
    readonly dataPlane: DataPlaneProbe;
    /** B18 browse deps — absent means shell-only behavior (B17 tests). */
    readonly secrets?: ProfileSecretSource;
    readonly sessions?: OeV2SessionRegistry;
    readonly coordinatorFactory?: (prepared: PreparedConnection) => OeV2MetadataCoordinator;
    readonly settings?: () => OeV2BrowseSettings;
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
        const { sessions, secrets, coordinatorFactory } = this.deps;
        if (!sessions || !secrets || !coordinatorFactory) {
            return false;
        }
        const profile = await this.findProfile(connectionId);
        if (!profile) {
            return false;
        }
        const prepared = prepareConnection(profile.stored, secrets);
        const session = await sessions.connect(connectionId, prepared);
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

    async children(node?: OeV2Node): Promise<OeV2Node[]> {
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
                    // answers instantly. Pin once per expand (below).
                    const serverFresh = await runtime.coordinator
                        .ensureServerFresh()
                        .catch(() => undefined);
                    return databasesFolderChildren(
                        path.connectionId,
                        runtime.coordinator.serverStatus(),
                        runtime.coordinator.serverView(),
                        settings.showSystemDatabases,
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
                const fresh = await runtime.coordinator
                    .ensureDatabaseFresh(path.database)
                    .catch(() => undefined);
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
                const fresh = await runtime.coordinator
                    .ensureDatabaseFresh(path.database)
                    .catch(() => undefined);
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
        if (!session) {
            return undefined;
        }
        return {
            state: session.state,
            ...(session.serverVersion ? { serverVersion: session.serverVersion } : {}),
            ...(session.failureReason ? { failureReason: session.failureReason } : {}),
        };
    }

    private async connectionChildren(connectionId: string): Promise<OeV2Node[]> {
        let state = this.deps.sessions?.stateOf(connectionId) ?? "disconnected";
        if (state === "disconnected" && !this.explicitlyDisconnected.has(connectionId)) {
            await this.connectProfile(connectionId);
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
