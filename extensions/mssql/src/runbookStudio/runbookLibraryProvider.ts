/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Library tree (R3, D-0012): the runtime library rendered next to
 * Object Explorer as a file explorer over "folders" (the category field on
 * assets — the runtime has no folder entity). The tree is a thin projection:
 * all data comes from RunbookStudioService's library surface, grouping and
 * folder semantics are the pure runbookLibraryModel, and failures render as
 * a single informational node (never a silently blank tree).
 *
 * Explorer semantics on top of categories:
 * - New Folder keeps an explicit category name in workspaceState so the
 *   folder survives reloads and remains present if its last runbook moves.
 * - Move/Rename ride the runtime's GET+PUT If-Match metadata round-trip.
 * - Archived assets render in a dedicated bottom group with Restore.
 * - Delete purges the runbook, its full run history, and the local stash.
 * - Items with an active run show a "running" badge (service event-driven).
 */

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { RunbookArtifactFile } from "../sharedInterfaces/runbookStudio";
import { readStash, sanitizeAssetId, writeStash } from "./libraryStash";
import { canonicalizeRunbookArtifact, createNewRunbookArtifact } from "./runbookArtifact";
import { RUNBOOK_FS_SCHEME, runbookVirtualUri } from "./runbookFileSystem";
import {
    collectLibraryGroups,
    isArchivedLibraryAsset,
    knownLibraryCategories,
    libraryCategoryLabel,
    libraryFamilyFromCategory,
    libraryItemDescription,
    libraryRunDescription,
    LibraryRunRef,
    remainingPendingFolders,
    RunbookLibraryAsset,
} from "./runbookLibraryModel";
import { emitRunbookEvent, metaField, newRunbookRootContext } from "./runbookDiag";
import type { RunbookStudioService } from "./runbookStudioService";

export const RUNBOOK_LIBRARY_VIEW_ID = "mssql.runbookLibrary";
/** Mirrors RUNBOOK_STUDIO_VIEW_TYPE without importing the editor provider
 *  (that module registers this one — an import here would be a cycle). */
const RUNBOOK_EDITOR_VIEW_TYPE = "mssql.runbookStudio";

/** workspaceState key holding explicitly created folder names. The historical
 * key remains stable so existing empty folders migrate without data loss. */
const PENDING_FOLDERS_STATE_KEY = "mssql.runbookStudio.library.pendingFolders";

/** Category for New Runbook when not invoked on a folder node. */
const DEFAULT_NEW_RUNBOOK_CATEGORY = "validate";

export type RunbookLibraryNode =
    | {
          kind: "group";
          category: string;
          items: RunbookLibraryAsset[];
          archived?: boolean;
          pending?: boolean;
      }
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

function isGroupNode(node: unknown): node is Extract<RunbookLibraryNode, { kind: "group" }> {
    return (
        typeof node === "object" &&
        node !== null &&
        (node as { kind?: unknown }).kind === "group" &&
        typeof (node as { category?: unknown }).category === "string"
    );
}

export class RunbookLibraryProvider
    implements vscode.TreeDataProvider<RunbookLibraryNode>, vscode.Disposable
{
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeTreeData = this.changeEmitter.event;

    /** Explicitly created folder names, first-created order. */
    private pendingFolders: string[] = [];
    /** The most recent listing — folder pickers work off this snapshot. */
    private lastAssets: RunbookLibraryAsset[] = [];
    /** Lazy subscription to the service's active-run changes. */
    private runsSubscription: vscode.Disposable | undefined;

    constructor(
        private readonly serviceAccessor: () => RunbookStudioService | undefined,
        private readonly workspaceState?: vscode.Memento,
    ) {
        this.pendingFolders = [...(workspaceState?.get<string[]>(PENDING_FOLDERS_STATE_KEY) ?? [])];
    }

    public dispose(): void {
        this.runsSubscription?.dispose();
        this.runsSubscription = undefined;
        this.changeEmitter.dispose();
    }

    public refresh(): void {
        this.changeEmitter.fire();
    }

    // -- folder (pending category) bookkeeping -------------------------------

    /** Every folder name a runbook can currently move to. */
    public knownFolderNames(): string[] {
        return knownLibraryCategories(this.lastAssets, this.pendingFolders);
    }

    /** True when the name matches an existing category or pending folder
     *  (case-insensitive). */
    public hasFolder(name: string): boolean {
        const key = name.trim().toLowerCase();
        return this.knownFolderNames().some((folder) => folder.toLowerCase() === key);
    }

    public isExplicitFolder(name: string): boolean {
        const key = name.trim().toLowerCase();
        return this.pendingFolders.some((folder) => folder.trim().toLowerCase() === key);
    }

    public addPendingFolder(name: string): void {
        if (this.isExplicitFolder(name)) {
            return;
        }
        this.pendingFolders.push(name.trim());
        this.persistPendingFolders();
    }

    public removePendingFolder(name: string): void {
        const key = name.trim().toLowerCase();
        this.pendingFolders = this.pendingFolders.filter(
            (folder) => folder.trim().toLowerCase() !== key,
        );
        this.persistPendingFolders();
    }

    public renamePendingFolder(from: string, to: string): void {
        const key = from.trim().toLowerCase();
        this.pendingFolders = this.pendingFolders.map((folder) =>
            folder.trim().toLowerCase() === key ? to.trim() : folder,
        );
        this.persistPendingFolders();
    }

    private persistPendingFolders(): void {
        void this.workspaceState?.update(PENDING_FOLDERS_STATE_KEY, [...this.pendingFolders]);
    }

    // -- tree projection ------------------------------------------------------

    public getTreeItem(node: RunbookLibraryNode): vscode.TreeItem {
        switch (node.kind) {
            case "group": {
                // Archived and pending (empty) groups start collapsed; the
                // archived label is localized, category labels data-derived.
                const item = new vscode.TreeItem(
                    node.archived
                        ? LocRunbookStudio.libraryArchivedGroup
                        : libraryCategoryLabel(node.category),
                    node.archived || node.items.length === 0
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.Expanded,
                );
                item.iconPath = new vscode.ThemeIcon(node.archived ? "archive" : "library");
                item.contextValue = node.archived
                    ? "runbookLibraryGroupArchived"
                    : "runbookLibraryGroup";
                return item;
            }
            case "asset": {
                // Collapsible: children are the runbook's recent run
                // history, fetched lazily on expand (getChildren).
                const item = new vscode.TreeItem(
                    node.asset.title,
                    vscode.TreeItemCollapsibleState.Collapsed,
                );
                const archived = isArchivedLibraryAsset(node.asset);
                const running =
                    !archived &&
                    (this.serviceAccessor()?.activeLibraryAssetIds().has(node.asset.id) ?? false);
                item.iconPath = new vscode.ThemeIcon(running ? "sync" : "book");
                item.contextValue = archived ? "runbookLibraryItemArchived" : "runbookLibraryItem";
                const description = libraryItemDescription(
                    node.asset,
                    running ? LocRunbookStudio.libraryRunningBadge : undefined,
                    LocRunbookStudio.libraryDesignOnlyBadge,
                );
                if (description.length > 0) {
                    item.description = description;
                }
                item.tooltip = node.asset.missingActivityKinds?.length
                    ? `${node.asset.description ?? node.asset.title}\n${LocRunbookStudio.libraryMissingCapabilities(
                          node.asset.missingActivityKinds.join(", "),
                      )}`
                    : (node.asset.description ?? node.asset.title);
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
        // Running badges: refresh whenever a run is accepted or ends
        // (subscribe once, lazily — the service itself is lazy).
        this.runsSubscription ??= service.onDidChangeActiveRuns(() => this.refresh());
        const result = await service.listLibraryRunbooks();
        if (result.error) {
            // One informational node with the honest reason — never a
            // silently blank tree.
            return [{ kind: "message", message: result.error.message }];
        }
        const assets = result.assets ?? [];
        this.lastAssets = assets;
        // Normalize legacy/duplicate state without dropping explicit folders
        // merely because they currently contain a runbook.
        const pruned = remainingPendingFolders(this.pendingFolders, assets);
        if (JSON.stringify(pruned) !== JSON.stringify(this.pendingFolders)) {
            this.pendingFolders = pruned;
            this.persistPendingFolders();
        }
        if (assets.length === 0 && this.pendingFolders.length === 0) {
            return [{ kind: "message", message: LocRunbookStudio.libraryEmpty }];
        }
        return collectLibraryGroups(assets, this.pendingFolders).map(
            (group): RunbookLibraryNode => ({
                kind: "group",
                category: group.category,
                items: group.items,
                ...(group.archived ? { archived: true } : {}),
                ...(group.pending ? { pending: true } : {}),
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
        // Drafts have never been published, so they cannot have runs — say so
        // directly instead of fetching (which would also spawn the runtime
        // just to expand a tree node, and surfaced an abort error live).
        if (asset.state === "draft") {
            return [{ kind: "message", message: LocRunbookStudio.libraryNoRuns }];
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

/** Folder-name input with live validation: never empty, never a duplicate
 *  of an existing category or pending folder (a case-insensitive match to
 *  `allowCurrent` is fine — that is the folder being renamed). Returns the
 *  trimmed name, or undefined when dismissed. */
async function promptFolderName(
    provider: RunbookLibraryProvider,
    prompt: string,
    options?: { value?: string; allowCurrent?: string },
): Promise<string | undefined> {
    const allowKey = options?.allowCurrent?.trim().toLowerCase();
    const raw = await vscode.window.showInputBox({
        prompt,
        value: options?.value,
        validateInput: (input) => {
            const name = input.trim();
            if (!name) {
                return LocRunbookStudio.libraryFolderNameEmpty;
            }
            if (name.toLowerCase() !== allowKey && provider.hasFolder(name)) {
                return LocRunbookStudio.libraryFolderExists(name);
            }
            return undefined;
        },
    });
    const name = raw?.trim();
    return name ? name : undefined;
}

/** Register the Runbook Library tree view and its commands. Called only when
 *  the runbookStudio preview gate is on (same gate as the custom editor). */
export function registerRunbookLibrary(
    context: vscode.ExtensionContext,
    serviceAccessor: () => RunbookStudioService | undefined,
    /** The artifact of the focused Runbook Studio editor, if any. */
    activeArtifact: () => RunbookArtifactFile | undefined,
    /** Backing URI of that editor (command-palette focus safe). */
    activeDocumentUri: () => vscode.Uri | undefined,
): void {
    const provider = new RunbookLibraryProvider(serviceAccessor, context.workspaceState);

    const requireService = (): RunbookStudioService | undefined => {
        const service = serviceAccessor();
        if (!service) {
            void vscode.window.showErrorMessage(LocRunbookStudio.runtimeUnavailable);
        }
        return service;
    };

    /** True when a stash exists for the asset — importing the runtime asset
     *  first when it was authored outside VS Code (no publish-time stash;
     *  D-0012 library interop). A failed import shows the precise failure
     *  reason and returns false. */
    async function ensureStashed(assetId: string): Promise<boolean> {
        if ((await readStash(context.globalStorageUri, assetId)) !== undefined) {
            return true;
        }
        const service = requireService();
        if (!service) {
            return false;
        }
        const imported = await service.importLibraryRunbook(assetId);
        if (!imported.ok) {
            void vscode.window.showErrorMessage(
                imported.error?.message ?? LocRunbookStudio.runtimeUnavailable,
            );
            return false;
        }
        // A fresh import may change what the tree should show (e.g. the
        // asset's stash-backed affordances) — keep it current.
        provider.refresh();
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
            // Virtual scheme (D-0014 step c): open mssql-runbook:/<id>
            // instead of the stash's file: path — the FS provider serves the
            // same stash bytes, and hot exit restores a clean library URI
            // rather than a globalStorage path. Previously-opened stash-path
            // (file:) tabs keep working; new opens prefer the virtual URI.
            await vscode.commands.executeCommand(
                "vscode.openWith",
                runbookVirtualUri(node.asset.id),
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
            const service = requireService();
            if (!service) {
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
        vscode.commands.registerCommand("mssql.runbookLibrary.restore", async (node?: unknown) => {
            if (!isAssetNode(node)) {
                return;
            }
            const service = requireService();
            if (!service) {
                return;
            }
            const result = await service.restoreLibraryRunbook(node.asset.id);
            if (result.error) {
                void vscode.window.showErrorMessage(result.error.message);
                return;
            }
            provider.refresh();
            void vscode.window.showInformationMessage(
                LocRunbookStudio.libraryRestored(node.asset.title),
            );
        }),
        vscode.commands.registerCommand("mssql.runbookLibrary.delete", async (node?: unknown) => {
            if (!isAssetNode(node)) {
                return;
            }
            const service = requireService();
            if (!service) {
                return;
            }
            const choice = await vscode.window.showWarningMessage(
                LocRunbookStudio.libraryDeleteConfirm(node.asset.title),
                { modal: true },
                LocRunbookStudio.libraryDeleteAction,
            );
            if (choice !== LocRunbookStudio.libraryDeleteAction) {
                return;
            }
            const result = await service.deleteLibraryRunbookPermanently(node.asset.id);
            if (result.error) {
                void vscode.window.showErrorMessage(result.error.message);
                return;
            }
            provider.refresh();
            void vscode.window.showInformationMessage(
                LocRunbookStudio.libraryDeleted(node.asset.title),
            );
        }),
        vscode.commands.registerCommand("mssql.runbookLibrary.rename", async (node?: unknown) => {
            if (!isAssetNode(node)) {
                return;
            }
            const service = requireService();
            if (!service) {
                return;
            }
            const raw = await vscode.window.showInputBox({
                prompt: LocRunbookStudio.libraryRenamePrompt,
                value: node.asset.title,
                validateInput: (input) =>
                    input.trim() ? undefined : LocRunbookStudio.libraryRunbookNameEmpty,
            });
            const title = raw?.trim();
            if (!title || title === node.asset.title) {
                return;
            }
            const result = await service.updateLibraryRunbook(node.asset.id, { title });
            if (result.error) {
                void vscode.window.showErrorMessage(result.error.message);
                return;
            }
            provider.refresh();
            void vscode.window.showInformationMessage(LocRunbookStudio.libraryRenamed(title));
        }),
        vscode.commands.registerCommand(
            "mssql.runbookLibrary.moveToFolder",
            async (node?: unknown) => {
                if (!isAssetNode(node)) {
                    return;
                }
                const service = requireService();
                if (!service) {
                    return;
                }
                const newFolderLabel = LocRunbookStudio.libraryMoveNewFolderItem;
                const picked = await vscode.window.showQuickPick(
                    [
                        ...provider
                            .knownFolderNames()
                            .map((name): vscode.QuickPickItem => ({ label: name })),
                        { label: newFolderLabel, alwaysShow: true },
                    ],
                    { placeHolder: LocRunbookStudio.libraryMovePickPlaceholder },
                );
                if (!picked) {
                    return;
                }
                let target = picked.label;
                let createdTarget = false;
                if (target === newFolderLabel) {
                    const name = await promptFolderName(
                        provider,
                        LocRunbookStudio.libraryNewFolderPrompt,
                    );
                    if (!name) {
                        return;
                    }
                    target = name;
                    createdTarget = true;
                }
                if (target.toLowerCase() === (node.asset.category ?? "").trim().toLowerCase()) {
                    return;
                }
                const result = await service.updateLibraryRunbook(node.asset.id, {
                    category: target,
                });
                if (result.error) {
                    void vscode.window.showErrorMessage(result.error.message);
                    return;
                }
                if (createdTarget) {
                    provider.addPendingFolder(target);
                }
                provider.refresh();
                void vscode.window.showInformationMessage(
                    LocRunbookStudio.libraryMoved(node.asset.title, target),
                );
            },
        ),
        vscode.commands.registerCommand("mssql.runbookLibrary.newFolder", async () => {
            const name = await promptFolderName(provider, LocRunbookStudio.libraryNewFolderPrompt);
            if (!name) {
                return;
            }
            provider.addPendingFolder(name);
            emitRunbookEvent(
                newRunbookRootContext("library"),
                "runbookStudio.library.newFolder",
                "ok",
                {},
            );
            provider.refresh();
        }),
        vscode.commands.registerCommand(
            "mssql.runbookLibrary.renameFolder",
            async (node?: unknown) => {
                if (!isGroupNode(node) || node.archived) {
                    return;
                }
                const target = await promptFolderName(
                    provider,
                    LocRunbookStudio.libraryRenameFolderPrompt,
                    { value: node.category, allowCurrent: node.category },
                );
                if (!target || target === node.category) {
                    return;
                }
                // An empty explicit folder renames locally; a populated
                // category renames by moving every runbook, sequentially,
                // with partial failures reported honestly.
                if (node.items.length === 0) {
                    provider.renamePendingFolder(node.category, target);
                    emitRunbookEvent(
                        newRunbookRootContext("library"),
                        "runbookStudio.library.renameFolder",
                        "ok",
                        { assetCount: metaField(0) },
                    );
                    provider.refresh();
                    void vscode.window.showInformationMessage(
                        LocRunbookStudio.libraryFolderRenamed(node.category, target),
                    );
                    return;
                }
                const service = requireService();
                if (!service) {
                    return;
                }
                let succeeded = 0;
                let failed = 0;
                const wasExplicit = provider.isExplicitFolder(node.category);
                for (const asset of node.items) {
                    const result = await service.updateLibraryRunbook(asset.id, {
                        category: target,
                    });
                    if (result.error) {
                        failed++;
                    } else {
                        succeeded++;
                    }
                }
                if (failed === 0) {
                    if (wasExplicit) {
                        provider.renamePendingFolder(node.category, target);
                    } else {
                        provider.addPendingFolder(target);
                    }
                } else if (succeeded > 0) {
                    // Partial movement leaves both real categories; keep the
                    // target explicit so it cannot vanish during recovery.
                    provider.addPendingFolder(target);
                }
                emitRunbookEvent(
                    newRunbookRootContext("library"),
                    "runbookStudio.library.renameFolder",
                    failed > 0 ? "warning" : "ok",
                    { assetCount: metaField(succeeded), failedCount: metaField(failed) },
                );
                provider.refresh();
                if (failed > 0) {
                    void vscode.window.showWarningMessage(
                        LocRunbookStudio.libraryFolderRenamePartial(succeeded, failed),
                    );
                } else {
                    void vscode.window.showInformationMessage(
                        LocRunbookStudio.libraryFolderRenamed(node.category, target),
                    );
                }
            },
        ),
        vscode.commands.registerCommand(
            "mssql.runbookLibrary.deleteFolder",
            async (node?: unknown) => {
                if (!isGroupNode(node) || node.archived) {
                    return;
                }
                if (node.items.length > 0) {
                    // Folders are categories on assets — a non-empty one has
                    // nothing to delete except its runbooks. Direct honestly.
                    void vscode.window.showInformationMessage(
                        LocRunbookStudio.libraryFolderNotEmpty(node.items.length),
                    );
                    return;
                }
                provider.removePendingFolder(node.category);
                emitRunbookEvent(
                    newRunbookRootContext("library"),
                    "runbookStudio.library.deleteFolder",
                    "ok",
                    {},
                );
                provider.refresh();
            },
        ),
        vscode.commands.registerCommand(
            "mssql.runbookLibrary.newRunbook",
            async (node?: unknown) => {
                const service = requireService();
                if (!service) {
                    return;
                }
                // Library-first: the draft asset exists in the runtime
                // BEFORE the editor opens, so the tree shows it immediately
                // and Save to Library later updates the same id.
                const category =
                    isGroupNode(node) && !node.archived
                        ? node.category
                        : DEFAULT_NEW_RUNBOOK_CATEGORY;
                const id = `runbook-${Date.now().toString(36)}`;
                const title = LocRunbookStudio.newRunbookName;
                const created = await service.createLibraryRunbook({ id, title, category });
                if (created.error) {
                    void vscode.window.showErrorMessage(created.error.message);
                    return;
                }
                // The service dedupes the title ("New runbook (2)") — the
                // stash artifact MUST carry the same name or the tree and
                // the document header diverge (observed live: names-2.png).
                const artifact = createNewRunbookArtifact(created.title ?? title, id);
                const family = libraryFamilyFromCategory(category);
                if (family !== undefined) {
                    artifact.family = family;
                }
                try {
                    await writeStash(
                        context.globalStorageUri,
                        id,
                        canonicalizeRunbookArtifact(artifact),
                    );
                } catch (error) {
                    void vscode.window.showErrorMessage(
                        LocRunbookStudio.libraryUnavailable(
                            error instanceof Error ? error.message : String(error),
                        ),
                    );
                    return;
                }
                provider.refresh();
                // Same virtual-scheme rationale as the open command: the new
                // draft's document lives on mssql-runbook:, never on the
                // stash's real path.
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    runbookVirtualUri(id),
                    RUNBOOK_EDITOR_VIEW_TYPE,
                );
            },
        ),
        vscode.commands.registerCommand("mssql.runbookStudio.saveToLibrary", async () => {
            const artifact = activeArtifact();
            if (!artifact) {
                void vscode.window.showInformationMessage(LocRunbookStudio.libraryNoActiveRunbook);
                return;
            }
            const service = requireService();
            if (!service) {
                return;
            }
            const documentUri = activeDocumentUri();
            if (documentUri?.scheme === RUNBOOK_FS_SCHEME) {
                const document = vscode.workspace.textDocuments.find(
                    (candidate) => candidate.uri.toString() === documentUri.toString(),
                );
                if (!document || !(await document.save())) {
                    return;
                }
                provider.refresh();
                void vscode.window.showInformationMessage(
                    LocRunbookStudio.libraryCommitted(artifact.name),
                );
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
