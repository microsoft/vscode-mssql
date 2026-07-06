/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 native commands (oe_view_design §11): copy name / qualified name,
 * folder filter + clear, database object search, New Query, SELECT TOP and
 * table preview into Query Studio via mssql.queryStudio.newQueryFromContext.
 * Every operation is data-plane/metadata-native — no v1, no handoff here.
 * Generated SQL composes ONLY through sqlIdentifierFormatter and is never
 * logged (command diag events carry route + node kind, not text).
 */

import * as vscode from "vscode";
import { diag } from "../../../diagnostics/diagnosticsCore";
import { oeV2Settings } from "../settings";
import { OeV2Node } from "../tree/oeV2Node";
import { OeV2TreeController } from "../tree/oeV2TreeController";
import { qualifiedName, selectTopSql } from "./sqlIdentifierFormatter";

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

async function openQueryStudioFromContext(args: {
    profileId: string;
    database?: string;
    initialSql?: string;
    autoRun?: boolean;
}): Promise<void> {
    const queryStudioEnabled = vscode.workspace
        .getConfiguration()
        .get<boolean>("mssql.queryStudio.enabled", false);
    if (!queryStudioEnabled) {
        void vscode.window.showInformationMessage(
            "Query Studio is disabled. Enable mssql.queryStudio.enabled to open queries from Object Explorer v2.",
        );
        return;
    }
    await vscode.commands.executeCommand("mssql.queryStudio.newQueryFromContext", {
        ...args,
        source: "objectExplorerV2",
    });
}

export function registerOeV2NativeCommands(
    context: vscode.ExtensionContext,
    getController: () => OeV2TreeController | undefined,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.copyName",
            async (node?: OeV2Node) => {
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
                if (!node) {
                    return;
                }
                const text =
                    node.schema && node.objectName
                        ? qualifiedName(node.schema, node.objectName)
                        : (node.database ?? node.label);
                await vscode.env.clipboard.writeText(text);
                emitCommand("copyQualifiedName", "native", node);
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.newQuery",
            async (node?: OeV2Node) => {
                if (!node?.connectionId) {
                    return;
                }
                emitCommand("newQuery", "native", node);
                await openQueryStudioFromContext({
                    profileId: node.connectionId,
                    ...(node.database ? { database: node.database } : {}),
                });
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.selectTop",
            async (node?: OeV2Node) => {
                if (!node?.connectionId || !node.schema || !node.objectName) {
                    return;
                }
                emitCommand("selectTop", "native", node);
                await openQueryStudioFromContext({
                    profileId: node.connectionId,
                    ...(node.database ? { database: node.database } : {}),
                    initialSql: selectTopSql(
                        node.schema,
                        node.objectName,
                        oeV2Settings().tablePreviewRowLimit,
                    ),
                });
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.tablePreview",
            async (node?: OeV2Node) => {
                if (!node?.connectionId || !node.schema || !node.objectName) {
                    return;
                }
                emitCommand("tablePreview", "native", node);
                await openQueryStudioFromContext({
                    profileId: node.connectionId,
                    ...(node.database ? { database: node.database } : {}),
                    initialSql: selectTopSql(
                        node.schema,
                        node.objectName,
                        oeV2Settings().tablePreviewRowLimit,
                    ),
                    autoRun: true,
                });
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.filter",
            async (node?: OeV2Node) => {
                const controller = getController();
                if (!node || !controller || node.capabilities.canFilter !== true) {
                    return;
                }
                const current = controller.folderFilter(node);
                const value = await vscode.window.showInputBox({
                    title: `Filter ${node.label} by name`,
                    prompt: "Objects whose name contains this text remain visible.",
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
                getController()?.clearFolderFilter(node);
                emitCommand("clearFilters", "native", node);
            },
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.search",
            async (node?: OeV2Node) => {
                const controller = getController();
                if (!controller || !node?.connectionId || !node.database) {
                    return;
                }
                const term = await vscode.window.showInputBox({
                    title: `Search objects in ${node.database}`,
                    prompt: "Name prefix to search for.",
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
                    void vscode.window.showInformationMessage(`No objects match '${term}'.`);
                    return;
                }
                const picked = await vscode.window.showQuickPick(
                    matches.map((match) => ({
                        label: `${match.schema}.${match.name}`,
                        description: match.kind,
                        match,
                    })),
                    { title: `Objects matching '${term}' — pick to copy qualified name` },
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
