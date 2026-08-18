/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
    SimpleQueryMetadataAdapter,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
    type CompletionItem as ServiceCompletionItem,
    type DocumentAnalysisSnapshot,
    type FullColorizationResult,
    type LanguageServiceRuntime,
    type LanguageServiceStats,
    type MetadataProvider,
    type MetadataSection,
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
import {
    applyColorizationEdits,
    documentLineSource,
    encodeSemanticTokens,
    encodeSemanticTokensEdits,
    previewSemanticTokensLegend,
} from "./previewSemanticTokens";
import SqlToolsServiceClient from "../serviceclient";
import type { QueryExecutionCatalogEvent } from "../../models/sqlOutputContentProvider";

const showStatsCommand = "mssql.preview.showLanguageServiceStats";
const refreshMetadataCommand = "mssql.preview.refreshLanguageServiceMetadata";
const statsScheme = "mssql-language-service-stats";
const diagnosticSource = "vscode-mssql-preview";

/** The last full colorization published for one document, kept so deltas have a baseline. */
interface PreviewSemanticTokenCache {
    readonly result: FullColorizationResult;
    readonly data: Uint32Array;
}

interface PreviewDocumentState {
    readonly documentUri: vscode.Uri;
    readonly connectionUri: string;
    readonly metadata: MetadataProvider;
    readonly runtime: LanguageServiceRuntime;
    readonly features: TsqlLanguageFeatureService;
    readonly disposables: vscode.Disposable[];
    queue: Promise<void>;
    syncedVersion: number;
    syncedText: string;
    refreshing: boolean;
    lastRefreshMs?: number;
    lastRefreshError?: string;
    rebindQueued: boolean;
    rebindAfterRefresh: boolean;
    semanticTokens?: PreviewSemanticTokenCache;
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
    private readonly _semanticTokensChanged = new vscode.EventEmitter<void>();
    private readonly _coloring = new TsqlColorizationService();
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
        const completionProvider = new PreviewCompletionProvider(
            () => this._enabled,
            (uri) => this._documents.get(uri.toString()),
        );
        const hoverProvider = new PreviewHoverProvider(
            () => this._enabled,
            (uri) => this._documents.get(uri.toString()),
        );
        const signatureHelpProvider = new PreviewSignatureHelpProvider(
            () => this._enabled,
            (uri) => this._documents.get(uri.toString()),
        );
        const semanticTokensProvider = new PreviewSemanticTokensProvider(
            () => this._enabled,
            (uri) => this._documents.get(uri.toString()),
            this._coloring,
            this._semanticTokensChanged.event,
        );

        this._disposables.push(
            this._diagnostics,
            this._codeLensChanged,
            this._semanticTokensChanged,
            this._statsChanged,
            vscode.languages.registerCodeLensProvider({ language: "sql" }, codeLensProvider),
            vscode.languages.registerCompletionItemProvider(
                { language: "sql" },
                completionProvider,
                ".",
                "*",
                "[",
                '"',
            ),
            vscode.languages.registerHoverProvider({ language: "sql" }, hoverProvider),
            vscode.languages.registerSignatureHelpProvider(
                { language: "sql" },
                signatureHelpProvider,
                "(",
                ",",
            ),
            vscode.languages.registerDocumentSemanticTokensProvider(
                { language: "sql" },
                semanticTokensProvider,
                previewSemanticTokensLegend,
            ),
            vscode.languages.registerDocumentRangeSemanticTokensProvider(
                { language: "sql" },
                semanticTokensProvider,
                previewSemanticTokensLegend,
            ),
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
            this._controller.outputContentProvider.onQueryExecutionCatalogChanged((event) =>
                this.handleQueryExecutionCatalogChanged(event),
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
            // Turning the preview off must drop its coloring rather than leave the last tokens
            // painted, and turning it on must repaint without waiting for the next edit.
            this._semanticTokensChanged.fire();
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
            new CatalogSemanticBinder(),
            metadata,
        );
        const features = new TsqlLanguageFeatureService(runtime, metadata);
        const state: PreviewDocumentState = {
            documentUri: document.uri,
            connectionUri: key,
            metadata,
            runtime,
            features,
            disposables: [],
            queue: Promise.resolve(),
            syncedVersion: document.version,
            syncedText: document.getText(),
            refreshing: false,
            rebindQueued: false,
            rebindAfterRefresh: false,
            disposed: false,
        };
        state.disposables.push(
            asVscodeDisposable(
                runtime.onDidChangeStats((uri) => {
                    if (uri === key) this.fireStatusChanged(state);
                }),
            ),
            asVscodeDisposable(
                metadata.onDidChange(() => {
                    if (state.refreshing) {
                        state.rebindAfterRefresh = true;
                        this.fireStatusChanged(state);
                    } else {
                        this.scheduleRebind(state);
                    }
                }),
            ),
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
            // Binding against newly published metadata can change how names are classified, and
            // no document edit accompanies it, so the editor is asked to refresh coloring.
            this._semanticTokensChanged.fire();
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
            if (state.rebindAfterRefresh) {
                state.rebindAfterRefresh = false;
                this.scheduleRebind(state);
            }
            this.fireStatusChanged(state);
        }
    }

    private handleQueryExecutionCatalogChanged(event: QueryExecutionCatalogEvent): void {
        if (!this._enabled || event.hasError || event.isRefresh || !event.query) return;
        const sections = metadataSectionsInvalidatedByExecutedSql(event.query);
        if (sections.length === 0) return;
        const state = this._documents.get(event.uri);
        if (!state || state.disposed || !state.metadata.refreshSections) return;
        void this.refreshSectionsAfterExecution(state, sections);
    }

    private async refreshSectionsAfterExecution(
        state: PreviewDocumentState,
        sections: readonly MetadataSection[],
    ): Promise<void> {
        const ownsRefreshIndicator = !state.refreshing;
        if (ownsRefreshIndicator) {
            state.refreshing = true;
            state.lastRefreshError = undefined;
            this.fireStatusChanged(state);
        }
        try {
            const result = await state.metadata.refreshSections!(sections);
            if (!state.disposed) state.lastRefreshMs = result.elapsedMs;
        } catch (error) {
            if (!state.disposed) state.lastRefreshError = errorMessage(error);
        } finally {
            if (ownsRefreshIndicator && !state.disposed) {
                state.refreshing = false;
                if (state.rebindAfterRefresh) {
                    state.rebindAfterRefresh = false;
                    this.scheduleRebind(state);
                }
                this.fireStatusChanged(state);
            }
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
                        semanticBinding: "preview-catalog",
                        metadata: state?.metadata.id ?? "unavailable",
                        completions: "preview-catalog",
                        signatureHelp: "preview-catalog-and-document",
                        hover: "preview-catalog",
                        semanticTokens: "preview-syntax-and-catalog",
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

class PreviewCompletionProvider implements vscode.CompletionItemProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
    ) {}

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.CompletionList | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            document.version !== state.syncedVersion
        ) {
            return undefined;
        }
        try {
            let result = state.features.completion(
                state.connectionUri,
                document.version,
                document.offsetAt(position),
            );
            if (result.incomplete && state.metadata.waitForHydration) {
                await waitForInteractiveHydration(state.metadata, token, 1_000);
                if (
                    token.isCancellationRequested ||
                    state.disposed ||
                    document.version !== state.syncedVersion
                ) {
                    return undefined;
                }
                result = state.features.completion(
                    state.connectionUri,
                    document.version,
                    document.offsetAt(position),
                );
            }
            return new vscode.CompletionList(
                result.items.map((item) => toVscodeCompletionItem(document, item)),
                result.incomplete,
            );
        } catch {
            return undefined;
        }
    }
}

async function waitForInteractiveHydration(
    metadata: MetadataProvider,
    token: vscode.CancellationToken,
    timeoutMs: number,
): Promise<void> {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            metadata.waitForHydration!(controller.signal).catch(() => undefined),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
        cancellation.dispose();
        controller.abort();
    }
}

class PreviewHoverProvider implements vscode.HoverProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
    ) {}

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Hover | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            document.version !== state.syncedVersion
        ) {
            return undefined;
        }
        try {
            const result = state.features.hover(
                state.connectionUri,
                document.version,
                document.offsetAt(position),
            );
            return result
                ? new vscode.Hover(
                      new vscode.MarkdownString(result.markdown),
                      result.range &&
                          new vscode.Range(
                              document.positionAt(result.range.start),
                              document.positionAt(result.range.end),
                          ),
                  )
                : undefined;
        } catch {
            return undefined;
        }
    }
}

class PreviewSignatureHelpProvider implements vscode.SignatureHelpProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
    ) {}

    public async provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.SignatureHelp | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        const requestedVersion = document.version;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            requestedVersion !== state.syncedVersion
        ) {
            return undefined;
        }
        try {
            const offset = document.offsetAt(position);
            let result = state.features.signatureHelp(
                state.connectionUri,
                requestedVersion,
                offset,
            );
            if (!result && state.metadata.waitForHydration) {
                await waitForInteractiveHydration(state.metadata, token, 1_000);
                if (
                    token.isCancellationRequested ||
                    state.disposed ||
                    document.version !== requestedVersion ||
                    state.syncedVersion !== requestedVersion
                ) {
                    return undefined;
                }
                result = state.features.signatureHelp(
                    state.connectionUri,
                    requestedVersion,
                    offset,
                );
            }
            if (!result) return undefined;
            const help = new vscode.SignatureHelp();
            help.signatures = result.signatures.map((candidate) => {
                const information = new vscode.SignatureInformation(
                    candidate.label,
                    candidate.documentation
                        ? new vscode.MarkdownString(candidate.documentation)
                        : undefined,
                );
                information.parameters = candidate.parameters.map(
                    (parameter) =>
                        new vscode.ParameterInformation(
                            parameter.label,
                            parameter.documentation
                                ? new vscode.MarkdownString(parameter.documentation)
                                : undefined,
                        ),
                );
                return information;
            });
            help.activeSignature = result.activeSignature;
            help.activeParameter = result.activeParameter;
            return help;
        } catch {
            return undefined;
        }
    }
}

/**
 * Publishes the language service classifications as VS Code semantic tokens. Every request reads
 * the snapshot the runtime already produced, so coloring never parses and never waits on metadata.
 */
class PreviewSemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider, vscode.DocumentRangeSemanticTokensProvider
{
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
        private readonly _coloring: TsqlColorizationService,
        public readonly onDidChangeSemanticTokens: vscode.Event<void>,
    ) {}

    public async provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens | undefined> {
        const state = await this.readySnapshot(document, token);
        if (!state) return undefined;
        try {
            const result = this._coloring.provideDocumentColors(
                state.runtime.snapshot(state.connectionUri, document.version),
            );
            return this.publish(state, document, result);
        } catch {
            return undefined;
        }
    }

    public async provideDocumentSemanticTokensEdits(
        document: vscode.TextDocument,
        previousResultId: string,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens | vscode.SemanticTokensEdits | undefined> {
        const state = await this.readySnapshot(document, token);
        if (!state) return undefined;
        const cached = state.semanticTokens;
        if (!cached || cached.result.resultId !== previousResultId) {
            return this.provideDocumentSemanticTokens(document, token);
        }
        try {
            const snapshot = state.runtime.snapshot(state.connectionUri, document.version);
            const delta = this._coloring.provideColorEdits(cached.result, snapshot, []);
            if (delta.kind !== "delta") return this.publish(state, document, delta);
            if (delta.edits.length === 0) {
                state.semanticTokens = {
                    result: { ...cached.result, resultId: delta.resultId },
                    data: cached.data,
                };
                return new vscode.SemanticTokensEdits([], delta.resultId);
            }
            const tokens = applyColorizationEdits(cached.result.tokens, delta.edits);
            const data = encodeSemanticTokens(tokens, documentLineSource(document));
            state.semanticTokens = {
                result: {
                    kind: "full",
                    resultId: delta.resultId,
                    documentVersion: delta.documentVersion,
                    metadataGeneration: delta.metadataGeneration,
                    tokens,
                },
                data,
            };
            return new vscode.SemanticTokensEdits(
                encodeSemanticTokensEdits(cached.data, data),
                delta.resultId,
            );
        } catch {
            return undefined;
        }
    }

    public async provideDocumentRangeSemanticTokens(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken,
    ): Promise<vscode.SemanticTokens | undefined> {
        const state = await this.readySnapshot(document, token);
        if (!state) return undefined;
        try {
            const snapshot = state.runtime.snapshot(state.connectionUri, document.version);
            const result = this._coloring.provideRangeColors({
                ...snapshot,
                range: {
                    start: document.offsetAt(range.start),
                    end: document.offsetAt(range.end),
                },
            });
            // A range result is a viewport view, never the baseline a later delta is built from.
            return new vscode.SemanticTokens(
                encodeSemanticTokens(result.tokens, documentLineSource(document)),
            );
        } catch {
            return undefined;
        }
    }

    private publish(
        state: PreviewDocumentState,
        document: vscode.TextDocument,
        result: FullColorizationResult,
    ): vscode.SemanticTokens {
        const data = encodeSemanticTokens(result.tokens, documentLineSource(document));
        state.semanticTokens = { result, data };
        return new vscode.SemanticTokens(data, result.resultId);
    }

    private async readySnapshot(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): Promise<PreviewDocumentState | undefined> {
        if (!this._enabled()) return undefined;
        const state = this._state(document.uri);
        if (!state) return undefined;
        await state.queue;
        if (
            token.isCancellationRequested ||
            state.disposed ||
            document.version !== state.syncedVersion
        ) {
            return undefined;
        }
        return state;
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

function toVscodeCompletionItem(
    document: vscode.TextDocument,
    item: ServiceCompletionItem,
): vscode.CompletionItem {
    const result = new vscode.CompletionItem(item.label, completionKind(item.kind));
    result.detail = item.detail;
    result.documentation = item.documentation
        ? new vscode.MarkdownString(item.documentation)
        : undefined;
    result.sortText = item.sortText;
    result.filterText = item.filterText;
    result.insertText = item.edit
        ? item.insertTextFormat === "snippet"
            ? new vscode.SnippetString(item.edit.newText)
            : item.edit.newText
        : item.label;
    result.preselect = item.preselect;
    result.command = item.command;
    if (item.edit) {
        result.range = new vscode.Range(
            document.positionAt(item.edit.start),
            document.positionAt(item.edit.end),
        );
    }
    return result;
}

function completionKind(kind: string): vscode.CompletionItemKind {
    switch (kind) {
        case "database":
            return vscode.CompletionItemKind.Folder;
        case "schema":
            return vscode.CompletionItemKind.Module;
        case "table":
            return vscode.CompletionItemKind.Class;
        case "view":
            return vscode.CompletionItemKind.Interface;
        case "synonym":
            return vscode.CompletionItemKind.Reference;
        case "column":
            return vscode.CompletionItemKind.Field;
        case "procedure":
            return vscode.CompletionItemKind.Method;
        case "function":
        case "scalarFunction":
        case "tableFunction":
            return vscode.CompletionItemKind.Function;
        case "type":
            return vscode.CompletionItemKind.TypeParameter;
        case "parameter":
            return vscode.CompletionItemKind.Variable;
        case "login":
        case "user":
            return vscode.CompletionItemKind.User;
        case "databaseRole":
        case "serverRole":
        case "applicationRole":
            return vscode.CompletionItemKind.Class;
        case "snippet":
            return vscode.CompletionItemKind.Snippet;
        default:
            return vscode.CompletionItemKind.Text;
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

/**
 * Classifies successful submitted SQL for cheap catalog invalidation. Strings, quoted identifiers,
 * and comments are masked so examples or dynamic SQL do not trigger an authoritative reload.
 */
export function metadataSectionsInvalidatedByExecutedSql(sql: string): readonly MetadataSection[] {
    const code = maskSqlNonCode(sql);
    const principalDdl =
        /(?:^|[;\r\n])\s*(?:CREATE|ALTER|DROP)\s+(?:(?:SERVER|APPLICATION|DATABASE)\s+)?(?:LOGIN|USER|ROLE)\b/im;
    const catalogDdl =
        /\b(?:CREATE(?:\s+OR\s+ALTER)?|ALTER|DROP|TRUNCATE)\s+(?:(?:UNIQUE|CLUSTERED|NONCLUSTERED|COLUMNSTORE|XML|SPATIAL|FULLTEXT|PRIMARY)\s+)*[A-Z_][A-Z0-9_]*\b/im;
    const permissionDdl = /\b(?:GRANT|DENY|REVOKE)\b/im;
    const triggerStateDdl = /\b(?:ENABLE|DISABLE)\s+TRIGGER\b/im;
    const selectIntoDdl = /\bSELECT\b[\s\S]*?\bINTO\s+(?!#)/im;
    const catalogProcedure =
        /\bEXEC(?:UTE)?\s+(?:[A-Z_][A-Z0-9_$#@]*\s*=\s*)?(?:SYS\.)?SP_(?:RENAME|ADDTYPE|DROPTYPE|ADDEXTENDEDPROPERTY|UPDATEEXTENDEDPROPERTY|DROPEXTENDEDPROPERTY|ADDROLE|DROPROLE|ADDROLEMEMBER|DROPROLEMEMBER)\b/im;

    if (
        !(
            catalogDdl.test(code) ||
            permissionDdl.test(code) ||
            triggerStateDdl.test(code) ||
            selectIntoDdl.test(code) ||
            catalogProcedure.test(code)
        )
    ) {
        return [];
    }

    // Principal DDL has an isolated authoritative query. Every other catalog mutation takes the
    // conservative path because one statement can affect several related identity/detail indexes.
    if (principalDdl.test(code) && !containsNonPrincipalCatalogMutation(code, principalDdl)) {
        return ["principals"];
    }
    return [
        "databases",
        "schemas",
        "objects",
        "columns",
        "parameters",
        "principals",
        "definitions",
    ];
}

function containsNonPrincipalCatalogMutation(sql: string, principalPattern: RegExp): boolean {
    const withoutPrincipalDdl = sql.replace(new RegExp(principalPattern.source, "gim"), " ");
    return (
        /\b(?:CREATE(?:\s+OR\s+ALTER)?|ALTER|DROP|TRUNCATE)\s+(?:(?:UNIQUE|CLUSTERED|NONCLUSTERED|COLUMNSTORE|XML|SPATIAL|FULLTEXT|PRIMARY)\s+)*[A-Z_][A-Z0-9_]*\b/im.test(
            withoutPrincipalDdl,
        ) ||
        /\b(?:GRANT|DENY|REVOKE)\b/im.test(withoutPrincipalDdl) ||
        /\b(?:ENABLE|DISABLE)\s+TRIGGER\b/im.test(withoutPrincipalDdl) ||
        /\bSELECT\b[\s\S]*?\bINTO\s+(?!#)/im.test(withoutPrincipalDdl) ||
        /\bEXEC(?:UTE)?\s+(?:[A-Z_][A-Z0-9_$#@]*\s*=\s*)?(?:SYS\.)?SP_(?:RENAME|ADDTYPE|DROPTYPE|ADDEXTENDEDPROPERTY|UPDATEEXTENDEDPROPERTY|DROPEXTENDEDPROPERTY|ADDROLE|DROPROLE|ADDROLEMEMBER|DROPROLEMEMBER)\b/im.test(
            withoutPrincipalDdl,
        )
    );
}

function maskSqlNonCode(sql: string): string {
    const result = [...sql];
    let state: "code" | "string" | "quoted" | "bracket" | "lineComment" | "blockComment" = "code";
    let blockDepth = 0;
    for (let index = 0; index < sql.length; index++) {
        const current = sql[index]!;
        const next = sql[index + 1];
        if (state === "code") {
            if (current === "'" || current === '"' || current === "[") {
                state = current === "'" ? "string" : current === '"' ? "quoted" : "bracket";
                result[index] = " ";
            } else if (current === "-" && next === "-") {
                state = "lineComment";
                result[index] = result[index + 1] = " ";
                index++;
            } else if (current === "/" && next === "*") {
                state = "blockComment";
                blockDepth = 1;
                result[index] = result[index + 1] = " ";
                index++;
            }
            continue;
        }
        if (state === "lineComment") {
            if (current === "\r" || current === "\n") state = "code";
            else result[index] = " ";
            continue;
        }
        if (state === "blockComment") {
            if (current === "/" && next === "*") {
                blockDepth++;
                result[index] = result[index + 1] = " ";
                index++;
            } else if (current === "*" && next === "/") {
                blockDepth--;
                result[index] = result[index + 1] = " ";
                index++;
                if (blockDepth === 0) state = "code";
            } else if (current !== "\r" && current !== "\n") {
                result[index] = " ";
            }
            continue;
        }
        result[index] = current === "\r" || current === "\n" ? current : " ";
        const terminator = state === "string" ? "'" : state === "quoted" ? '"' : "]";
        if (current !== terminator) continue;
        if (next === terminator) {
            result[index + 1] = " ";
            index++;
        } else {
            state = "code";
        }
    }
    return result.join("");
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
