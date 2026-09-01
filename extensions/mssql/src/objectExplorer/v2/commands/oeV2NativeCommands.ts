/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 native commands (oe_view_design §11): copy name / qualified name,
 * folder filter + clear, and database object search.
 * Every operation is data-plane/metadata-native — no v1, no handoff here.
 * Generated SQL composes ONLY through sqlIdentifierFormatter and is never
 * logged (command diag events carry route + node kind, not text).
 */

import * as vscode from "vscode";
import { diag } from "../../../diagnostics/diagnosticsCore";
import { ObjectExplorerV2 } from "../../../constants/locConstants";
import { OeV2Node } from "../tree/oeV2Node";
import { OeV2TreeController } from "../tree/oeV2TreeController";
import { qualifiedName } from "./sqlIdentifierFormatter";

function emitCommand(command: string, route: "native" | "unavailable", node?: OeV2Node): void {
    diag.emit({
        feature: "objectExplorer",
        kind: "event",
        type: "objectExplorerV2.command.native",
        fields: {
            command: { raw: command, cls: "diagnostic.metadata" },
            route: { raw: route, cls: "diagnostic.metadata" },
            nodeKind: { raw: node?.kind ?? "none", cls: "diagnostic.metadata" },
        },
    });
}

export function registerOeV2NativeCommands(
    context: vscode.ExtensionContext,
    getController: () => OeV2TreeController | undefined,
    /** Tree-selection fallback for keybinding invocations (no node arg). */
    getSelectedNode?: () => OeV2Node | undefined,
    isEnabled: () => boolean = () => true,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.copyName",
            async (node?: OeV2Node) => {
                if (!isEnabled()) {
                    return;
                }
                const name = node?.objectName ?? node?.schema ?? node?.database ?? node?.label;
                if (name) {
                    await vscode.env.clipboard.writeText(name);
                    emitCommand("copyName", "native", node);
                }
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.copyQualifiedName",
            async (node?: OeV2Node) => {
                if (!isEnabled()) {
                    return;
                }
                // Keybinding invocations (Ctrl+C in the view) carry no node.
                const target = node ?? getSelectedNode?.();
                if (!target) {
                    return;
                }
                const text =
                    target.schema && target.objectName
                        ? qualifiedName(target.schema, target.objectName)
                        : (target.database ?? target.label);
                await vscode.env.clipboard.writeText(text);
                emitCommand("copyQualifiedName", "native", target);
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.filter",
            async (node?: OeV2Node) => {
                if (!isEnabled()) {
                    return;
                }
                const controller = getController();
                if (!node || !controller || node.capabilities.canFilter !== true) {
                    return;
                }
                const current = controller.folderFilter(node);
                const value = await vscode.window.showInputBox({
                    title: ObjectExplorerV2.filterFolderTitle(node.label),
                    prompt: ObjectExplorerV2.filterObjectsPrompt,
                    value: current ?? "",
                });
                if (value === undefined) {
                    return; // cancelled
                }
                controller.setFolderFilter(node, value);
                emitCommand("filter", "native", node);
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.clearFilters",
            (node?: OeV2Node) => {
                if (!isEnabled()) {
                    return;
                }
                getController()?.clearFolderFilter(node);
                emitCommand("clearFilters", "native", node);
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.search",
            async (node?: OeV2Node) => {
                if (!isEnabled()) {
                    return;
                }
                const controller = getController();
                if (!controller || !node?.connectionId || !node.database) {
                    return;
                }
                const term = await vscode.window.showInputBox({
                    title: ObjectExplorerV2.searchDatabaseTitle(node.database),
                    prompt: ObjectExplorerV2.searchNamePrefixPrompt,
                });
                if (!term) {
                    return;
                }
                const matches = await controller.searchObjects(
                    node.connectionId,
                    node.database,
                    term,
                );
                emitCommand("search", "native", node);
                if (matches.length === 0) {
                    void vscode.window.showInformationMessage(
                        ObjectExplorerV2.noObjectsMatch(term),
                    );
                    return;
                }
                const picked = await vscode.window.showQuickPick(
                    matches.map((match) => ({
                        label: `${match.schema}.${match.name}`,
                        description: match.kind,
                        match,
                    })),
                    { title: ObjectExplorerV2.searchResultsTitle(term) },
                );
                if (picked) {
                    await vscode.env.clipboard.writeText(
                        qualifiedName(picked.match.schema, picked.match.name),
                    );
                }
            },
        ),
    );
}
