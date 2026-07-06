/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 activation (V2-0/V2-2): registers the preview tree view when
 * mssql.objectExplorer.viewMode == "v2Preview", composes the session
 * registry + shared-MetadataStore coordinators, and wires the explicit
 * connect/disconnect commands. Reacts to config flips WITHOUT a reload
 * (the B3 lesson). Activation itself creates NO connections of any kind;
 * connect happens only on the user's explicit command, and only through
 * the data plane — never ConnectionManager (lint + spy enforced).
 */

import * as vscode from "vscode";
import { diag } from "../../diagnostics/diagnosticsCore";
import { MetadataStoreService } from "../../services/metadata/metadataStoreService";
import { ProfileSecretSource } from "../../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../../services/sqlDataPlane/sqlDataPlaneService";
import { ObjectExplorerV2Provider } from "./objectExplorerV2Provider";
import { OeV2MetadataCoordinator } from "./metadata/oeV2MetadataCoordinator";
import { oeV2Settings, oeViewMode } from "./settings";
import { ConnectionProfileSource } from "./sessions/oeV2ProfileAdapter";
import { OeV2SessionRegistry } from "./sessions/oeV2SessionRegistry";
import { registerOeV2NativeCommands } from "./commands/oeV2NativeCommands";
import { OeV2Node } from "./tree/oeV2Node";
import { OeV2TreeController } from "./tree/oeV2TreeController";

export interface OeV2ActivationDeps {
    readonly profiles: ConnectionProfileSource & ProfileSecretSource;
}

export function activateObjectExplorerV2(
    context: vscode.ExtensionContext,
    deps: OeV2ActivationDeps,
): void {
    let registration: vscode.Disposable | undefined;
    let controller: OeV2TreeController | undefined;
    let registry: OeV2SessionRegistry | undefined;

    const register = () => {
        if (registration) {
            return;
        }
        registry = new OeV2SessionRegistry(() => SqlDataPlaneService.get().service());
        controller = new OeV2TreeController({
            profiles: deps.profiles,
            secrets: deps.profiles,
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
        });
        const localRegistry = registry;
        const localController = controller;
        registration = vscode.Disposable.from(view, provider, {
            dispose: () => {
                localController.dispose();
                localRegistry.dispose();
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
    };

    if (oeViewMode() === "v2Preview") {
        register();
    }

    registerOeV2NativeCommands(context, () => controller);

    const connectionIdOf = (node: OeV2Node | undefined): string | undefined =>
        node?.connectionId ??
        (node?.path.kind === "connection" ? node.path.connectionId : undefined);

    context.subscriptions.push(
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
                    await controller?.disconnectProfile(connectionId);
                }
            },
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
