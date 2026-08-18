/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CachedObjectDefinitionProvider,
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
    SimpleQueryMetadataAdapter,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
    unknownEngineCapabilities,
    type CompletionItem as ServiceCompletionItem,
    type DocumentAnalysisSnapshot,
    type EngineFacts,
    type FullColorizationResult,
    type LanguageServiceRuntime,
    type LanguageServiceStats,
    type MetadataProvider,
    type MetadataSection,
    type ObjectDefinitionDescriptor,
    type TextChange,
} from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";
import type { IServerInfo } from "vscode-mssql";
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
import { toVscodeFoldingRanges } from "./previewFoldingRanges";
import { ScriptingObjectDefinitionProvider } from "./previewScriptedDefinitions";
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
const definitionScheme = "mssql-definition";
/** Generated documents kept before the least recently published one is dropped. */
const maximumDefinitionDocuments = 32;
const diagnosticSource = "vscode-mssql-preview";

/** The last full colorization published for one document, kept so deltas have a baseline. */
interface PreviewSemanticTokenCache {
    readonly result: FullColorizationResult;
    readonly data: Uint32Array;
}

interface ResolvedDefinitionTarget {
    readonly uri: vscode.Uri;
    readonly targetRange: vscode.Range;
    readonly targetSelectionRange: vscode.Range;
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
    lastDefinitionMs?: number;
    lastDefinitionError?: string;
    /** The engine identity the runtime last adopted, so an unchanged connection reprofiles once. */
    profileGeneration: string;
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
    private readonly _definitions: CachedObjectDefinitionProvider;
    private readonly _definitionDocuments = new Map<string, string>();
    private readonly _definitionsChanged = new vscode.EventEmitter<vscode.Uri>();
    private readonly _statsChanged = new vscode.EventEmitter<vscode.Uri>();
    private readonly _statsUris = new Map<string, vscode.Uri>();
    private _enabled = false;
    private _statsCodeLensEnabled = false;
    private _disposed = false;

    public constructor(
        context: vscode.ExtensionContext,
        private readonly _controller: MainController,
    ) {
        // Objects are scripted through the same service "Script as Create" uses, so a definition
        // reads identically wherever the extension shows one. It runs quietly here, because
        // answering a keystroke must not raise a progress notification.
        this._definitions = new CachedObjectDefinitionProvider(
            new ScriptingObjectDefinitionProvider(_controller.scriptingService, (connectionUri) =>
                this.serverInfo(connectionUri),
            ),
        );
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
        const foldingRangeProvider = new PreviewFoldingRangeProvider(
            () => this._enabled,
            (uri) => this._documents.get(uri.toString()),
        );
        const definitionProvider = new PreviewDefinitionProvider(
            () => this._enabled,
            (uri) => this._documents.get(uri.toString()),
            (descriptor, state, signal) => this.resolveDefinition(descriptor, state, signal),
        );
        const definitionDocumentProvider = new PreviewDefinitionDocumentProvider(
            (uri) => this._definitionDocuments.get(uri.toString()),
            this._definitionsChanged.event,
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
            this._definitionsChanged,
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
            vscode.languages.registerFoldingRangeProvider(
                { language: "sql" },
                foldingRangeProvider,
            ),
            vscode.languages.registerDefinitionProvider({ language: "sql" }, definitionProvider),
            vscode.workspace.registerTextDocumentContentProvider(
                definitionScheme,
                definitionDocumentProvider,
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
        this._definitions.invalidate();
        this._definitionDocuments.clear();
    }

    private openDocument(document: vscode.TextDocument): void {
        if (!this._enabled || !isSqlDocument(document) || this._disposed) return;
        const key = document.uri.toString();
        if (this._documents.has(key)) return;

        const metadata = this.createMetadataProvider(key);
        // The engine is unidentified until the connection reports one. Nothing here constructs a
        // SQL Server profile by default, so an unconnected or still-connecting document never
        // receives a platform restriction the server never asked for.
        const runtime = new InProcessLanguageServiceRuntime(
            new LezerSyntaxService(undefined, unknownEngineCapabilities),
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
            profileGeneration: runtime.capabilities.generation,
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
                    // A published metadata generation can be the first to report the engine's
                    // compatibility level, so the profile is re-resolved before rebinding.
                    this.scheduleReprofile(state);
                    if (state.refreshing) this.fireStatusChanged(state);
                }),
            ),
        );
        this._documents.set(key, state);

        this.enqueue(state, async () => {
            const snapshot = await state.runtime.open(key, state.syncedVersion, state.syncedText);
            this.publishDiagnostics(state, snapshot);
        });

        if (this._controller.connectionManager.isConnected(key)) {
            this.scheduleReprofile(state);
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
        this._definitions.invalidate(key);
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
            new ExtensionSimpleQueryExecutor(connectionUri),
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

    /**
     * Adopts the connected engine's facts and republishes the document under the resolved profile.
     *
     * The runtime reuses the retained parse, so a connection or database change costs a rebind
     * rather than a reparse. Facts that resolve to the profile already in force do nothing.
     */
    private scheduleReprofile(state: PreviewDocumentState): void {
        this.enqueue(state, async () => {
            if (state.disposed) return;
            // Facts are read when the reprofile runs rather than when it was queued, so a
            // connection that changed while the queue drained is not adopted from stale values.
            const capabilities = await state.runtime.setEngineFacts(this.engineFacts(state));
            if (capabilities.generation === state.profileGeneration) {
                // Metadata commonly publishes while refreshState still owns the refresh indicator.
                // Queue the rebind even then: scheduleRebind coalesces duplicate publications and
                // runs after this operation, while setEngineFacts already handled the changed-
                // generation case below.
                this.scheduleRebind(state);
                return;
            }
            state.profileGeneration = capabilities.generation;
            try {
                const snapshot = state.runtime.snapshot(state.connectionUri, state.syncedVersion);
                this.publishDiagnostics(state, snapshot);
            } catch {
                // The document moved on while the profile was adopted; the next edit republishes.
                return;
            }
            // Availability changes what completion offers and how names are classified, and no
            // edit accompanies it, so the editor is asked to refresh coloring.
            this._semanticTokensChanged.fire();
            this.fireStatusChanged(state);
        });
    }

    /**
     * The server facts the profile resolver reads.
     *
     * The engine edition comes from the connection, which knows it before any catalog query runs.
     * The product version and compatibility level come from the published metadata environment,
     * because that is where `SERVERPROPERTY('ProductVersion')` is actually read; the connection's
     * own version fields are only composed as a fallback, since `IServerInfo.serverVersion` is
     * display text rather than a parseable version. A missing fact is left out, never defaulted.
     */
    private engineFacts(state: PreviewDocumentState): EngineFacts | undefined {
        const info = this.serverInfo(state.connectionUri);
        const credentials = this._controller.connectionManager.getConnectionInfoFromUri(
            state.connectionUri,
        );
        const environment = state.metadata.pin().environment;
        const facts: {
            engineEdition?: number;
            serverVersion?: string;
            compatibilityLevel?: number;
            serverName?: string;
        } = {};
        if (typeof info?.engineEditionId === "number") facts.engineEdition = info.engineEditionId;
        const serverVersion =
            environment.serverVersion ??
            (typeof info?.serverMajorVersion === "number"
                ? `${info.serverMajorVersion}.${info.serverMinorVersion ?? 0}.${info.serverReleaseVersion ?? 0}`
                : undefined);
        if (serverVersion) facts.serverVersion = serverVersion;
        if (typeof environment.compatibilityLevel === "number") {
            facts.compatibilityLevel = environment.compatibilityLevel;
        }
        const serverName = credentials?.server ?? environment.serverName;
        if (serverName) facts.serverName = serverName;
        return Object.keys(facts).length === 0 ? undefined : facts;
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
                this.fireStatusChanged(state);
            }
        }
    }

    /**
     * Fetches an object definition and publishes it as a read-only document. The text is generated,
     * so it lives behind a scheme of its own rather than a temporary file that would outlive the
     * session. A definition is cached per connection, object identity, and metadata generation, so
     * a refreshed catalog or executed DDL is never answered from a stale script.
     */
    /** Server version and edition drive the scripting options; an unknown connection uses defaults. */
    private serverInfo(connectionUri: string): IServerInfo | undefined {
        try {
            const details =
                this._controller.connectionManager.getConnectionInfoFromUri(connectionUri);
            return details ? this._controller.connectionManager.getServerInfo(details) : undefined;
        } catch {
            return undefined;
        }
    }

    private async resolveDefinition(
        descriptor: ObjectDefinitionDescriptor,
        state: PreviewDocumentState,
        signal: AbortSignal,
    ): Promise<ResolvedDefinitionTarget | undefined> {
        const requestedVersion = state.syncedVersion;
        const requestedGeneration = state.metadata.pin().generation;
        const started = Date.now();
        let definition;
        try {
            definition = await this._definitions.getDefinition(
                {
                    ...descriptor,
                    connectionId: state.connectionUri,
                    metadataGeneration: requestedGeneration,
                },
                signal,
            );
        } catch (error) {
            // Cancellation is normal editor lifecycle, not a scripting failure worth surfacing in
            // diagnostics or the status view.
            if (!signal.aborted) state.lastDefinitionError = errorMessage(error);
            state.lastDefinitionMs = Date.now() - started;
            this.fireStatusChanged(state);
            throw error;
        }
        state.lastDefinitionError = undefined;
        state.lastDefinitionMs = Date.now() - started;
        this.fireStatusChanged(state);
        if (!definition || state.disposed) return undefined;
        // A result that arrived after the document moved on describes a document that no longer
        // exists, and a newer catalog may script the object differently.
        if (
            state.syncedVersion !== requestedVersion ||
            state.metadata.pin().generation !== requestedGeneration
        ) {
            return undefined;
        }
        const uri = definitionUri(state.connectionUri, descriptor, requestedGeneration);
        const key = uri.toString();
        const replaced =
            this._definitionDocuments.has(key) &&
            this._definitionDocuments.get(key) !== definition.text;
        this._definitionDocuments.delete(key);
        this._definitionDocuments.set(key, definition.text);
        // Keep only what a session is likely to revisit, so generated text cannot grow without
        // bound over a long session.
        while (this._definitionDocuments.size > maximumDefinitionDocuments) {
            const open = new Set(
                vscode.workspace.textDocuments.map((document) => document.uri.toString()),
            );
            const oldest = [...this._definitionDocuments.keys()].find(
                (candidate) => candidate !== key && !open.has(candidate),
            );
            // Never blank a definition document someone still has open. The cache may temporarily
            // exceed its soft bound until one of those editors closes.
            if (!oldest) break;
            this._definitionDocuments.delete(oldest);
        }
        // An editor holding the previous text needs to be told it changed underneath.
        if (replaced) this._definitionsChanged.fire(uri);
        const targetSelectionRange = new vscode.Range(
            positionOfOffset(definition.text, definition.definitionOffset ?? 0),
            positionOfOffset(definition.text, definition.definitionOffset ?? 0),
        );
        return {
            uri,
            targetRange: new vscode.Range(
                new vscode.Position(0, 0),
                positionOfOffset(definition.text, definition.text.length),
            ),
            targetSelectionRange,
        };
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
                        folding: "preview-syntax",
                        definitions: "preview-scripting",
                        references: "preview-not-implemented",
                        formatting: "preview-not-implemented",
                    },
                    engine: state
                        ? {
                              profile: state.runtime.capabilities.engineProfile,
                              generation: state.runtime.capabilities.generation,
                              displayName: state.runtime.capabilities.displayName,
                              source: state.runtime.capabilities.resolution.source,
                              reason: state.runtime.capabilities.resolution.reason,
                              serverMajorVersion: state.runtime.capabilities.serverMajorVersion,
                              compatibilityLevel: state.runtime.capabilities.compatibilityLevel,
                              previewFeatures: state.runtime.capabilities.previewFeatures,
                              capabilities: state.runtime.capabilities.capabilities,
                          }
                        : null,
                    lastDefinitionMs: state?.lastDefinitionMs,
                    lastDefinitionError: state?.lastDefinitionError,
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
 * Publishes the collapsible regions the language service derives from the parse tree. Registering a
 * folding provider replaces the editor indentation fallback, so this also carries the `#region`
 * markers the SQL language configuration declares.
 */
class PreviewFoldingRangeProvider implements vscode.FoldingRangeProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
    ) {}

    public async provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.FoldingRange[] | undefined> {
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
            return toVscodeFoldingRanges(
                state.features.foldingRanges(state.connectionUri, document.version, {
                    limit: foldingRangeLimit(document),
                }),
                documentLineSource(document),
            );
        } catch {
            return undefined;
        }
    }
}

/**
 * The editor stops folding once a document exceeds this many regions and drops the excess in
 * document order, which would leave the end of a long script unfoldable. Passing the limit to the
 * language service lets it spend the budget on the widest regions instead.
 */
function foldingRangeLimit(document: vscode.TextDocument): number {
    const configured = vscode.workspace
        .getConfiguration("editor", document)
        .get<number>("foldingMaximumRegions");
    return typeof configured === "number" && configured > 0 ? configured : 5000;
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

/**
 * Navigates to a name. A declaration in the same document resolves from the published snapshot; a
 * catalog object is fetched by the host, because reading a definition is I/O the language service
 * never performs.
 */
class PreviewDefinitionProvider implements vscode.DefinitionProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
        private readonly _resolve: (
            descriptor: ObjectDefinitionDescriptor,
            state: PreviewDocumentState,
            signal: AbortSignal,
        ) => Promise<ResolvedDefinitionTarget | undefined>,
    ) {}

    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.LocationLink[] | undefined> {
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

        let target;
        try {
            target = state.features.definitionTarget(
                state.connectionUri,
                document.version,
                document.offsetAt(position),
            );
        } catch {
            return undefined;
        }
        const origin =
            target.originRange &&
            new vscode.Range(
                document.positionAt(target.originRange.start),
                document.positionAt(target.originRange.end),
            );
        if (target.locations.length > 0) {
            // A link reports the name that was navigated from and selects the declared name at the
            // other end, so the editor highlights both rather than a whole line.
            return target.locations.map((location) => {
                const range = new vscode.Range(
                    document.positionAt(location.range.start),
                    document.positionAt(location.range.end),
                );
                return {
                    originSelectionRange: origin,
                    targetUri: document.uri,
                    targetRange: range,
                    targetSelectionRange: range,
                };
            });
        }
        if (!target.object) return undefined;

        const requestedVersion = document.version;
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
            const resolved = await this._resolve(target.object, state, controller.signal);
            if (
                !resolved ||
                token.isCancellationRequested ||
                state.disposed ||
                document.version !== requestedVersion ||
                state.syncedVersion !== requestedVersion
            ) {
                return undefined;
            }
            return [
                {
                    originSelectionRange: origin,
                    targetUri: resolved.uri,
                    targetRange: resolved.targetRange,
                    targetSelectionRange: resolved.targetSelectionRange,
                },
            ];
        } catch {
            // A dropped object, a denied permission, or a dead connection is not an error the
            // editor should report; navigation simply finds nothing.
            return undefined;
        } finally {
            cancellation.dispose();
            controller.abort();
        }
    }
}

class PreviewDefinitionDocumentProvider implements vscode.TextDocumentContentProvider {
    public constructor(
        private readonly _content: (uri: vscode.Uri) => string | undefined,
        public readonly onDidChange: vscode.Event<vscode.Uri>,
    ) {}

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this._content(uri) ?? "";
    }
}

/** A URI per catalog generation and object, ending in `.sql` so the editor colors what it opens. */
export function definitionUri(
    connectionUri: string,
    descriptor: ObjectDefinitionDescriptor,
    metadataGeneration?: number,
): vscode.Uri {
    const name = [descriptor.schema, descriptor.name].join(".").replaceAll(/[\\/?#]/gu, "_");
    return vscode.Uri.from({
        scheme: definitionScheme,
        path: `/${descriptor.database ?? "current"}/${descriptor.kind}/${name}.sql`,
        query: new URLSearchParams({
            connection: connectionUri,
            ...(metadataGeneration === undefined
                ? {}
                : { generation: metadataGeneration.toString() }),
        }).toString(),
    });
}

export function positionOfOffset(text: string, offset: number): vscode.Position {
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    const before = text.slice(0, safeOffset);
    const line = before.split("\n").length - 1;
    const lineStart = before.lastIndexOf("\n") + 1;
    return new vscode.Position(line, safeOffset - lineStart);
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
