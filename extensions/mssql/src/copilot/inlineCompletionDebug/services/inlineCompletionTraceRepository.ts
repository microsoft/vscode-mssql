/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Sessions domain service for Inline Completion Debug (final plan WI-1.1,
 * addendum §6.1): trace-folder resolution + watcher lifecycle, folder
 * scan/index, per-file include toggles, loading included traces (with the
 * 100k-event dataset warning through the injected dialog host), add-file /
 * change-folder / enable-collection workflows, live-session import/export,
 * and save-trace-now.
 *
 * One instance per viewer host; state is the standalone panel's Sessions read
 * model exactly as before extraction. Dialogs and settings writes ride the
 * injected host services so the whole domain is testable with fakes.
 */

import * as vscode from "vscode";
import { TextDecoder, TextEncoder } from "util";
import * as Constants from "../../../constants/constants";
import { getErrorMessage } from "../../../utils/utils";
import {
    InlineCompletionDebugExportData,
    InlineCompletionDebugSessionsState,
} from "../../../sharedInterfaces/inlineCompletionDebug";
import { inlineCompletionDebugStore } from "../inlineCompletionDebugStore";
import {
    createTraceFolderWatcher,
    indexTraceFile,
    loadTraceFile,
    normalizeTraceFile,
    scanTraceFolder,
} from "../traceLoader";
import {
    getConfiguredTraceFolder,
    getTraceCaptureEnabledSetting,
    saveInlineCompletionTraceNow,
} from "../tracePersistence";
import {
    completionsStoredSessionsConfigured,
    listStoredCompletionSessionEntries,
    loadStoredCompletionSessionTrace,
} from "../storedSessionProvider";
import { getRecordWhenClosedSetting } from "./inlineCompletionCaptureService";
import { InlineCompletionDebugHostServices } from "./inlineCompletionDebugHostServices";

export interface InlineCompletionTraceRepositoryDeps {
    extensionContext: vscode.ExtensionContext;
    hostServices: InlineCompletionDebugHostServices;
}

export class InlineCompletionTraceRepository {
    private readonly _onDidChangeEmitter = new vscode.EventEmitter<void>();
    private _sessionsState: InlineCompletionDebugSessionsState;
    private _traceFolderWatcher: vscode.FileSystemWatcher | undefined;
    private _disposed = false;

    /** Fires whenever the sessions read model changed (incl. loading flips). */
    public readonly onDidChange = this._onDidChangeEmitter.event;

    constructor(private readonly _deps: InlineCompletionTraceRepositoryDeps) {
        this._sessionsState = createEmptySessionsState(
            getConfiguredTraceFolder(_deps.extensionContext),
        );
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._traceFolderWatcher?.dispose();
        this._traceFolderWatcher = undefined;
        this._onDidChangeEmitter.dispose();
    }

    public getSessionsState(): InlineCompletionDebugSessionsState {
        return this._sessionsState;
    }

    /**
     * Trace-folder setting changed but no sessions surface is active: drop
     * the watcher and reset to an empty read model on the new folder without
     * scanning (the Debug Console adapter's path).
     */
    public handleTraceFolderConfigurationChange(): void {
        this._traceFolderWatcher?.dispose();
        this._traceFolderWatcher = undefined;
        this.setSessionsState(
            createEmptySessionsState(getConfiguredTraceFolder(this._deps.extensionContext)),
        );
    }

    public async refreshSessions(options: { resetFolder?: boolean } = {}): Promise<void> {
        const traceFolder = getConfiguredTraceFolder(this._deps.extensionContext);
        if (options.resetFolder || traceFolder !== this._sessionsState.traceFolder) {
            this._traceFolderWatcher?.dispose();
            this._traceFolderWatcher = undefined;
            this._sessionsState = createEmptySessionsState(traceFolder);
        }

        this.ensureTraceFolderWatcher(traceFolder);
        this.setSessionsState({
            ...this._sessionsState,
            traceFolder,
            loading: true,
            error: undefined,
        });

        try {
            const hadExistingIndex = this._sessionsState.traceIndex.length > 0;
            const includedFileKeys = new Set(
                this._sessionsState.traceIndex
                    .filter((entry) => entry.included)
                    .map((entry) => entry.fileKey),
            );
            const loadedFileKeys = new Set(
                this._sessionsState.loadedTraces.map((trace) => trace.fileKey),
            );
            const folderEntries = await scanTraceFolder(
                traceFolder,
                hadExistingIndex ? includedFileKeys : new Set(),
                loadedFileKeys,
            );
            // WI-2.5: journal-backed capture sessions from the local store,
            // side by side with folder/imported files (manifest-only index;
            // the current live epoch is excluded by the provider). Failure
            // here never breaks the folder dataset.
            let storedEntries: InlineCompletionDebugSessionsState["traceIndex"] = [];
            if (completionsStoredSessionsConfigured()) {
                try {
                    storedEntries = await listStoredCompletionSessionEntries({
                        includedFileKeys,
                        loadedFileKeys,
                        hadExistingIndex,
                    });
                } catch {
                    storedEntries = [];
                }
            }
            const importedEntries = this._sessionsState.traceIndex.filter(
                (entry) => entry.imported,
            );
            const mergedEntries = mergeTraceIndexEntries(
                [...folderEntries, ...storedEntries],
                importedEntries,
            );

            this._sessionsState = {
                ...this._sessionsState,
                traceIndex: mergedEntries,
                loading: false,
                lastRefreshedAt: Date.now(),
            };
            await this.loadIncludedSessionTraces();
        } catch (error) {
            this._sessionsState = {
                ...this._sessionsState,
                loading: false,
                error: getErrorMessage(error),
            };
        }

        this.fireChanged();
    }

    public async toggleTraceIncluded(fileKey: string, included: boolean): Promise<void> {
        this._sessionsState = {
            ...this._sessionsState,
            traceIndex: this._sessionsState.traceIndex.map((entry) =>
                entry.fileKey === fileKey ? { ...entry, included } : entry,
            ),
        };
        await this.loadIncludedSessionTraces();
        this.fireChanged();
    }

    public async setAllTracesIncluded(included: boolean): Promise<void> {
        this._sessionsState = {
            ...this._sessionsState,
            traceIndex: this._sessionsState.traceIndex.map((entry) => ({
                ...entry,
                included,
            })),
        };
        await this.loadIncludedSessionTraces();
        this.fireChanged();
    }

    public async loadIncludedSessionTraces(): Promise<void> {
        const includedEntries = this._sessionsState.traceIndex.filter(
            (entry) => entry.included && !entry.loadError,
        );
        const cached = new Map(
            this._sessionsState.loadedTraces.map((loaded) => [loaded.fileKey, loaded.trace]),
        );
        const unloadedEntries = includedEntries.filter((entry) => !cached.has(entry.fileKey));
        const totalEventCount = includedEntries.reduce((sum, entry) => sum + entry.eventCount, 0);

        if (totalEventCount > 100_000) {
            const selection = await this._deps.hostServices.showWarningMessage(
                `The selected trace dataset contains ${totalEventCount.toLocaleString()} events. Loading it may use significant memory.`,
                { modal: false },
                "Load traces",
            );
            if (selection !== "Load traces") {
                this.setSessionsState({
                    ...this._sessionsState,
                    warning: "Dataset load cancelled because it exceeds 100,000 events.",
                });
                return;
            }
        }

        if (unloadedEntries.length === 0) {
            this.setSessionsState({
                ...this._sessionsState,
                traceIndex: this._sessionsState.traceIndex.map((entry) => ({
                    ...entry,
                    loaded: cached.has(entry.fileKey),
                })),
                warning: undefined,
            });
            return;
        }

        this.setSessionsState({
            ...this._sessionsState,
            loading: true,
            warning: undefined,
        });

        const newlyLoaded = [];
        const loadErrors = new Map<string, string>();
        for (const entry of unloadedEntries) {
            try {
                const trace = await loadTraceForEntry(entry);
                cached.set(entry.fileKey, trace);
                newlyLoaded.push({ fileKey: entry.fileKey, trace });
            } catch (error) {
                loadErrors.set(entry.fileKey, getErrorMessage(error));
            }
        }

        this.setSessionsState({
            ...this._sessionsState,
            loadedTraces: [
                ...this._sessionsState.loadedTraces,
                ...newlyLoaded.filter(
                    (loaded) =>
                        !this._sessionsState.loadedTraces.some(
                            (existing) => existing.fileKey === loaded.fileKey,
                        ),
                ),
            ],
            traceIndex: this._sessionsState.traceIndex.map((entry) => ({
                ...entry,
                loaded: cached.has(entry.fileKey),
                loadError: loadErrors.get(entry.fileKey) ?? entry.loadError,
            })),
            loading: false,
        });
    }

    public async addSessionTraceFile(): Promise<void> {
        const fileUris = await this._deps.hostServices.showOpenDialog({
            title: "Add Inline Completion Trace File",
            canSelectFiles: true,
            canSelectMany: true,
            filters: {
                JSON: ["json"],
            },
        });

        if (!fileUris?.length) {
            return;
        }

        const loadedTraces = [...this._sessionsState.loadedTraces];
        const entries = [...this._sessionsState.traceIndex];
        for (const fileUri of fileUris) {
            const trace = await loadTraceFile(fileUri.fsPath);
            const stat = await vscode.workspace.fs.stat(fileUri);
            const entry = await indexTraceFile(fileUri.fsPath, {
                included: true,
                loaded: true,
                imported: true,
            });
            entries.push({ ...entry, fileSizeBytes: stat.size });
            loadedTraces.push({ fileKey: fileUri.fsPath, trace });
        }

        this.setSessionsState({
            ...this._sessionsState,
            traceIndex: mergeTraceIndexEntries(entries, []),
            loadedTraces: dedupeLoadedTraces(loadedTraces),
            error: undefined,
        });
    }

    public async changeTraceFolder(): Promise<void> {
        const selectedFolders = await this._deps.hostServices.showOpenDialog({
            title: "Choose Inline Completion Trace Folder",
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(this._sessionsState.traceFolder),
        });
        const selectedFolder = selectedFolders?.[0];
        if (!selectedFolder) {
            return;
        }

        await this._deps.hostServices.updateConfiguration(
            Constants.configCopilotInlineCompletionsTraceFolder,
            selectedFolder.fsPath,
        );
        await this.refreshSessions({ resetFolder: true });
    }

    public async enableTraceCollection(): Promise<void> {
        const currentFolder = getConfiguredTraceFolder(this._deps.extensionContext);
        const useFolder = "Use this folder";
        const chooseOtherFolder = "Choose other folder";
        const selection = await this._deps.hostServices.showInformationMessage(
            `Enable inline completion trace collection and save trace files to ${currentFolder}?`,
            useFolder,
            chooseOtherFolder,
        );

        if (!selection) {
            return;
        }

        let resetFolder = false;
        if (selection === chooseOtherFolder) {
            const selectedFolders = await this._deps.hostServices.showOpenDialog({
                title: "Choose Inline Completion Trace Folder",
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri: vscode.Uri.file(currentFolder),
            });
            const selectedFolder = selectedFolders?.[0];
            if (!selectedFolder) {
                return;
            }

            await this._deps.hostServices.updateConfiguration(
                Constants.configCopilotInlineCompletionsTraceFolder,
                selectedFolder.fsPath,
            );
            resetFolder = true;
        }

        await this._deps.hostServices.updateConfiguration(
            Constants.configCopilotInlineCompletionsTraceCaptureEnabled,
            true,
        );
        await this.refreshSessions({ resetFolder });
    }

    public async showSyncToDatabaseNotImplemented(): Promise<void> {
        await this._deps.hostServices.showInformationMessage(
            `Database sync is not yet implemented. Traces are currently saved to: ${getConfiguredTraceFolder(
                this._deps.extensionContext,
            )}`,
        );
    }

    public async saveTraceNow(): Promise<void> {
        await saveInlineCompletionTraceNow(this._deps.extensionContext);
    }

    /** Export the current live session to a user-chosen JSON file. */
    public async exportSession(customPromptLastSavedAt: number | undefined): Promise<void> {
        const defaultFileName = `inline-completion-debug-${Date.now()}.json`;
        const defaultFolder =
            vscode.workspace.workspaceFolders?.[0]?.uri ??
            this._deps.extensionContext.globalStorageUri;
        const fileUri = await this._deps.hostServices.showSaveDialog({
            title: "Export Inline Completion Debug Session",
            filters: {
                JSON: ["json"],
            },
            defaultUri: vscode.Uri.joinPath(defaultFolder, defaultFileName),
        });

        if (!fileUri) {
            return;
        }

        const exportData = inlineCompletionDebugStore.exportSession(
            getRecordWhenClosedSetting(),
            getExtensionVersion(this._deps.extensionContext),
            customPromptLastSavedAt,
        );
        await this._deps.hostServices.writeFile(
            fileUri,
            new TextEncoder().encode(JSON.stringify(exportData, undefined, 2)),
        );
    }

    /**
     * Import a trace file into the live session. Returns the parsed trace so
     * the caller can apply live-domain follow-ups (custom-prompt persistence);
     * undefined when the user cancelled the dialog.
     */
    public async importSession(): Promise<InlineCompletionDebugExportData | undefined> {
        const fileUris = await this._deps.hostServices.showOpenDialog({
            title: "Import Inline Completion Debug Session",
            canSelectFiles: true,
            canSelectMany: false,
            filters: {
                JSON: ["json"],
            },
        });

        const fileUri = fileUris?.[0];
        if (!fileUri) {
            return undefined;
        }

        const fileContents = await this._deps.hostServices.readFile(fileUri);
        const parsed = normalizeTraceFile(
            JSON.parse(new TextDecoder().decode(fileContents)),
            fileUri.fsPath,
        );
        inlineCompletionDebugStore.importSession(parsed);
        await this._deps.hostServices.updateConfiguration(
            Constants.configCopilotInlineCompletionsDebugRecordWhenClosed,
            parsed.recordWhenClosed ?? false,
        );
        return parsed;
    }

    public async getLoadedTrace(
        fileKey: string,
    ): Promise<InlineCompletionDebugSessionsState["loadedTraces"][number] | undefined> {
        const cached = this._sessionsState.loadedTraces.find((trace) => trace.fileKey === fileKey);
        if (cached) {
            return cached;
        }

        const entry = this._sessionsState.traceIndex.find((trace) => trace.fileKey === fileKey);
        if (!entry || entry.loadError) {
            return undefined;
        }

        try {
            const trace = await loadTraceForEntry(entry);
            const loaded = { fileKey, trace };
            this.setSessionsState({
                ...this._sessionsState,
                loadedTraces: dedupeLoadedTraces([...this._sessionsState.loadedTraces, loaded]),
                traceIndex: this._sessionsState.traceIndex.map((item) =>
                    item.fileKey === fileKey ? { ...item, loaded: true } : item,
                ),
            });
            return loaded;
        } catch (error) {
            this.setSessionsState({
                ...this._sessionsState,
                traceIndex: this._sessionsState.traceIndex.map((item) =>
                    item.fileKey === fileKey
                        ? { ...item, loaded: false, loadError: getErrorMessage(error) }
                        : item,
                ),
            });
            return undefined;
        }
    }

    private ensureTraceFolderWatcher(traceFolder: string): void {
        if (this._traceFolderWatcher) {
            return;
        }

        this._traceFolderWatcher = createTraceFolderWatcher(traceFolder, () => {
            if (!this._disposed) {
                void this.refreshSessions();
            }
        });
    }

    private setSessionsState(next: InlineCompletionDebugSessionsState): void {
        this._sessionsState = next;
        this.fireChanged();
    }

    private fireChanged(): void {
        if (!this._disposed) {
            this._onDidChangeEmitter.fire();
        }
    }
}

/**
 * Load the full trace behind one dataset entry: stored sessions go through
 * the journal reader + compatibility projection (WI-2.5); everything else
 * stays the untrusted-file loader.
 */
async function loadTraceForEntry(
    entry: InlineCompletionDebugSessionsState["traceIndex"][number],
): Promise<InlineCompletionDebugExportData> {
    if (entry.sourceKind === "storedSession") {
        return loadStoredCompletionSessionTrace(entry);
    }
    return loadTraceFile(entry.path);
}

export function createEmptySessionsState(traceFolder: string): InlineCompletionDebugSessionsState {
    return {
        traceFolder,
        traceCaptureEnabled: getTraceCaptureEnabledSetting(),
        traceIndex: [],
        loadedTraces: [],
        loading: false,
    };
}

export function mergeTraceIndexEntries(
    primaryEntries: InlineCompletionDebugSessionsState["traceIndex"],
    secondaryEntries: InlineCompletionDebugSessionsState["traceIndex"],
): InlineCompletionDebugSessionsState["traceIndex"] {
    const byKey = new Map<string, InlineCompletionDebugSessionsState["traceIndex"][number]>();
    for (const entry of [...secondaryEntries, ...primaryEntries]) {
        byKey.set(entry.fileKey, {
            ...byKey.get(entry.fileKey),
            ...entry,
        });
    }

    return Array.from(byKey.values()).sort(
        (left, right) =>
            (right.savedAt ?? "").localeCompare(left.savedAt ?? "") ||
            left.filename.localeCompare(right.filename),
    );
}

export function dedupeLoadedTraces(
    traces: InlineCompletionDebugSessionsState["loadedTraces"],
): InlineCompletionDebugSessionsState["loadedTraces"] {
    const byKey = new Map<string, InlineCompletionDebugSessionsState["loadedTraces"][number]>();
    for (const trace of traces) {
        byKey.set(trace.fileKey, trace);
    }
    return Array.from(byKey.values());
}

function getExtensionVersion(context: vscode.ExtensionContext): string {
    const packageJson = context.extension.packageJSON as { version?: unknown } | undefined;
    return typeof packageJson?.version === "string" ? packageJson.version : "unknown";
}
