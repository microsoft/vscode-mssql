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
 * (failure ≠ emptiness); connect is EXPLICIT (no auto-connect-on-expand).
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
    serverChildren,
} from "./oeV2Browse";
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

    // -- commands (wired by activation) ---------------------------------------

    /** Explicit connect: opens the data-plane session + metadata coordinator. */
    async connectProfile(connectionId: string): Promise<boolean> {
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
    }

    /** Route a refresh request to the right lease scope. */
    async refreshNode(node: OeV2Node): Promise<void> {
        const runtime = node.connectionId ? this.runtimes.get(node.connectionId) : undefined;
        if (!runtime) {
            this.refresh();
            return;
        }
        switch (node.path.kind) {
            case "serverFolder":
            case "connection":
                await runtime.coordinator.refreshServer().catch(() => undefined);
                break;
            case "database":
            case "databaseFolder":
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
                // Pin once per expand.
                void runtime.coordinator.ensureServer().catch(() => undefined);
                return databasesFolderChildren(
                    path.connectionId,
                    runtime.coordinator.serverStatus(),
                    runtime.coordinator.serverView(),
                    settings.showSystemDatabases,
                );
            }
            case "database": {
                const runtime = this.runtimes.get(path.connectionId);
                if (!runtime) {
                    return [disconnectedHint(path.connectionId)];
                }
                // Lazy lease acquisition on database expand (design §10.5).
                void runtime.coordinator.ensureDatabase(path.database).catch(() => undefined);
                return databaseChildren(path.connectionId, path.database);
            }
            case "databaseFolder":
            case "schemaFolder": {
                const runtime = this.runtimes.get(path.connectionId);
                if (!runtime) {
                    return [disconnectedHint(path.connectionId)];
                }
                void runtime.coordinator.ensureDatabase(path.database).catch(() => undefined);
                return databaseFolderChildren(
                    path.connectionId,
                    path.database,
                    path.folder,
                    runtime.coordinator.databaseStatus(path.database),
                    runtime.coordinator.databaseSnapshot(path.database),
                    settings.groupBySchema,
                    path.kind === "schemaFolder" ? path.schema : undefined,
                );
            }
            case "object":
                return objectChildren(path);
            case "objectFolder": {
                const runtime = this.runtimes.get(path.connectionId);
                if (!runtime) {
                    return [disconnectedHint(path.connectionId)];
                }
                return objectFolderChildren(
                    path,
                    runtime.coordinator.databaseStatus(path.database),
                    runtime.coordinator.databaseSnapshot(path.database),
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
        const state = this.deps.sessions?.stateOf(connectionId) ?? "disconnected";
        switch (state) {
            case "connected":
                return serverChildren(connectionId);
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

    private async findProfile(connectionId: string): Promise<OeV2ProfileRecord | undefined> {
        const tree = await this.profileTree();
        return tree.profiles.find((profile) => profile.profileId === connectionId);
    }

    private async profileTree(): Promise<OeV2ProfileTree> {
        if (!this.tree) {
            this.tree = await readProfileTree(this.deps.profiles);
        }
        return this.tree;
    }
}

function disconnectedHint(connectionId: string) {
    return statusNode(
        `connection/${connectionId}`,
        "Use 'Connect' on this profile to browse (OE v2 preview).",
        connectionId,
    );
}
