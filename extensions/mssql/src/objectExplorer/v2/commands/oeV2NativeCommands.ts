/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * OE v2 native commands (oe_view_design §11): copy name / qualified name,
 * folder filter + clear, database object search, New Query, and SELECT TOP
 * into Query Studio via mssql.queryStudio.newQueryFromContext.
 * Every operation is data-plane/metadata-native — no v1, no handoff here.
 * Generated SQL composes ONLY through sqlIdentifierFormatter and is never
 * logged (command diag events carry route + node kind, not text).
 */

import * as vscode from "vscode";
import { isQueryStudioEnabled } from "../../../queryStudio/queryStudioFeatureGate";
import { diag } from "../../../diagnostics/diagnosticsCore";
import { ObjectExplorerV2, QueryStudio } from "../../../constants/locConstants";
import { configPreventAutoExecuteScript } from "../../../constants/constants";
import { OeV2Node } from "../tree/oeV2Node";
import { OeV2TreeController } from "../tree/oeV2TreeController";
import { qualifiedName, selectTopSql } from "./sqlIdentifierFormatter";

const SCRIPT_SELECT_TOP_ROW_LIMIT = 1000;

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
    if (!isQueryStudioEnabled()) {
        void vscode.window.showInformationMessage(QueryStudio.disabled);
        return;
    }
    await vscode.commands.executeCommand("mssql.queryStudio.newQueryFromContext", {
        ...args,
        source: "objectExplorerV2",
    });
}

async function scriptObjectFromContext(
    getController: () => OeV2TreeController | undefined,
    node: OeV2Node | undefined,
    operation: "create" | "alter" | "drop" | "execute",
): Promise<void> {
    const controller = getController();
    if (!isQueryStudioEnabled() || !controller || !node?.connectionId || !node.database) {
        return;
    }
    const capability = {
        create: "canScriptCreate",
        alter: "canScriptAlter",
        drop: "canGenerateScript",
        execute: "canScriptExecute",
    } as const;
    if (!node.capabilities[capability[operation]]) {
        return;
    }
    emitCommand(`script.${operation}`, "native", node);
    const { script, error } = await controller.scriptObject(
        node,
        operation,
        vscode.workspace.getConfiguration().get<boolean>("mssql.metadataCache.offlineMode", false),
    );
    if (error) {
        void vscode.window.showErrorMessage(error);
        return;
    }
    if (script === undefined) {
        return;
    }
    await openQueryStudioFromContext({
        profileId: node.connectionId,
        database: node.database,
        initialSql: script,
    });
}

/** Unqualified name of the selected node, never one inherited from its parent. */
export function copyNameForNode(node?: OeV2Node): string | undefined {
    return node?.kind === "object" || node?.kind === "databaseObject"
        ? (node.objectName ?? node.label)
        : node?.label;
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
                const name = copyNameForNode(node);
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
            "mssql.objectExplorerV2.newQuery",
            async (node?: OeV2Node) => {
                if (!isEnabled() || !node?.connectionId) {
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
                if (
                    !isEnabled() ||
                    !node?.connectionId ||
                    !node.schema ||
                    !node.objectName ||
                    node.capabilities.canSelectTop !== true
                ) {
                    return;
                }
                emitCommand("selectTop", "native", node);
                await openQueryStudioFromContext({
                    profileId: node.connectionId,
                    ...(node.database ? { database: node.database } : {}),
                    initialSql: selectTopSql(
                        node.schema,
                        node.objectName,
                        SCRIPT_SELECT_TOP_ROW_LIMIT,
                    ),
                    autoRun: !vscode.workspace
                        .getConfiguration()
                        .get<boolean>(configPreventAutoExecuteScript, false),
                });
            },
        ),
        vscode.commands.registerCommand("mssql.objectExplorerV2.scriptCreate", (node?: OeV2Node) =>
            isEnabled() ? scriptObjectFromContext(getController, node, "create") : undefined,
        ),
        vscode.commands.registerCommand("mssql.objectExplorerV2.scriptAlter", (node?: OeV2Node) =>
            isEnabled() ? scriptObjectFromContext(getController, node, "alter") : undefined,
        ),
        vscode.commands.registerCommand("mssql.objectExplorerV2.scriptDrop", (node?: OeV2Node) =>
            isEnabled() ? scriptObjectFromContext(getController, node, "drop") : undefined,
        ),
        vscode.commands.registerCommand(
            "mssql.objectExplorerV2.scriptExecute",
            (node?: OeV2Node) =>
                isEnabled() ? scriptObjectFromContext(getController, node, "execute") : undefined,
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
                const input = await vscode.window.showInputBox({
                    title: ObjectExplorerV2.searchDatabaseTitle(node.database),
                    prompt: ObjectExplorerV2.searchNamePrefixPrompt,
                });
                const term = input?.trim();
                if (!term) {
                    return;
                }
                const matches = await controller.searchObjects(
                    node.connectionId,
                    node.database,
                    term,
                );
                emitCommand("search", "native", node);
                if (matches === undefined) {
                    void vscode.window.showInformationMessage(
                        ObjectExplorerV2.metadataStillLoading,
                    );
                    return;
                }
                if (matches.length === 0) {
                    void vscode.window.showInformationMessage(
                        ObjectExplorerV2.noObjectsMatch(term),
                    );
                    return;
                }
                const picked = await vscode.window.showQuickPick(
                    matches.map((match) => ({
                        label: `${match.schema}.${match.name}`,
                        description: ObjectExplorerV2.objectKindLabel(match.kind),
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
