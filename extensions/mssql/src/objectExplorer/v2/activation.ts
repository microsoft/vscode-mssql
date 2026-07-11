/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 activation (V2-0/V2-2): registers the preview tree view when
 * mssql.objectExplorer.viewMode == "v2Preview", composes the session
 * registry + shared-MetadataStore coordinators, and wires connect/disconnect
 * commands. Reacts to config flips WITHOUT a reload (the B3 lesson). All
 * connects go through the data plane — never ConnectionManager (lint + spy
 * enforced).
 */

import * as vscode from "vscode";
import { diag } from "../../diagnostics/diagnosticsCore";
import { Perf } from "../../perf/perfTelemetry";
import { MetadataStoreService } from "../../services/metadata/metadataStoreService";
import {
    ProfileSecretSource,
    ProfileTokenSource,
} from "../../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../../services/sqlDataPlane/sqlDataPlaneService";
import { ObjectExplorerV2Provider } from "./objectExplorerV2Provider";
import { OeV2MetadataCoordinator } from "./metadata/oeV2MetadataCoordinator";
import { oeV2Settings, oeViewMode } from "./settings";
import { ConnectionProfileSource, readProfileTree } from "./sessions/oeV2ProfileAdapter";
import { OeV2SessionRegistry } from "./sessions/oeV2SessionRegistry";
import { registerOeV2NativeCommands } from "./commands/oeV2NativeCommands";
import { policiesForNode } from "./commands/oeV2LegacyCommandPolicy";
import {
    HandoffConnectionSeam,
    OeV2ClassicHandoffService,
} from "./legacy/oeV2ClassicHandoffService";
import { OE_V2_COMMANDS } from "./commands/oeV2CommandRegistry";
import { OeV2DragAndDropController, registerOeV2GroupCommands } from "./commands/oeV2GroupCommands";
import { redirectToClassic } from "./legacy/oeV2LegacyRedirect";
import { ConnectionConfig } from "../../connectionconfig/connectionconfig";
import { OeV2Node } from "./tree/oeV2Node";
import { OeV2TreeController } from "./tree/oeV2TreeController";

export interface OeV2ActivationDeps {
    readonly profiles: ConnectionProfileSource & ProfileSecretSource;
    readonly tokens: ProfileTokenSource;
    /** Classic connection seam for the EXPLICIT legacy handoff door (B20). */
    readonly legacyConnections?: HandoffConnectionSeam;
    /** Shared group storage (B26): the classic ConnectionConfig instance. */
    readonly groupConfig?: () => ConnectionConfig | undefined;
}

export function activateObjectExplorerV2(
    context: vscode.ExtensionContext,
    deps: OeV2ActivationDeps,
): void {
    let registration: vscode.Disposable | undefined;
    let controller: OeV2TreeController | undefined;
    let registry: OeV2SessionRegistry | undefined;
    let handoff: OeV2ClassicHandoffService | undefined;

    const register = () => {
        if (registration) {
            return;
        }
        registry = new OeV2SessionRegistry(() => SqlDataPlaneService.get().service());
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
                      ),
                  }
                : {}),
        });
        handoff = deps.legacyConnections
            ? new OeV2ClassicHandoffService(deps.legacyConnections, {
                  confirm: async (message) => {
                      if (!oeV2Settings().confirmLegacyHandoff) {
                          return true;
                      }
                      const proceed = "Continue";
                      const choice = await vscode.window.showWarningMessage(
                          message,
                          { modal: true },
                          proceed,
                      );
                      return choice === proceed;
                  },
              })
            : undefined;
        const localRegistry = registry;
        const localController = controller;
        const localHandoff = handoff;
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
            fields: { viewMode: { raw: "v2Preview", cls: "diagnostic.metadata" } },
        });
    };

    const unregister = () => {
        registration?.dispose();
        registration = undefined;
        controller = undefined;
        registry = undefined;
        handoff = undefined;
    };

    if (oeViewMode() === "v2Preview") {
        register();
    }

    registerOeV2NativeCommands(context, () => controller);

    // B27: while any connection is opening/closing, tick the tree so the
    // slow-connect elapsed description ("connecting… (12s)") stays live.
    const connectingTicker = setInterval(() => {
        if (registry?.anyConnecting()) {
            controller?.refresh();
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
                    throw new Error("OE v2 is not registered (check viewMode setting)");
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
                        throw new Error("OE v2 is not registered (check viewMode setting)");
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
                        (node) => node.label === "Security",
                    );
                    if (!security) {
                        throw new Error("no Security folder on a server-scoped connection");
                    }
                    const logins = (await controller.children(security)).find(
                        (node) => node.label === "Logins",
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
            context,
            groupConfig: deps.groupConfig ?? (() => undefined),
        }),
        // B26: view-title New Connection — the SHARED classic dialog; the
        // config watcher's single-new-profile rule connects it in v2.
        vscode.commands.registerCommand("mssql.objectExplorerV2.addConnection", () =>
            vscode.commands.executeCommand("mssql.addObjectExplorer"),
        ),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("mssql.objectExplorer.viewMode")) {
                if (oeViewMode() === "v2Preview") {
                    register();
                } else {
                    unregister();
                }
            } else if (
                event.affectsConfiguration("mssql.sqlDataPlane.enabled") ||
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
            if (node && controller) {
                void controller.refreshNode(node);
            } else {
                controller?.refresh();
            }
        }),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.connect",
            async (node?: OeV2Node) => {
                const connectionId = connectionIdOf(node);
                if (!connectionId || !controller) {
                    return;
                }
                const connected = await controller.connectProfile(connectionId);
                if (!connected) {
                    const session = registry?.get(connectionId);
                    void vscode.window.showErrorMessage(
                        `Object Explorer v2 could not connect${
                            session?.failureReason ? `: ${session.failureReason}` : ""
                        }`,
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.disconnect",
            async (node?: OeV2Node) => {
                const connectionId = connectionIdOf(node);
                if (connectionId) {
                    // Handoff state never outlives the v2 connection (§12.5).
                    await handoff?.close(connectionId);
                    await controller?.disconnectProfile(connectionId);
                }
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.legacyActions",
            async (node?: OeV2Node) => {
                if (!node?.connectionId || !controller) {
                    return;
                }
                const policies = policiesForNode(node.kind, node.database);
                if (policies.length === 0 || !handoff) {
                    void vscode.window.showInformationMessage(
                        "No legacy actions are available for this node in the OE v2 preview.",
                    );
                    return;
                }
                const picked = await vscode.window.showQuickPick(
                    policies.map((policy) => ({ label: policy.label, policy })),
                    { title: "Legacy actions (creates a classic connection)" },
                );
                if (!picked) {
                    return;
                }
                // B25: same redirect library as the direct commands.
                const outcome = await redirectToClassic(picked.policy.feature, node, {
                    facts: controller,
                    handoff,
                });
                if (!outcome.ok && outcome.error) {
                    void vscode.window.showErrorMessage(outcome.error);
                }
            },
        ),
        // B25 (K4): first-class admin commands through the redirect library —
        // classic registrations/handlers untouched, targeting via oe2:cmd
        // context flags from the command registry.
        ...OE_V2_COMMANDS.filter((def) => def.route === "legacyRedirect").map((def) =>
            vscode.commands.registerCommand(def.id, async (node?: OeV2Node) => {
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
        vscode.commands.registerCommand("mssql.objectExplorerV2.showStatus", () => {
            const channel = vscode.window.createOutputChannel("MSSQL Object Explorer v2");
            const dataPlane = SqlDataPlaneService.get();
            channel.appendLine(`viewMode: ${oeViewMode()}`);
            channel.appendLine(`dataPlane.enabled: ${dataPlane.enabled}`);
            channel.appendLine(`dataPlane.availability: ${dataPlane.availability().state}`);
            channel.appendLine(`view registered: ${registration !== undefined}`);
            channel.appendLine(
                `metadataStore: ${JSON.stringify(MetadataStoreService.get().store().status())}`,
            );
            channel.show(true);
        }),
        vscode.commands.registerCommand("mssql.objectExplorerV2.openClassicObjectExplorer", () =>
            vscode.commands.executeCommand("objectExplorer.focus"),
        ),
        { dispose: unregister },
    );
}
