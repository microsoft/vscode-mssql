/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Library tree (R3, D-0012): the runtime library rendered next to
 * Object Explorer. The tree is a thin projection — all data comes from
 * RunbookStudioService's library surface (which lazily drives the hobbes
 * runtime regardless of the configured run lane), grouping/sorting is the
 * pure runbookLibraryModel, and failures render as a single informational
 * node (never a silently blank tree). Open/export round-trip through the
 * publish-time artifact stash; assets authored elsewhere (e.g. the Hobbes
 * standalone frontend) are imported on first open — their raw runtime plan
 * IR maps through the same planner mapping into a stash (D-0012 interop) —
 * and only a FAILED import is surfaced.
 */

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { RunbookArtifactFile } from "../sharedInterfaces/runbookStudio";
import { readStash, sanitizeAssetId, stashUri } from "./libraryStash";
import {
    groupLibraryItems,
    libraryCategoryLabel,
    libraryItemDescription,
    libraryRunDescription,
    LibraryRunRef,
    RunbookLibraryAsset,
} from "./runbookLibraryModel";
import { emitRunbookEvent, metaField, newRunbookRootContext } from "./runbookDiag";
import type { RunbookStudioService } from "./runbookStudioService";

export const RUNBOOK_LIBRARY_VIEW_ID = "mssql.runbookLibrary";
/** Mirrors RUNBOOK_STUDIO_VIEW_TYPE without importing the editor provider
 *  (that module registers this one — an import here would be a cycle). */
const RUNBOOK_EDITOR_VIEW_TYPE = "mssql.runbookStudio";

export type RunbookLibraryNode =
    | { kind: "group"; category: string; items: RunbookLibraryAsset[] }
    | { kind: "asset"; asset: RunbookLibraryAsset }
    | { kind: "run"; run: LibraryRunRef }
    | { kind: "message"; message: string };

/** Run-history children rendered per runbook (the detail endpoint returns
 *  up to 25; the tree keeps the newest 10 to stay glanceable). */
const MAX_RUN_HISTORY_NODES = 10;

function isAssetNode(node: unknown): node is Extract<RunbookLibraryNode, { kind: "asset" }> {
    return (
        typeof node === "object" &&
        node !== null &&
        (node as { kind?: unknown }).kind === "asset" &&
        typeof (node as { asset?: { id?: unknown } }).asset?.id === "string"
    );
}

export class RunbookLibraryProvider
    implements vscode.TreeDataProvider<RunbookLibraryNode>, vscode.Disposable
{
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeTreeData = this.changeEmitter.event;

    constructor(private readonly serviceAccessor: () => RunbookStudioService | undefined) {}

    public dispose(): void {
        this.changeEmitter.dispose();
    }

    public refresh(): void {
        this.changeEmitter.fire();
    }

    public getTreeItem(node: RunbookLibraryNode): vscode.TreeItem {
        switch (node.kind) {
            case "group": {
                const item = new vscode.TreeItem(
                    libraryCategoryLabel(node.category),
                    vscode.TreeItemCollapsibleState.Expanded,
                );
                item.iconPath = new vscode.ThemeIcon("library");
                item.contextValue = "runbookLibraryGroup";
                return item;
            }
            case "asset": {
                // Collapsible: children are the runbook's recent run
                // history, fetched lazily on expand (getChildren).
                const item = new vscode.TreeItem(
                    node.asset.title,
                    vscode.TreeItemCollapsibleState.Collapsed,
                );
                item.iconPath = new vscode.ThemeIcon("book");
                item.contextValue = "runbookLibraryItem";
                const description = libraryItemDescription(node.asset);
                if (description.length > 0) {
                    item.description = description;
                }
                item.tooltip = node.asset.description ?? node.asset.title;
                item.command = {
                    command: "mssql.runbookLibrary.open",
                    title: LocRunbookStudio.libraryOpenItem,
                    arguments: [node],
                };
                return item;
            }
            case "run": {
                // Label is a short runId prefix (full ids are GUID-length);
                // the tooltip carries the exact id for correlation.
                const item = new vscode.TreeItem(
                    node.run.runId.slice(0, 8),
                    vscode.TreeItemCollapsibleState.None,
                );
                item.iconPath = new vscode.ThemeIcon("play-circle");
                item.contextValue = "runbookLibraryRun";
                const description = libraryRunDescription(node.run);
                if (description.length > 0) {
                    item.description = description;
                }
                item.tooltip = node.run.runId;
                return item;
            }
            case "message": {
                const item = new vscode.TreeItem(
                    node.message,
                    vscode.TreeItemCollapsibleState.None,
                );
                item.iconPath = new vscode.ThemeIcon("info");
                item.contextValue = "runbookLibraryMessage";
                item.tooltip = node.message;
                return item;
            }
        }
    }

    public async getChildren(node?: RunbookLibraryNode): Promise<RunbookLibraryNode[]> {
        if (node) {
            if (node.kind === "group") {
                return node.items.map((asset): RunbookLibraryNode => ({ kind: "asset", asset }));
            }
            if (node.kind === "asset") {
                return this.getRunHistoryChildren(node.asset);
            }
            return [];
        }
        const service = this.serviceAccessor();
        if (!service) {
            return [{ kind: "message", message: LocRunbookStudio.runtimeUnavailable }];
        }
        const result = await service.listLibraryRunbooks();
        if (result.error) {
            // One informational node with the honest reason — never a
            // silently blank tree.
            return [{ kind: "message", message: result.error.message }];
        }
        const assets = result.assets ?? [];
        if (assets.length === 0) {
            return [{ kind: "message", message: LocRunbookStudio.libraryEmpty }];
        }
        return groupLibraryItems(assets).map(
            (group): RunbookLibraryNode => ({
                kind: "group",
                category: group.category,
                items: group.items,
            }),
        );
    }

    /** Recent runs under a runbook item: newest first (runtime order), a
     *  single honest message node when there are none, and the standard
     *  informational node on load failure (never a silently blank branch). */
    private async getRunHistoryChildren(asset: RunbookLibraryAsset): Promise<RunbookLibraryNode[]> {
        const service = this.serviceAccessor();
        if (!service) {
            return [{ kind: "message", message: LocRunbookStudio.runtimeUnavailable }];
        }
        const result = await service.getLibraryRunHistory(asset.id);
        if (result.error) {
            return [{ kind: "message", message: result.error.message }];
        }
        const runs = result.runs ?? [];
        if (runs.length === 0) {
            return [{ kind: "message", message: LocRunbookStudio.libraryNoRuns }];
        }
        return runs
            .slice(0, MAX_RUN_HISTORY_NODES)
            .map((run): RunbookLibraryNode => ({ kind: "run", run }));
    }
}

/** Register the Runbook Library tree view and its commands. Called only when
 *  the runbookStudio preview gate is on (same gate as the custom editor). */
export function registerRunbookLibrary(
    context: vscode.ExtensionContext,
    serviceAccessor: () => RunbookStudioService | undefined,
    /** The artifact of the focused Runbook Studio editor, if any. */
    activeArtifact: () => RunbookArtifactFile | undefined,
): void {
    const provider = new RunbookLibraryProvider(serviceAccessor);

    /** True when a stash exists for the asset — importing the runtime asset
     *  first when it was authored outside VS Code (no publish-time stash;
     *  D-0012 library interop). A failed import shows the precise failure
     *  reason and returns false. */
    async function ensureStashed(assetId: string): Promise<boolean> {
        if ((await readStash(context.globalStorageUri, assetId)) !== undefined) {
            return true;
        }
        const service = serviceAccessor();
        if (!service) {
            void vscode.window.showErrorMessage(LocRunbookStudio.runtimeUnavailable);
            return false;
        }
        const imported = await service.importLibraryRunbook(assetId);
        if (!imported.ok) {
            void vscode.window.showErrorMessage(
                imported.error?.message ?? LocRunbookStudio.runtimeUnavailable,
            );
            return false;
        }
        return true;
    }

    context.subscriptions.push(
        provider,
        vscode.window.createTreeView(RUNBOOK_LIBRARY_VIEW_ID, { treeDataProvider: provider }),
        vscode.commands.registerCommand("mssql.runbookLibrary.refresh", () => provider.refresh()),
        vscode.commands.registerCommand("mssql.runbookLibrary.open", async (node?: unknown) => {
            if (!isAssetNode(node)) {
                return;
            }
            const operation = newRunbookRootContext("library");
            const stashed = await readStash(context.globalStorageUri, node.asset.id);
            emitRunbookEvent(operation, "runbookStudio.library.open", "ok", {
                stashed: metaField(stashed !== undefined),
            });
            // Authored outside VS Code (no publish-time stash): import the
            // runtime asset into a stash first; only a FAILED import blocks
            // the open (the helper already showed the exact reason).
            if (stashed === undefined && !(await ensureStashed(node.asset.id))) {
                return;
            }
            await vscode.commands.executeCommand(
                "vscode.openWith",
                stashUri(context.globalStorageUri, node.asset.id),
                RUNBOOK_EDITOR_VIEW_TYPE,
            );
        }),
        vscode.commands.registerCommand(
            "mssql.runbookLibrary.exportRunbook",
            async (node?: unknown) => {
                if (!isAssetNode(node)) {
                    return;
                }
                const operation = newRunbookRootContext("library");
                // Outside-authored assets are imported first (same flow as
                // open) so export always has a source artifact to project.
                if (!(await ensureStashed(node.asset.id))) {
                    emitRunbookEvent(operation, "runbookStudio.library.export", "error", {
                        errorClass: metaField("ImportFailed"),
                    });
                    return;
                }
                const stashed = await readStash(context.globalStorageUri, node.asset.id);
                if (stashed === undefined) {
                    // Stash vanished between import and read — treat as the
                    // generic unavailable case rather than exporting nothing.
                    void vscode.window.showErrorMessage(LocRunbookStudio.runtimeUnavailable);
                    return;
                }
                const target = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(
                        path.join(os.homedir(), `${sanitizeAssetId(node.asset.id)}.runbook.json`),
                    ),
                    filters: { [LocRunbookStudio.libraryExportFilterLabel]: ["runbook.json"] },
                });
                if (!target) {
                    return;
                }
                try {
                    await vscode.workspace.fs.writeFile(target, Buffer.from(stashed, "utf8"));
                    emitRunbookEvent(operation, "runbookStudio.library.export", "ok", {
                        stashed: metaField(true),
                    });
                    void vscode.window.showInformationMessage(
                        LocRunbookStudio.libraryExported(target.fsPath),
                    );
                } catch (error) {
                    emitRunbookEvent(operation, "runbookStudio.library.export", "error", {
                        errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
                    });
                    void vscode.window.showErrorMessage(
                        LocRunbookStudio.libraryUnavailable(
                            error instanceof Error ? error.message : String(error),
                        ),
                    );
                }
            },
        ),
        vscode.commands.registerCommand("mssql.runbookLibrary.archive", async (node?: unknown) => {
            if (!isAssetNode(node)) {
                return;
            }
            const service = serviceAccessor();
            if (!service) {
                void vscode.window.showErrorMessage(LocRunbookStudio.runtimeUnavailable);
                return;
            }
            const choice = await vscode.window.showWarningMessage(
                LocRunbookStudio.libraryArchiveConfirm(node.asset.title),
                { modal: true },
                LocRunbookStudio.libraryArchiveAction,
            );
            if (choice !== LocRunbookStudio.libraryArchiveAction) {
                return;
            }
            const result = await service.deleteLibraryRunbook(node.asset.id);
            if (result.error) {
                void vscode.window.showErrorMessage(result.error.message);
                return;
            }
            provider.refresh();
            void vscode.window.showInformationMessage(
                LocRunbookStudio.libraryArchived(node.asset.title),
            );
        }),
        vscode.commands.registerCommand("mssql.runbookStudio.saveToLibrary", async () => {
            const artifact = activeArtifact();
            if (!artifact) {
                void vscode.window.showInformationMessage(LocRunbookStudio.libraryNoActiveRunbook);
                return;
            }
            const service = serviceAccessor();
            if (!service) {
                void vscode.window.showErrorMessage(LocRunbookStudio.runtimeUnavailable);
                return;
            }
            const result = await service.saveToLibrary(artifact);
            if (result.error) {
                void vscode.window.showErrorMessage(result.error.message);
                return;
            }
            provider.refresh();
            void vscode.window.showInformationMessage(
                LocRunbookStudio.librarySaved(artifact.name, result.versionLabel ?? ""),
            );
        }),
    );
}
