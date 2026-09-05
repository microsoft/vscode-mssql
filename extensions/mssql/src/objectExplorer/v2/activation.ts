/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 activation (V2-0/V2-2): registers the preview tree view only when
 * the host-provided private-preview gate is effective, composes the session
 * registry + shared-MetadataStore coordinators, and wires connect/disconnect
 * commands. Once composed, disabling fails closed immediately and subsequent
 * config changes can re-register the view; enabling it for the first time
 * still requires a window reload because MainController does not compose this
 * private-preview module while its activation snapshot is false. All connects
 * go through the data plane — never ConnectionManager (lint + spy enforced).
 */

import * as vscode from "vscode";
import { IInstantiationService } from "extension-toolkit/base";
import { diag } from "../../diagnostics/diagnosticsCore";
import { Perf } from "../../perf/perfTelemetry";
import { MetadataStoreService } from "../../services/metadata/metadataStoreService";
import {
    ProfileSecretSource,
    ProfileTokenSource,
    stableProfileId,
} from "../../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../../services/sqlDataPlane/sqlDataPlaneService";
import { vscodeFallbackInteraction } from "../../services/sqlDataPlane/vscodeFallbackInteraction";
import type { IConnectionProfile } from "../../models/interfaces";
import type { IConnectionStore } from "../../models/connectionStore";
import { ObjectExplorerV2Provider } from "./objectExplorerV2Provider";
import { OeV2MetadataCoordinator } from "./metadata/oeV2MetadataCoordinator";
import { oeV2Settings } from "./settings";
import { ConnectionProfileSource, readProfileTree } from "./sessions/oeV2ProfileAdapter";
import { OeV2SessionRegistry } from "./sessions/oeV2SessionRegistry";
import { registerOeV2NativeCommands } from "./commands/oeV2NativeCommands";
import {
    HandoffConnectionSeam,
    OeV2ClassicHandoffService,
} from "./legacy/oeV2ClassicHandoffService";
import { OE_V2_COMMANDS } from "./commands/oeV2CommandRegistry";
import { OeV2DragAndDropController, registerOeV2GroupCommands } from "./commands/oeV2GroupCommands";
import { redirectToClassic } from "./legacy/oeV2LegacyRedirect";
import { ConnectionConfig } from "../../connectionconfig/connectionconfig";
import { ObjectExplorer, ObjectExplorerV2 } from "../../constants/locConstants";
import { OeV2Node } from "./tree/oeV2Node";
import { OeV2TreeController } from "./tree/oeV2TreeController";

export interface OeV2ActivationDeps {
    readonly instantiationService: IInstantiationService;
    readonly profiles: ConnectionProfileSource &
        ProfileSecretSource &
        Pick<IConnectionStore, "removeProfile">;
    readonly tokens?: ProfileTokenSource;
    /** Classic connection seam for the EXPLICIT legacy handoff door (B20). */
    readonly legacyConnections?: HandoffConnectionSeam;
    /** Shared group storage (B26): the classic ConnectionConfig instance. */
    readonly groupConfig?: () => ConnectionConfig | undefined;
    /** Live private-preview gate: umbrella + SQL Data Plane + OE v2. */
    readonly isEnabled: () => boolean;
}

export function activateObjectExplorerV2(
    context: vscode.ExtensionContext,
    deps: OeV2ActivationDeps,
): void {
    let registration: vscode.Disposable | undefined;
    let controller: OeV2TreeController | undefined;
    let registry: OeV2SessionRegistry | undefined;
    let handoff: OeV2ClassicHandoffService | undefined;
    let activeView: vscode.TreeView<OeV2Node> | undefined;
    let statusChannel: vscode.OutputChannel | undefined;

    const removeSavedProfile = async (connectionId: string): Promise<void> => {
        const profile = (await deps.profiles.readAllConnections(false)).find(
            (candidate) => stableProfileId(candidate as never) === connectionId,
        );
        if (profile) {
            // ConnectionStore owns the complete removal contract: settings,
            // MRU history, and any saved credential.
            await deps.profiles.removeProfile(profile as IConnectionProfile, false);
        }
    };
    const register = () => {
        if (registration || !deps.isEnabled()) {
            return;
        }
        registry = new OeV2SessionRegistry((params) =>
            SqlDataPlaneService.get().openSessionWithFallback(
                params,
                undefined,
                vscodeFallbackInteraction(),
            ),
        );
        controller = new OeV2TreeController({
            profiles: deps.profiles,
            secrets: deps.profiles,
            tokens: deps.tokens,
            dataPlane: {
                enabled: () => SqlDataPlaneService.get().enabled,
                availabilityState: () => SqlDataPlaneService.get().availability().state,
            },
            sessions: registry,
            coordinatorFactory: (prepared) =>
                new OeV2MetadataCoordinator(MetadataStoreService.get().store(), prepared),
            settings: () => {
                const settings = oeV2Settings();
                return {
                    groupBySchema: settings.groupBySchema,
                    showSystemDatabases: settings.showSystemDatabases,
                };
            },
        });
        const provider = new ObjectExplorerV2Provider(controller);
        const view = vscode.window.createTreeView("mssql.objectExplorerV2", {
            treeDataProvider: provider,
            showCollapseAll: true,
            // B26 (K5): connections into groups, groups re-parent — same
            // shared storage as classic, v2-only MIME.
            ...(deps.groupConfig
                ? {
                      dragAndDropController: new OeV2DragAndDropController(
                          deps.groupConfig ?? (() => undefined),
                          deps.isEnabled,
                      ),
                  }
                : {}),
        });
        // Legacy commands hand off silently — v1/v2 connections coexisting is
        // the normal state for older features; the Debug Console surfaces both.
        handoff = deps.legacyConnections
            ? new OeV2ClassicHandoffService(deps.legacyConnections)
            : undefined;
        const localRegistry = registry;
        const localController = controller;
        const localHandoff = handoff;
        activeView = view;
        registration = vscode.Disposable.from(view, provider, {
            dispose: () => {
                localController.dispose();
                localRegistry.dispose();
                localHandoff?.dispose();
            },
        });
        diag.emit({
            feature: "objectExplorer",
            kind: "event",
            type: "objectExplorerV2.view.activate",
            fields: { enabled: { raw: true, cls: "diagnostic.metadata" } },
        });
    };

    const unregister = () => {
        registration?.dispose();
        registration = undefined;
        controller = undefined;
        registry = undefined;
        handoff = undefined;
        activeView = undefined;
    };

    if (deps.isEnabled()) {
        register();
    }

    registerOeV2NativeCommands(
        context,
        () => controller,
        // Ctrl+C keybinding parity: fall back to the focused tree selection.
        () => activeView?.selection[0],
        deps.isEnabled,
    );

    // B27: while any connection is opening/closing, tick the tree so the
    // slow-connect elapsed description ("connecting… (12s)") stays live.
    const connectingTicker = setInterval(() => {
        if (registry?.anyConnecting()) {
            void controller?.refreshTransientConnections();
        }
    }, 2000);
    (connectingTicker as { unref?: () => void }).unref?.();
    context.subscriptions.push({ dispose: () => clearInterval(connectingTicker) });

    // PERF_MODE-only browse probe (design 04 §17.4 pattern): connect the
    // single provisioned profile and expand to a rendered Databases list.
    // Throws on any honesty failure so the harness records a real error.
    if (Perf.enabled) {
        context.subscriptions.push(
            vscode.commands.registerCommand("mssql.perf.objectExplorerV2Browse", async () => {
                if (!controller) {
                    throw new Error("OE v2 is not registered (check private-preview settings)");
                }
                const roots = await controller.children();
                const connection = roots.find((node) => node.path.kind === "connection");
                if (!connection?.connectionId) {
                    throw new Error("no saved profile visible in OE v2");
                }
                if (!(await controller.connectProfile(connection.connectionId))) {
                    throw new Error("OE v2 data-plane connect failed");
                }
                const afterConnect = await controller.children();
                const server = afterConnect.find((node) => node.kind === "connectedServer");
                if (!server) {
                    throw new Error("no connected server node after connect");
                }
                const [databasesFolder] = await controller.children(server);
                await controller.refreshNode(databasesFolder); // await catalog
                const databases = (await controller.children(databasesFolder)).filter(
                    (node) => node.kind === "database",
                );
                if (databases.length === 0) {
                    throw new Error("no databases rendered from the server catalog");
                }
                return { databases: databases.length };
            }),
            // B27: server-level aux browse probe — connect, expand Security →
            // Logins, and wait for REAL items from the lazy section (throws
            // on every honesty failure; loading resolves via re-poll).
            vscode.commands.registerCommand(
                "mssql.perf.objectExplorerV2SecurityExpand",
                async () => {
                    if (!controller) {
                        throw new Error("OE v2 is not registered (check private-preview settings)");
                    }
                    const roots = await controller.children();
                    const connection = roots.find((node) => node.path.kind === "connection");
                    if (!connection?.connectionId) {
                        throw new Error("no saved profile visible in OE v2");
                    }
                    if (!(await controller.connectProfile(connection.connectionId))) {
                        throw new Error("OE v2 data-plane connect failed");
                    }
                    const server = (await controller.children()).find(
                        (node) => node.kind === "connectedServer",
                    );
                    if (!server) {
                        throw new Error("no connected server node after connect");
                    }
                    const security = (await controller.children(server)).find(
                        (node) =>
                            node.path.kind === "serverFolder" && node.path.folder === "security",
                    );
                    if (!security) {
                        throw new Error("no Security folder on a server-scoped connection");
                    }
                    const logins = (await controller.children(security)).find(
                        (node) =>
                            node.path.kind === "serverFolder" &&
                            node.path.folder === "security/logins",
                    );
                    if (!logins) {
                        throw new Error("no Logins folder under Security");
                    }
                    const deadline = Date.now() + 15_000;
                    for (;;) {
                        const children = await controller.children(logins);
                        const error = children.find((node) => node.kind === "error");
                        if (error) {
                            throw new Error(`Logins section failed: ${error.label}`);
                        }
                        const items = children.filter((node) => node.kind === "serverObject");
                        if (items.length > 0) {
                            return { logins: items.length };
                        }
                        if (children.some((node) => node.kind === "noItems")) {
                            throw new Error("Logins rendered empty — a real server has logins");
                        }
                        if (Date.now() > deadline) {
                            throw new Error("Logins section did not hydrate within 15s");
                        }
                        await new Promise((resolve) => setTimeout(resolve, 100));
                    }
                },
            ),
        );
    }

    const connectionIdOf = (node: OeV2Node | undefined): string | undefined =>
        node?.connectionId ??
        (node?.path.kind === "connection" ? node.path.connectionId : undefined);

    // B26 (K-cross UX): when exactly ONE new saved profile appears — the New
    // Connection dialog finished, whichever view's button launched it — v2
    // auto-connects it too ("connect them both"). Bulk settings edits (2+
    // new profiles at once) deliberately stay disconnected.
    let knownProfileIds: Set<string> | undefined;
    const snapshotProfiles = async (): Promise<Set<string>> => {
        const tree = await readProfileTree(deps.profiles);
        return new Set(tree.profiles.map((profile) => profile.profileId));
    };
    void snapshotProfiles().then((ids) => (knownProfileIds = ids));
    const autoConnectNewProfile = async () => {
        const current = await snapshotProfiles();
        const previous = knownProfileIds;
        knownProfileIds = current;
        if (!previous || !controller) {
            return;
        }
        const added = [...current].filter((id) => !previous.has(id));
        if (added.length === 1) {
            void controller.connectProfile(added[0]).catch(() => undefined);
        }
    };

    context.subscriptions.push(
        registerOeV2GroupCommands({
            instantiationService: deps.instantiationService,
            groupConfig: deps.groupConfig ?? (() => undefined),
            isEnabled: deps.isEnabled,
            beforeDeleteConnection: async (connectionId) => {
                await handoff?.close(connectionId);
                await controller?.disconnectProfile(connectionId);
            },
        }),
        // B26: view-title New Connection — the SHARED classic dialog; the
        // config watcher's single-new-profile rule connects it in v2.
        vscode.commands.registerCommand("mssql.objectExplorerV2.addConnection", () => {
            if (!deps.isEnabled()) {
                return;
            }
            return vscode.commands.executeCommand("mssql.addObjectExplorer");
        }),
        // v1-parity toolbar toggle: flips the v2 setting; the config watcher
        // below refreshes the tree (mssql.objectExplorer.v2 scope).
        vscode.commands.registerCommand("mssql.objectExplorerV2.enableGroupBySchema", () => {
            if (!deps.isEnabled()) {
                return;
            }
            return vscode.workspace
                .getConfiguration()
                .update("mssql.objectExplorer.v2.groupBySchema", true, true);
        }),
        vscode.commands.registerCommand("mssql.objectExplorerV2.disableGroupBySchema", () => {
            if (!deps.isEnabled()) {
                return;
            }
            return vscode.workspace
                .getConfiguration()
                .update("mssql.objectExplorer.v2.groupBySchema", false, true);
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration("mssql.enableExperimentalFeatures") ||
                event.affectsConfiguration("mssql.sqlDataPlane.enabled") ||
                event.affectsConfiguration("mssql.objectExplorer.v2.enabled")
            ) {
                if (deps.isEnabled()) {
                    register();
                } else {
                    unregister();
                }
            } else if (
                event.affectsConfiguration("mssql.connections") ||
                event.affectsConfiguration("mssql.connectionGroups") ||
                event.affectsConfiguration("mssql.objectExplorer.v2")
            ) {
                if (event.affectsConfiguration("mssql.connections")) {
                    void autoConnectNewProfile();
                }
                controller?.refresh();
            }
        }),
        vscode.commands.registerCommand("mssql.objectExplorerV2.refresh", (node?: OeV2Node) => {
            if (!deps.isEnabled()) {
                return;
            }
            if (node && controller) {
                void controller.refreshNode(node);
            } else {
                controller?.refresh();
            }
        }),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.connect",
            async (node?: OeV2Node) => {
                if (!deps.isEnabled()) {
                    return;
                }
                const connectionId = connectionIdOf(node);
                if (!connectionId || !controller) {
                    return;
                }
                const connected = await controller.connectProfile(connectionId);
                if (!connected && registry?.stateOf(connectionId) === "failed") {
                    const session = registry?.get(connectionId);
                    void vscode.window.showErrorMessage(
                        ObjectExplorerV2.couldNotConnect(session?.failureReason),
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.cancelConnect",
            (node?: OeV2Node) => {
                if (!deps.isEnabled()) {
                    return;
                }
                const connectionId = connectionIdOf(node);
                if (connectionId) {
                    controller?.cancelConnect(connectionId);
                }
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.disconnect",
            async (node?: OeV2Node) => {
                if (!deps.isEnabled()) {
                    return;
                }
                const connectionId = connectionIdOf(node);
                if (connectionId) {
                    // Handoff state never outlives the v2 connection (§12.5).
                    await handoff?.close(connectionId);
                    await controller?.disconnectProfile(connectionId);
                }
            },
        ),
        // v1 parity: Remove Connection deletes the saved profile (classic
        // removeNode semantics — same confirmation wording, disconnect first).
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.removeConnection",
            async (node?: OeV2Node) => {
                if (!deps.isEnabled()) {
                    return;
                }
                const connectionId = connectionIdOf(node);
                if (!connectionId || !node) {
                    return;
                }
                const response = await vscode.window.showInformationMessage(
                    ObjectExplorer.NodeDeletionConfirmation(node.label),
                    { modal: true },
                    ObjectExplorer.NodeDeletionConfirmationYes,
                    ObjectExplorer.NodeDeletionConfirmationNo,
                );
                if (response !== ObjectExplorer.NodeDeletionConfirmationYes) {
                    return;
                }
                await handoff?.close(connectionId);
                await controller?.disconnectProfile(connectionId);
                await removeSavedProfile(connectionId);
                controller?.refresh();
            },
        ),
        // v1 parity: Edit Connection on top-level connection nodes opens the
        // shared Connection Dialog pre-filled with the saved profile. Profile
        // lookup mirrors moveToGroup; the v1 handler accepts a bare profile.
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.editConnection",
            async (node?: OeV2Node) => {
                if (!deps.isEnabled()) {
                    return;
                }
                const connectionId = connectionIdOf(node);
                const config = (deps.groupConfig ?? (() => undefined))();
                if (!connectionId || !config) {
                    return;
                }
                const profile = (await config.getConnections()).find(
                    (candidate) => stableProfileId(candidate as { id?: string }) === connectionId,
                );
                if (!profile) {
                    void vscode.window.showWarningMessage(ObjectExplorerV2.savedConnectionNotFound);
                    return;
                }
                await vscode.commands.executeCommand("mssql.editConnection", profile);
            },
        ),
        // B25 (K4): first-class admin commands through the redirect library —
        // classic registrations/handlers untouched, targeting via oe2:cmd
        // context flags from the command registry.
        ...OE_V2_COMMANDS.filter((def) => def.route === "legacyRedirect").map((def) =>
            vscode.commands.registerCommand(def.id, async (node?: OeV2Node) => {
                if (!deps.isEnabled()) {
                    return;
                }
                if (!node?.connectionId || !controller || !handoff) {
                    return;
                }
                const outcome = await redirectToClassic(def.feature, node, {
                    facts: controller,
                    handoff,
                });
                if (!outcome.ok && outcome.error) {
                    void vscode.window.showErrorMessage(outcome.error);
                }
            }),
        ),
        vscode.commands.registerCommand("mssql.objectExplorerV2.showStatus", async () => {
            if (!deps.isEnabled()) {
                return;
            }
            statusChannel ??= vscode.window.createOutputChannel(ObjectExplorerV2.outputChannelName);
            const channel = statusChannel;
            channel.clear();
            const dataPlane = SqlDataPlaneService.get();
            channel.appendLine(`privatePreview.enabled: ${deps.isEnabled()}`);
            channel.appendLine(`dataPlane.enabled: ${dataPlane.enabled}`);
            channel.appendLine(`dataPlane.availability: ${dataPlane.availability().state}`);
            channel.appendLine(`view registered: ${registration !== undefined}`);
            channel.appendLine(
                `metadataStore: ${JSON.stringify(MetadataStoreService.get().store().status())}`,
            );
            channel.show(true);
        }),
        {
            dispose: () => {
                statusChannel?.dispose();
                statusChannel = undefined;
            },
        },
        vscode.commands.registerCommand("mssql.objectExplorerV2.openClassicObjectExplorer", () => {
            if (!deps.isEnabled()) {
                return;
            }
            return vscode.commands.executeCommand("objectExplorer.focus");
        }),
        { dispose: unregister },
    );
}
