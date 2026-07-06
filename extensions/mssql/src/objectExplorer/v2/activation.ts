/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 activation (V2-0): registers the preview tree view when
 * mssql.objectExplorer.viewMode == "v2Preview". The view contribution is
 * `when`-gated in package.json; this module registers the provider lazily
 * and reacts to config flips WITHOUT a reload (the B3 lesson). Activation
 * itself creates NO connections of any kind — v1 or data plane.
 */

import * as vscode from "vscode";
import { diag } from "../../diagnostics/diagnosticsCore";
import { SqlDataPlaneService } from "../../services/sqlDataPlane/sqlDataPlaneService";
import { ObjectExplorerV2Provider } from "./objectExplorerV2Provider";
import { oeViewMode } from "./settings";
import { ConnectionProfileSource } from "./sessions/oeV2ProfileAdapter";
import { OeV2TreeController } from "./tree/oeV2TreeController";

export interface OeV2ActivationDeps {
    readonly profiles: ConnectionProfileSource;
}

export function activateObjectExplorerV2(
    context: vscode.ExtensionContext,
    deps: OeV2ActivationDeps,
): void {
    let registration: vscode.Disposable | undefined;
    let controller: OeV2TreeController | undefined;

    const register = () => {
        if (registration) {
            return;
        }
        controller = new OeV2TreeController({
            profiles: deps.profiles,
            dataPlane: {
                enabled: () => SqlDataPlaneService.get().enabled,
                availabilityState: () => SqlDataPlaneService.get().availability().state,
            },
        });
        const provider = new ObjectExplorerV2Provider(controller);
        const view = vscode.window.createTreeView("mssql.objectExplorerV2", {
            treeDataProvider: provider,
            showCollapseAll: true,
        });
        registration = vscode.Disposable.from(view, provider);
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
    };

    if (oeViewMode() === "v2Preview") {
        register();
    }

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
                event.affectsConfiguration("mssql.connectionGroups")
            ) {
                controller?.refresh();
            }
        }),
        vscode.commands.registerCommand("mssql.objectExplorerV2.refresh", () =>
            controller?.refresh(),
        ),
        vscode.commands.registerCommand("mssql.objectExplorerV2.showStatus", () => {
            const channel = vscode.window.createOutputChannel("MSSQL Object Explorer v2");
            const dataPlane = SqlDataPlaneService.get();
            channel.appendLine(`viewMode: ${oeViewMode()}`);
            channel.appendLine(`dataPlane.enabled: ${dataPlane.enabled}`);
            channel.appendLine(`dataPlane.availability: ${dataPlane.availability().state}`);
            channel.appendLine(`view registered: ${registration !== undefined}`);
            channel.show(true);
        }),
        vscode.commands.registerCommand("mssql.objectExplorerV2.openClassicObjectExplorer", () =>
            vscode.commands.executeCommand("objectExplorer.focus"),
        ),
        { dispose: unregister },
    );
}
