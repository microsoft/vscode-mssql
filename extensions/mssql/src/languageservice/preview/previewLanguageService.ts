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
    type DocumentAnalysisSnapshot,
    type EngineFacts,
    type LanguageServiceRuntime,
    type MetadataProvider,
    type ObjectDefinitionDescriptor,
    type TextChange,
    CatalogObserver,
    resolveMetadataRuntimeOptions,
    SourceMappedColorizationService,
    SourceMappedFeatureService,
    type ColorizationService,
    type LanguageFeatureService,
    type MetadataRuntimeOptions,
} from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";
import { basename } from "path";
import { LanguageServiceStatsWebviewController } from "../../controllers/languageServiceStatsWebviewController";
import type { IServerInfo } from "vscode-mssql";
import { PreviewLanguageService as PreviewLoc } from "../../constants/locConstants";
import type MainController from "../../controllers/mainController";
import {
    ExtensionSimpleQueryExecutor,
    VscodeMssqlSimpleQueryMetadataLoader,
} from "./simpleQueryMetadata";
import {
    PreviewMetadataSessionPool,
    previewMetadataSessionKey,
    type PreviewMetadataSessionLease,
} from "./previewMetadataSessionPool";
import {
    previewLanguageServiceSetting,
    previewLanguageServiceStatsCodeLensSetting,
} from "./productionLanguageServiceIsolation";
import { ScriptingObjectDefinitionProvider } from "./previewScriptedDefinitions";
import { previewSemanticTokensLegend } from "./previewSemanticTokens";
import SqlToolsServiceClient from "../serviceclient";
import {
    definitionScheme,
    diagnosticSource,
    refreshMetadataCommand,
    showStatsCommand,
    statsScheme,
} from "./previewLanguageServiceConstants";
import type {
    PreviewDocumentState,
    PreviewOperationFailure,
    PreviewOperationStage,
    ResolvedDefinitionTarget,
} from "./previewLanguageServiceState";
import {
    PreviewCompletionProvider,
    PreviewDefinitionDocumentProvider,
    PreviewDefinitionProvider,
    PreviewFoldingRangeProvider,
    PreviewHoverProvider,
    PreviewSemanticTokensProvider,
    PreviewSignatureHelpProvider,
    definitionUri,
    positionOfOffset,
    toVscodeDiagnostic,
} from "./previewVscodeFeatureProviders";
import {
    PreviewStatsDocumentProvider,
    PreviewStatusCodeLensProvider,
    isPreviewStatsCodeLensEnabled,
} from "./previewLanguageServiceStatus";
import { PreviewMetadataRefreshCoordinator } from "./previewMetadataRefreshCoordinator";

export {
    completionHydrationTimeoutMs,
    definitionUri,
    positionOfOffset,
} from "./previewVscodeFeatureProviders";
export { isPreviewStatsCodeLensEnabled, statusTitle } from "./previewLanguageServiceStatus";
export { metadataSectionsInvalidatedByExecutedSql } from "./previewMetadataRefreshCoordinator";

/** The host-neutral analysis pair used by every preview VS Code provider for one document. */
export interface PreviewAnalysisServices {
    readonly runtime: LanguageServiceRuntime;
    readonly features: LanguageFeatureService;
}

/**
 * Creates the exact source-mapped services used by the preview extension route.
 *
 * Keeping this composition in one exported seam makes the extension route independently
 * testable and prevents a future provider from accidentally bypassing SQLCMD source mapping.
 */
export function createPreviewAnalysisServices(metadata: MetadataProvider): PreviewAnalysisServices {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(undefined, unknownEngineCapabilities),
        new CatalogSemanticBinder(),
        metadata,
    );
    return {
        runtime,
        features: new SourceMappedFeatureService(
            new TsqlLanguageFeatureService(runtime, metadata),
            runtime,
        ),
    };
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
    private readonly _coloring: ColorizationService = new SourceMappedColorizationService(
        new TsqlColorizationService(),
    );
    private readonly _definitions: CachedObjectDefinitionProvider;
    private readonly _metadataOptions: MetadataRuntimeOptions;
    private readonly _metadataSessions: PreviewMetadataSessionPool;
    private readonly _metadataRefresh: PreviewMetadataRefreshCoordinator;
    private readonly _definitionDocuments = new Map<string, string>();
    private readonly _definitionsChanged = new vscode.EventEmitter<vscode.Uri>();
    private readonly _statsChanged = new vscode.EventEmitter<vscode.Uri>();
    private readonly _statsUris = new Map<string, vscode.Uri>();
    private _enabled = false;
    private _statsCodeLensEnabled = false;
    private _disposed = false;

    private readonly _statsPanels = new Map<string, LanguageServiceStatsWebviewController>();
    private readonly _documentChanged = new vscode.EventEmitter<string>();

    public constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _controller: MainController,
        metadataOptions: Partial<MetadataRuntimeOptions> = {},
    ) {
        const context = _context;
        this._metadataOptions = resolveMetadataRuntimeOptions(metadataOptions);
        this._metadataSessions = new PreviewMetadataSessionPool(
            (executor) =>
                new SimpleQueryMetadataAdapter(
                    executor,
                    new VscodeMssqlSimpleQueryMetadataLoader(this._metadataOptions),
                    new CatalogObserver(),
                ),
            (connectionUri, query, signal) =>
                new ExtensionSimpleQueryExecutor(connectionUri).execute(query, signal),
            this._metadataOptions.catalogSessionCacheSize,
        );
        this._metadataRefresh = new PreviewMetadataRefreshCoordinator({
            isEnabled: () => this._enabled,
            resolveSqlDocument: (uri) => this.resolveSqlDocument(uri),
            stateForUri: (uri) => this._documents.get(uri),
            statusChanged: (state) => this.fireStatusChanged(state),
        });
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
            this._metadataOptions,
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
            this._documentChanged,
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
                this._metadataRefresh.refreshMetadata(uri, true),
            ),
            vscode.workspace.onDidOpenTextDocument((document) => this.openDocument(document)),
            vscode.workspace.onDidChangeTextDocument((event) => this.changeDocument(event)),
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
                this._metadataRefresh.handleQueryExecutionCatalogChanged(event),
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
        this._metadataSessions.clear();
        this._diagnostics.clear();
        this._statsUris.clear();
        this._definitions.invalidate();
        this._definitionDocuments.clear();
    }

    private openDocument(document: vscode.TextDocument): void {
        if (!this._enabled || !isSqlDocument(document) || this._disposed) return;
        const key = document.uri.toString();
        if (this._documents.has(key)) return;

        const metadataBinding = this.createMetadataBinding(key);
        const metadata = metadataBinding.provider;
        // The engine is unidentified until the connection reports one. Nothing here constructs a
        // SQL Server profile by default, so an unconnected or still-connecting document never
        // receives a platform restriction the server never asked for.
        const { runtime, features } = createPreviewAnalysisServices(metadata);
        const state: PreviewDocumentState = {
            documentUri: document.uri,
            connectionUri: key,
            metadata,
            metadataSessionKey: metadataBinding.key,
            metadataLease: metadataBinding.lease,
            runtime,
            features,
            disposables: [],
            queue: Promise.resolve(),
            syncedVersion: document.version,
            syncedText: document.getText(),
            incrementalFallbackCount: 0,
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

        this.enqueue(state, "full-open", async () => {
            const snapshot = await state.runtime.open(key, state.syncedVersion, state.syncedText);
            this.publishDiagnostics(state, snapshot);
        });

        if (this._controller.connectionManager.isConnected(key)) {
            this.scheduleReprofile(state);
            void this._metadataRefresh.refreshState(state, false);
        }
        this.fireStatusChanged(state);
    }

    private changeDocument(event: vscode.TextDocumentChangeEvent): void {
        const document = event.document;
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
        const contentChanges = [...event.contentChanges];
        this.enqueue(state, "incremental-change", async () => {
            if (version <= state.syncedVersion && text === state.syncedText) return;
            const changes = toSequentialTextChanges(state.syncedText, text, contentChanges);
            const update = await changeRuntimeWithFallback(
                state.runtime,
                key,
                state.syncedVersion,
                version,
                changes,
                text,
            );
            if (update.failure) {
                state.incrementalFallbackCount++;
                state.lastOperationFailure = update.failure;
            }
            state.syncedVersion = version;
            state.syncedText = text;
            this.publishDiagnostics(state, update.snapshot);
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
        state.metadataLease?.dispose();
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
            const connected = this._controller.connectionManager.isConnected(key);
            const expectedProvider = connected ? "simple-query" : "null";
            const expectedSessionKey = connected ? this.metadataSessionKey(key) : undefined;
            if (
                !state ||
                state.metadata.id !== expectedProvider ||
                state.metadataSessionKey !== expectedSessionKey
            ) {
                this.disposeState(key);
                this.openDocument(document);
            }
        }
    }

    private createMetadataBinding(connectionUri: string): {
        readonly provider: MetadataProvider;
        readonly key?: string;
        readonly lease?: PreviewMetadataSessionLease;
    } {
        if (!this._controller.connectionManager.isConnected(connectionUri)) {
            return { provider: new NullMetadataProvider() };
        }
        const key = this.metadataSessionKey(connectionUri);
        const lease = this._metadataSessions.acquire(key, connectionUri);
        return { provider: lease.provider, key, lease };
    }

    private metadataSessionKey(connectionUri: string): string {
        const credentials =
            this._controller.connectionManager.getConnectionInfoFromUri(connectionUri);
        if (!credentials) return `document:${connectionUri}`;
        const info = this.serverInfo(connectionUri);
        const engineProfile = [
            info?.engineEditionId ?? "unknown",
            info?.serverMajorVersion ?? "unknown",
            info?.serverMinorVersion ?? "unknown",
        ].join(":");
        return previewMetadataSessionKey({
            server: credentials.server,
            port: credentials.port,
            database: credentials.database,
            user: credentials.user,
            authenticationType: credentials.authenticationType,
            accountId: credentials.accountId,
            tenantId: credentials.tenantId,
            engineProfile,
        });
    }

    private enqueue(
        state: PreviewDocumentState,
        stage: PreviewOperationStage,
        operation: () => Promise<void>,
    ): void {
        state.queue = state.queue
            .then(async () => {
                if (!state.disposed && this._documents.get(state.connectionUri) === state) {
                    await operation();
                }
            })
            .catch((error: unknown) => {
                if (!state.disposed) {
                    state.lastOperationFailure = {
                        stage,
                        message: errorMessage(error),
                        fallbackAttempted: false,
                    };
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
        this.enqueue(state, "reprofile", async () => {
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
        this.enqueue(state, "rebind", async () => {
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
        while (this._definitionDocuments.size > this._metadataOptions.definitionCacheSize) {
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
        const existing = this._statsPanels.get(source);
        if (existing) {
            existing.revealToForeground();
            return;
        }
        const panel = new LanguageServiceStatsWebviewController(
            this._context,
            source,
            basename(document.uri.fsPath),
            {
                stats: (documentUri) =>
                    this._documents.get(documentUri)?.runtime.getStats(documentUri),
                databaseName: (documentUri) =>
                    this._documents.get(documentUri)?.metadata.pin().environment.currentDatabase,
                enabled: this._enabled,
                onDidChange: (listener) => this._documentChanged.event(listener),
            },
        );
        this._statsPanels.set(source, panel);
        panel.onDisposed(() => this._statsPanels.delete(source));
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
                    incrementalFallbackCount: state?.incrementalFallbackCount ?? 0,
                    lastOperationFailure: state?.lastOperationFailure,
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
        this._documentChanged.fire(state.connectionUri);
    }
}

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

/** Applies an exact incremental update and records when correctness required a cold-open fallback. */
export async function changeRuntimeWithFallback(
    runtime: Pick<LanguageServiceRuntime, "change" | "open">,
    uri: string,
    fromVersion: number,
    toVersion: number,
    changes: readonly TextChange[],
    text: string,
): Promise<{
    readonly snapshot: DocumentAnalysisSnapshot;
    readonly failure?: PreviewOperationFailure;
}> {
    try {
        return { snapshot: await runtime.change(uri, fromVersion, toVersion, changes) };
    } catch (incrementalError) {
        try {
            return {
                snapshot: await runtime.open(uri, toVersion, text),
                failure: {
                    stage: "incremental-change",
                    message: errorMessage(incrementalError),
                    fallbackAttempted: true,
                    fallbackSucceeded: true,
                },
            };
        } catch (fullOpenError) {
            throw new Error(
                `Incremental change failed (${errorMessage(incrementalError)}); ` +
                    `full-open fallback failed (${errorMessage(fullOpenError)}).`,
                { cause: fullOpenError },
            );
        }
    }
}

/** Converts VS Code edit deltas to verified sequential UTF-16 changes. */
export function toSequentialTextChanges(
    previous: string,
    next: string,
    contentChanges: readonly Pick<
        vscode.TextDocumentContentChangeEvent,
        "rangeOffset" | "rangeLength" | "text"
    >[],
): readonly TextChange[] {
    const direct = contentChanges.map(toTextChange);
    if (applySequentialChanges(previous, direct) === next) return direct;

    const descending = [...direct].sort((left, right) => right.start - left.start);
    if (applySequentialChanges(previous, descending) === next) return descending;

    const fallback = computeSingleTextChange(previous, next);
    return fallback ? [fallback] : [];
}

function toTextChange(
    change: Pick<vscode.TextDocumentContentChangeEvent, "rangeOffset" | "rangeLength" | "text">,
): TextChange {
    return {
        start: change.rangeOffset,
        end: change.rangeOffset + change.rangeLength,
        text: change.text,
    };
}

function applySequentialChanges(
    previous: string,
    changes: readonly TextChange[],
): string | undefined {
    let text = previous;
    for (const change of changes) {
        if (change.start < 0 || change.end < change.start || change.end > text.length) {
            return undefined;
        }
        text = text.slice(0, change.start) + change.text + text.slice(change.end);
    }
    return text;
}

export function isSqlDocument(document: vscode.TextDocument): boolean {
    return (
        document.languageId === "sql" &&
        document.uri.scheme !== statsScheme &&
        document.uri.scheme !== definitionScheme
    );
}

function asVscodeDisposable(disposable: { dispose(): void }): vscode.Disposable {
    return disposable;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
