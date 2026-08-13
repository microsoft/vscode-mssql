/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
    ScaffoldSemanticBinder,
    SimpleQueryMetadataAdapter,
    type DocumentAnalysisSnapshot,
    type LanguageServiceRuntime,
    type LanguageServiceStats,
    type MetadataProvider,
    type TextChange,
} from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";
import { PreviewLanguageService as PreviewLoc } from "../../constants/locConstants";
import type MainController from "../../controllers/mainController";
import {
    ExtensionSimpleQueryExecutor,
    VscodeMssqlSimpleQueryMetadataLoader,
} from "./simpleQueryMetadata";
import {
    previewLanguageServiceSetting,
    previewLanguageServiceStatsCodeLensSetting,
} from "./productionLanguageServiceIsolation";
import SqlToolsServiceClient from "../serviceclient";

const showStatsCommand = "mssql.preview.showLanguageServiceStats";
const refreshMetadataCommand = "mssql.preview.refreshLanguageServiceMetadata";
const statsScheme = "mssql-language-service-stats";
const diagnosticSource = "vscode-mssql-preview";

interface PreviewDocumentState {
    readonly documentUri: vscode.Uri;
    readonly connectionUri: string;
    readonly metadata: MetadataProvider;
    readonly runtime: LanguageServiceRuntime;
    readonly disposables: vscode.Disposable[];
    queue: Promise<void>;
    syncedVersion: number;
    syncedText: string;
    refreshing: boolean;
    lastRefreshMs?: number;
    lastRefreshError?: string;
    rebindQueued: boolean;
    disposed: boolean;
}

/**
 * Opt-in bridge between VS Code and the host-neutral T-SQL language service.
 *
 * Preview activation exclusively owns editor language features. SQL Tools Service remains active
 * for connections and query execution, but its language-feature results are suppressed.
 */
export class PreviewLanguageServiceIntegration implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _documents = new Map<string, PreviewDocumentState>();
    private readonly _diagnostics = vscode.languages.createDiagnosticCollection(diagnosticSource);
    private readonly _codeLensChanged = new vscode.EventEmitter<void>();
    private readonly _statsChanged = new vscode.EventEmitter<vscode.Uri>();
    private readonly _statsUris = new Map<string, vscode.Uri>();
    private _enabled = false;
    private _statsCodeLensEnabled = false;
    private _disposed = false;

    public constructor(
        context: vscode.ExtensionContext,
        private readonly _controller: MainController,
    ) {
        const codeLensProvider = new PreviewStatusCodeLensProvider(
            () => isPreviewStatsCodeLensEnabled(this._enabled, this._statsCodeLensEnabled),
            (uri) => this._documents.get(uri.toString()),
            this._codeLensChanged.event,
        );
        const statsProvider = new PreviewStatsDocumentProvider(
            (uri) => this.statsDocument(uri),
            this._statsChanged.event,
        );

        this._disposables.push(
            this._diagnostics,
            this._codeLensChanged,
            this._statsChanged,
            vscode.languages.registerCodeLensProvider({ language: "sql" }, codeLensProvider),
            vscode.workspace.registerTextDocumentContentProvider(statsScheme, statsProvider),
            vscode.commands.registerCommand(showStatsCommand, (uri?: vscode.Uri) =>
                this.showStats(uri),
            ),
            vscode.commands.registerCommand(refreshMetadataCommand, (uri?: vscode.Uri) =>
                this.refreshMetadata(uri, true),
            ),
            vscode.workspace.onDidOpenTextDocument((document) => this.openDocument(document)),
            vscode.workspace.onDidChangeTextDocument((event) =>
                this.changeDocument(event.document),
            ),
            vscode.workspace.onDidCloseTextDocument((document) => this.closeDocument(document.uri)),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration(previewLanguageServiceSetting) ||
                    event.affectsConfiguration(previewLanguageServiceStatsCodeLensSetting)
                ) {
                    this.applyConfiguration();
                }
            }),
            this._controller.connectionManager.onConnectionsChanged(() =>
                this.rebuildConnectedDocuments(),
            ),
        );
        context.subscriptions.push(this);
        this.applyConfiguration();
    }

    public dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this.stop();
        for (const disposable of this._disposables.splice(0)) disposable.dispose();
    }

    private applyConfiguration(): void {
        const configuration = vscode.workspace.getConfiguration();
        const enabled = configuration.get<boolean>(previewLanguageServiceSetting, false);
        const statsCodeLensEnabled = configuration.get<boolean>(
            previewLanguageServiceStatsCodeLensSetting,
            false,
        );
        const previewChanged = enabled !== this._enabled;
        const statsCodeLensChanged = statsCodeLensEnabled !== this._statsCodeLensEnabled;
        if (!previewChanged && !statsCodeLensChanged) return;
        this._enabled = enabled;
        this._statsCodeLensEnabled = statsCodeLensEnabled;
        if (previewChanged) {
            if (enabled) {
                for (const document of vscode.workspace.textDocuments) {
                    if (isSqlDocument(document)) {
                        SqlToolsServiceClient.instance.clearLanguageServiceDiagnostics(
                            document.uri,
                        );
                    }
                    this.openDocument(document);
                }
            } else {
                this.stop();
            }
        }
        this._codeLensChanged.fire();
    }

    private stop(): void {
        for (const uri of [...this._documents.keys()]) this.disposeState(uri);
        this._diagnostics.clear();
        this._statsUris.clear();
    }

    private openDocument(document: vscode.TextDocument): void {
        if (!this._enabled || !isSqlDocument(document) || this._disposed) return;
        const key = document.uri.toString();
        if (this._documents.has(key)) return;

        const metadata = this.createMetadataProvider(key);
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(),
            new ScaffoldSemanticBinder(),
            metadata,
        );
        const state: PreviewDocumentState = {
            documentUri: document.uri,
            connectionUri: key,
            metadata,
            runtime,
            disposables: [],
            queue: Promise.resolve(),
            syncedVersion: document.version,
            syncedText: document.getText(),
            refreshing: false,
            rebindQueued: false,
            disposed: false,
        };
        state.disposables.push(
            asVscodeDisposable(
                runtime.onDidChangeStats((uri) => {
                    if (uri === key) this.fireStatusChanged(state);
                }),
            ),
            asVscodeDisposable(metadata.onDidChange(() => this.scheduleRebind(state))),
        );
        this._documents.set(key, state);

        this.enqueue(state, async () => {
            const snapshot = await state.runtime.open(key, state.syncedVersion, state.syncedText);
            this.publishDiagnostics(state, snapshot);
        });

        if (this._controller.connectionManager.isConnected(key)) {
            void this.refreshState(state, false);
        }
        this.fireStatusChanged(state);
    }

    private changeDocument(document: vscode.TextDocument): void {
        if (!this._enabled || !isSqlDocument(document)) return;
        const key = document.uri.toString();
        let state = this._documents.get(key);
        if (!state) {
            this.openDocument(document);
            state = this._documents.get(key);
        }
        if (!state) return;

        const version = document.version;
        const text = document.getText();
        this.enqueue(state, async () => {
            if (version <= state.syncedVersion && text === state.syncedText) return;
            const change = computeSingleTextChange(state.syncedText, text);
            let snapshot: DocumentAnalysisSnapshot;
            try {
                snapshot = await state.runtime.change(
                    key,
                    state.syncedVersion,
                    version,
                    change ? [change] : [],
                );
            } catch {
                snapshot = await state.runtime.open(key, version, text);
            }
            state.syncedVersion = version;
            state.syncedText = text;
            this.publishDiagnostics(state, snapshot);
        });
    }

    private closeDocument(uri: vscode.Uri): void {
        this.disposeState(uri.toString());
    }

    private disposeState(key: string): void {
        const state = this._documents.get(key);
        if (!state) return;
        this._documents.delete(key);
        state.disposed = true;
        for (const disposable of state.disposables) disposable.dispose();
        void state.runtime.close(key);
        this._diagnostics.delete(state.documentUri);
        this.fireStatusChanged(state);
    }

    private rebuildConnectedDocuments(): void {
        if (!this._enabled) return;
        for (const document of vscode.workspace.textDocuments.filter(isSqlDocument)) {
            const key = document.uri.toString();
            const state = this._documents.get(key);
            const expectedProvider = this._controller.connectionManager.isConnected(key)
                ? "simple-query"
                : "null";
            if (!state || state.metadata.id !== expectedProvider) {
                this.disposeState(key);
                this.openDocument(document);
            }
        }
    }

    private createMetadataProvider(connectionUri: string): MetadataProvider {
        if (!this._controller.connectionManager.isConnected(connectionUri)) {
            return new NullMetadataProvider();
        }
        return new SimpleQueryMetadataAdapter(
            new ExtensionSimpleQueryExecutor(
                this._controller.connectionSharingService,
                connectionUri,
            ),
            new VscodeMssqlSimpleQueryMetadataLoader(),
        );
    }

    private enqueue(state: PreviewDocumentState, operation: () => Promise<void>): void {
        state.queue = state.queue
            .then(async () => {
                if (!state.disposed && this._documents.get(state.connectionUri) === state) {
                    await operation();
                }
            })
            .catch((error: unknown) => {
                if (!state.disposed) {
                    state.lastRefreshError = errorMessage(error);
                    this.fireStatusChanged(state);
                }
            });
    }

    private scheduleRebind(state: PreviewDocumentState): void {
        if (state.rebindQueued) return;
        state.rebindQueued = true;
        this.enqueue(state, async () => {
            state.rebindQueued = false;
            const snapshot = await state.runtime.rebind(state.connectionUri, state.syncedVersion);
            this.publishDiagnostics(state, snapshot);
        });
    }

    private publishDiagnostics(
        state: PreviewDocumentState,
        snapshot: DocumentAnalysisSnapshot,
    ): void {
        const document = vscode.workspace.textDocuments.find(
            (candidate) => candidate.uri.toString() === state.connectionUri,
        );
        if (!document || document.version !== snapshot.text.version) return;
        const diagnostics = [
            ...snapshot.syntax.diagnostics.map((diagnostic) =>
                toVscodeDiagnostic(document, diagnostic, diagnosticSource),
            ),
            ...snapshot.semantics.diagnostics.map((diagnostic) =>
                toVscodeDiagnostic(document, diagnostic, diagnosticSource),
            ),
        ];
        this._diagnostics.set(document.uri, diagnostics);
    }

    private async refreshMetadata(uri: vscode.Uri | undefined, notify: boolean): Promise<void> {
        if (!this._enabled) {
            if (notify) {
                void vscode.window.showInformationMessage(PreviewLoc.enableSettingFirst);
            }
            return;
        }
        const document = this.resolveSqlDocument(uri);
        if (!document) {
            if (notify) {
                void vscode.window.showInformationMessage(PreviewLoc.openEditorToRefresh);
            }
            return;
        }
        const state = this._documents.get(document.uri.toString());
        if (!state || state.metadata.id === "null") {
            if (notify) {
                void vscode.window.showInformationMessage(PreviewLoc.connectBeforeRefresh);
            }
            return;
        }
        await this.refreshState(state, notify);
    }

    private async refreshState(state: PreviewDocumentState, notify: boolean): Promise<void> {
        if (state.refreshing) return;
        state.refreshing = true;
        state.lastRefreshError = undefined;
        this.fireStatusChanged(state);
        try {
            const result = await state.metadata.refresh();
            state.lastRefreshMs = result.elapsedMs;
            if (notify) {
                void vscode.window.showInformationMessage(
                    PreviewLoc.metadataRefreshed(result.elapsedMs.toFixed(1)),
                );
            }
        } catch (error) {
            state.lastRefreshError = errorMessage(error);
            if (notify) {
                void vscode.window.showErrorMessage(
                    PreviewLoc.metadataRefreshFailed(state.lastRefreshError),
                );
            }
        } finally {
            state.refreshing = false;
            this.fireStatusChanged(state);
        }
    }

    private async showStats(uri: vscode.Uri | undefined): Promise<void> {
        const document = this.resolveSqlDocument(uri);
        if (!document) {
            void vscode.window.showInformationMessage(PreviewLoc.openEditorForStats);
            return;
        }
        const source = document.uri.toString();
        let statsUri = this._statsUris.get(source);
        if (!statsUri) {
            statsUri = vscode.Uri.from({
                scheme: statsScheme,
                path: "/language-service-stats.json",
                query: encodeURIComponent(source),
            });
            this._statsUris.set(source, statsUri);
        }
        const statsDocument = await vscode.workspace.openTextDocument(statsUri);
        await vscode.languages.setTextDocumentLanguage(statsDocument, "json");
        await vscode.window.showTextDocument(statsDocument, {
            preview: true,
            preserveFocus: false,
        });
    }

    private resolveSqlDocument(uri: vscode.Uri | undefined): vscode.TextDocument | undefined {
        if (uri) {
            return vscode.workspace.textDocuments.find(
                (document) => document.uri.toString() === uri.toString() && isSqlDocument(document),
            );
        }
        const active = vscode.window.activeTextEditor?.document;
        return active && isSqlDocument(active) ? active : undefined;
    }

    private statsDocument(statsUri: vscode.Uri): string {
        const sourceUri = decodeURIComponent(statsUri.query);
        const state = this._documents.get(sourceUri);
        const stats = state?.runtime.getStats(sourceUri);
        return JSON.stringify(
            {
                preview: {
                    enabled: this._enabled,
                    featureRouting: {
                        documentSynchronization: "preview",
                        syntaxDiagnostics: "preview",
                        semanticBinding: "preview-scaffold",
                        metadata: state?.metadata.id ?? "unavailable",
                        completions: "preview-not-implemented",
                        hover: "preview-not-implemented",
                        definitions: "preview-not-implemented",
                        references: "preview-not-implemented",
                        formatting: "preview-not-implemented",
                    },
                    metadataRefreshInProgress: state?.refreshing ?? false,
                    lastMetadataRefreshMs: state?.lastRefreshMs,
                    lastMetadataRefreshError: state?.lastRefreshError,
                },
                languageService: stats ?? null,
            },
            undefined,
            4,
        );
    }

    private fireStatusChanged(state: PreviewDocumentState): void {
        this._codeLensChanged.fire();
        const statsUri = this._statsUris.get(state.connectionUri);
        if (statsUri) this._statsChanged.fire(statsUri);
    }
}

class PreviewStatusCodeLensProvider implements vscode.CodeLensProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
        public readonly onDidChangeCodeLenses: vscode.Event<void>,
    ) {}

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!this._enabled()) return [];
        const state = this._state(document.uri);
        const stats = state?.runtime.getStats(document.uri.toString());
        return [
            new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: statusTitle(state, stats),
                tooltip: PreviewLoc.openDetailedStatus,
                command: showStatsCommand,
                arguments: [document.uri],
            }),
        ];
    }
}

class PreviewStatsDocumentProvider implements vscode.TextDocumentContentProvider {
    public constructor(
        private readonly _content: (uri: vscode.Uri) => string,
        public readonly onDidChange: vscode.Event<vscode.Uri>,
    ) {}

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this._content(uri);
    }
}

/** Collapse a VS Code document update into one equivalent UTF-16 edit for incremental parsing. */
export function computeSingleTextChange(previous: string, next: string): TextChange | undefined {
    if (previous === next) return undefined;
    let start = 0;
    const sharedLength = Math.min(previous.length, next.length);
    while (start < sharedLength && previous.charCodeAt(start) === next.charCodeAt(start)) start++;

    let previousEnd = previous.length;
    let nextEnd = next.length;
    while (
        previousEnd > start &&
        nextEnd > start &&
        previous.charCodeAt(previousEnd - 1) === next.charCodeAt(nextEnd - 1)
    ) {
        previousEnd--;
        nextEnd--;
    }
    return { start, end: previousEnd, text: next.slice(start, nextEnd) };
}

export function isPreviewStatsCodeLensEnabled(
    languageServiceEnabled: boolean,
    statsCodeLensEnabled: boolean,
): boolean {
    return languageServiceEnabled && statsCodeLensEnabled;
}

function toVscodeDiagnostic(
    document: vscode.TextDocument,
    diagnostic: {
        readonly code: string;
        readonly message: string;
        readonly severity: "error" | "warning" | "information" | "hint";
        readonly range: { readonly start: number; readonly end: number };
    },
    source: string,
): vscode.Diagnostic {
    const result = new vscode.Diagnostic(
        new vscode.Range(
            document.positionAt(diagnostic.range.start),
            document.positionAt(diagnostic.range.end),
        ),
        diagnostic.message,
        severity(diagnostic.severity),
    );
    result.code = diagnostic.code;
    result.source = source;
    return result;
}

function severity(value: "error" | "warning" | "information" | "hint"): vscode.DiagnosticSeverity {
    switch (value) {
        case "error":
            return vscode.DiagnosticSeverity.Error;
        case "warning":
            return vscode.DiagnosticSeverity.Warning;
        case "information":
            return vscode.DiagnosticSeverity.Information;
        case "hint":
            return vscode.DiagnosticSeverity.Hint;
    }
}

function statusTitle(
    state: PreviewDocumentState | undefined,
    stats: LanguageServiceStats | undefined,
): string {
    if (!state || !stats) return PreviewLoc.initializing;
    const metadata = state.lastRefreshError
        ? PreviewLoc.metadataFailed
        : state.refreshing
          ? PreviewLoc.metadataLoading
          : state.metadata.id === "null"
            ? PreviewLoc.metadataOffline
            : stats.metadata.completeness.objects === "ready"
              ? PreviewLoc.metadataReady
              : PreviewLoc.metadataPending;
    return PreviewLoc.status(
        stats.syntax.elapsedMs.toFixed(1),
        stats.semantics.elapsedMs.toFixed(1),
        metadata,
    );
}

function isSqlDocument(document: vscode.TextDocument): boolean {
    return document.languageId === "sql" && document.uri.scheme !== statsScheme;
}

function asVscodeDisposable(disposable: { dispose(): void }): vscode.Disposable {
    return disposable;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
