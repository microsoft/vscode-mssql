/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio custom text editor (doc 04 §6–7): CustomTextEditorProvider
 * registration, one shared document model per URI (registry), one controller
 * per panel, and the user-facing commands. Feature-gated behind
 * `mssql.queryStudio.enabled` (preview master gate).
 */

import * as path from "path";
import * as vscode from "vscode";
import {
    QueryStudio as QueryStudioLoc,
    QueryStudioCore as QueryStudioCoreLoc,
} from "../constants/locConstants";
import { PrivatePreviewContextKey } from "../previews/previewService";
import { isQueryStudioEnabled, isQueryStudioResource } from "./queryStudioFeatureGate";
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import { SqlBackendKind } from "../services/sqlDataPlane/backendFactory";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import { registerDefinitionContentProvider } from "./definitionContentProvider";
import { QueryStudioController } from "./queryStudioController";
import { QueryStudioDocumentModel } from "./queryStudioDocumentModel";
import { disposeQueryResultAccessService } from "../queryResults/queryResultAccessService";
import { pinSourceResults } from "../queryResults/pinCommands";
import {
    bindQueryResultContextKeys,
    disposeQueryResultContextService,
} from "../queryResults/queryResultContextService";
import { buildQueryResultsStatusDocument } from "../queryResults/queryResultsStatus";
import { registerPinnedResultsEditor } from "../queryResults/pinnedResultsDocumentProvider";
import {
    documentSpillDirName,
    stopSpillSessionLock,
    sweepOrphanSpillDirs,
} from "../queryResults/spillHygiene";
import { QueryStudioDocumentRegistry } from "./queryStudioDocumentRegistry";
import {
    queryStudioHotExitBackupRoot,
    restoreQueryStudioHotExitBackup,
    registerQueryStudioHotExitCleanup,
} from "./queryStudioHotExitBackup";
import { LanguageServiceStatus } from "./queryStudioLanguageService";
import {
    normalizeQueryStudioPerfActivateTabArgs,
    normalizeQueryStudioPerfInteractionArgs,
} from "./queryStudioPerfAction";

export const QUERY_STUDIO_VIEW_TYPE = "mssql.queryStudio";

/** Live models by uri key — lookup seam for cross-feature consumers
 * (inline completions resolve a document's metadata catalog through this). */
const liveModels = new Map<string, QueryStudioDocumentModel>();

/** Live controllers (one per panel) — seam for the language status command. */
const liveControllers = new Set<QueryStudioController>();
/** Open-from-context payloads keyed by document uri, consumed at resolve. */
const pendingOpenContexts = new Map<
    string,
    { profileId: string; database?: string; autoRun?: boolean; sqlcmd?: boolean }
>();
const explicitClassicOpenUntil = new Map<string, number>();
const PROBLEM_REDIRECT_SELECTION_SETTLE_MS = 25;
/**
 * Save As transplants keyed by the SAVED file's uri: when the target resolves
 * in Query Studio, the source model (connection + results + spill) is adopted
 * instead of creating a fresh one. Entries expire — see the continuity watcher.
 */
const pendingModelTransplants = new Map<string, QueryStudioDocumentModel>();
const freshDocumentUris = new Set<string>();

export function findQueryStudioModel(uri: vscode.Uri): QueryStudioDocumentModel | undefined {
    return liveModels.get(uri.toString());
}

function liveControllerFor(uri: vscode.Uri): QueryStudioController | undefined {
    const uriKey = uri.toString();
    for (const controller of liveControllers) {
        if (controller.documentUriKey === uriKey) {
            return controller;
        }
    }
    return undefined;
}

export class QueryStudioEditorProvider implements vscode.CustomTextEditorProvider {
    private registry = new QueryStudioDocumentRegistry<QueryStudioDocumentModel>((uriKey) => {
        // The factory is keyed calls only; the document arrives via resolve.
        throw new Error(`model for ${uriKey} must be created in resolveCustomTextEditor`);
    });
    private models = new Map<string, QueryStudioDocumentModel>();

    constructor(private readonly context: vscode.ExtensionContext) {
        context.subscriptions.push(
            registerQueryStudioHotExitCleanup(queryStudioHotExitBackupRoot(context.storageUri)),
        );
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        Perf.marker("mssql.queryStudio.open.begin", "begin");
        const backupRoot = queryStudioHotExitBackupRoot(this.context.storageUri);
        const restored = await restoreQueryStudioHotExitBackup(
            backupRoot,
            document,
            freshDocumentUris.delete(document.uri.toString()),
        );
        const backingDocument = restored.document;
        const uriKey = backingDocument.uri.toString();
        diag.emit({
            feature: "queryStudio",
            kind: "event",
            type: "queryStudio.open.resolve",
            status: "ok",
            fields: {
                uriScheme: { raw: backingDocument.uri.scheme, cls: "diagnostic.metadata" },
                languageId: { raw: backingDocument.languageId, cls: "diagnostic.metadata" },
                isUntitled: { raw: backingDocument.isUntitled, cls: "diagnostic.metadata" },
                isDirty: { raw: backingDocument.isDirty, cls: "diagnostic.metadata" },
                chars: { raw: backingDocument.getText().length, cls: "diagnostic.metadata" },
                backupRestore: { raw: restored.outcome, cls: "diagnostic.metadata" },
            },
        });

        let model = this.models.get(uriKey);
        let transplanted = false;
        if (!model) {
            // Save As transplant: continue the source model (connection,
            // results, spill) under the saved file's URI.
            const transplant = pendingModelTransplants.get(uriKey);
            if (transplant && this.models.get(transplant.uriKey) === transplant) {
                pendingModelTransplants.delete(uriKey);
                this.models.delete(transplant.uriKey);
                liveModels.delete(transplant.uriKey);
                transplant.adoptSavedDocument(backingDocument);
                this.models.set(uriKey, transplant);
                liveModels.set(uriKey, transplant);
                model = transplant;
                transplanted = true;
            }
        }
        if (!model) {
            const spillRoot = path.join(
                this.context.globalStorageUri.fsPath,
                "querystudio-spill",
                documentSpillDirName(uriKey),
            );
            model = new QueryStudioDocumentModel(backingDocument, spillRoot, backupRoot, (m) => {
                this.models.delete(m.uriKey);
                liveModels.delete(m.uriKey);
            });
            this.models.set(uriKey, model);
            liveModels.set(uriKey, model);
        } else if (!transplanted && model.backingDocument !== backingDocument) {
            // Re-resolve (Save As / revert): rebind-safe per doc 04 §7.2.
            model.rebind(backingDocument);
        }
        model.panelCount++;

        const controller = new QueryStudioController(this.context, panel, model, (saveAs) =>
            this.saveDocument(model, saveAs),
        );
        liveControllers.add(controller);
        // Open-from-context (OE v2): a queued context connects the fresh
        // model to its profile (and optionally runs) once the panel exists.
        // A transplanted model already carries its live session — never
        // reconnect over it.
        const pendingContext = pendingOpenContexts.get(uriKey);
        if (pendingContext) {
            pendingOpenContexts.delete(uriKey);
            if (!transplanted) {
                void model.applyOpenContext(pendingContext);
            }
        }
        const boundModel = model;
        panel.onDidDispose(() => {
            liveControllers.delete(controller);
            controller.dispose();
            // Identity check via the model's CURRENT key: a Save As
            // transplant re-keys the model, and the orphaned source panel
            // must still decrement the right instance.
            if (this.models.get(boundModel.uriKey) === boundModel) {
                boundModel.panelCount = Math.max(0, boundModel.panelCount - 1);
                if (boundModel.panelCount === 0) {
                    this.models.delete(boundModel.uriKey);
                    liveModels.delete(boundModel.uriKey);
                    boundModel.dispose();
                }
            }
        });
    }

    /** Save through VS Code and adopt only the exact URI returned by Save As. */
    private async saveDocument(model: QueryStudioDocumentModel, saveAs: boolean): Promise<void> {
        const source = model.backingDocument.uri;
        // Save As can close the old custom-editor panel before returning its
        // target. Keep the connection/results alive until the replacement opens.
        model.panelCount++;
        try {
            const target = await (saveAs || model.backingDocument.isUntitled
                ? vscode.workspace.saveAs(source)
                : vscode.workspace.save(source));
            if (
                !target ||
                target.toString() === source.toString() ||
                !isQueryStudioResource(target)
            ) {
                return;
            }
            const targetKey = target.toString();
            const replacementTabs = vscode.window.tabGroups.all
                .flatMap((group) => group.tabs)
                .filter(
                    (tab) =>
                        tab.input instanceof vscode.TabInputCustom &&
                        tab.input.viewType === QUERY_STUDIO_VIEW_TYPE &&
                        tab.input.uri.toString() === targetKey,
                );
            // VS Code may have resolved a fresh target editor during Save As.
            // Reopen it with the existing model instead of silently losing results.
            if (replacementTabs.length) {
                if (!(await vscode.window.tabGroups.close(replacementTabs, true))) return;
            }
            pendingModelTransplants.set(targetKey, model);
            try {
                await adoptSaveAsTarget(target, targetKey, source.toString());
            } finally {
                pendingModelTransplants.delete(targetKey);
            }
        } finally {
            model.panelCount = Math.max(0, model.panelCount - 1);
            if (model.panelCount === 0) {
                this.models.delete(model.uriKey);
                liveModels.delete(model.uriKey);
                model.dispose();
            }
        }
    }

    /** Deactivate sweep (doc 04 §7.3). */
    async disposeAll(): Promise<void> {
        for (const model of [...this.models.values()]) {
            liveModels.delete(model.uriKey);
            model.dispose();
        }
        this.models.clear();
        void this.registry; // registry retained for future pure-logic reuse
    }
}

/**
 * PERF_MODE-only self-test probe (design 04 §17.4): live Query Studio model
 * state — row counts, execution phase, spill stats, metadata generation,
 * sync resync count. Outside perf mode the command does not exist.
 */
function registerQueryStudioPerfProbe(context: vscode.ExtensionContext): void {
    if (!Perf.enabled) {
        return;
    }
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.perf.queryStudioConnect", async (uri?: string) => {
            const model = uri ? liveModels.get(uri) : liveModels.values().next().value;
            if (!model) {
                return {
                    error: QueryStudioCoreLoc.noLiveQueryStudioModelValue(
                        String(uri ? ` for ${uri}` : ""),
                    ),
                };
            }
            const connected = await model.sessionBinding.connect();
            return { connected };
        }),
        vscode.commands.registerCommand(
            "mssql.perf.queryStudioExecute",
            async (args?: { uri?: string; text?: string }) => {
                const model = args?.uri
                    ? liveModels.get(args.uri)
                    : liveModels.values().next().value;
                if (!model) {
                    return {
                        error: QueryStudioCoreLoc.noLiveQueryStudioModelValue(
                            String(args?.uri ? ` for ${args.uri}` : ""),
                        ),
                    };
                }
                const text = args?.text ?? model.backingDocument?.getText() ?? "";
                await model.sessionBinding.waitForUserSessionReady();
                return model.executionHost.execute(text, {
                    selectionStartLine: 1,
                    scope: "document",
                });
            },
        ),
        vscode.commands.registerCommand("mssql.perf.queryStudioCancel", async (uri?: string) => {
            const model = uri ? liveModels.get(uri) : liveModels.values().next().value;
            if (!model) {
                return {
                    error: QueryStudioCoreLoc.noLiveQueryStudioModelValue(
                        String(uri ? ` for ${uri}` : ""),
                    ),
                };
            }
            return model.executionHost.cancel();
        }),
        vscode.commands.registerCommand("mssql.perf.queryStudioActivateTab", (args?: unknown) => {
            // VEC-12 seam: drives the lazy result panes (vector today) so
            // perftest scenarios can measure activation → firstPaint.
            const normalized = normalizeQueryStudioPerfActivateTabArgs(args);
            if ("error" in normalized) {
                return { error: normalized.error };
            }
            const { uri, activation } = normalized.value;
            const model = uri ? liveModels.get(uri) : liveModels.values().next().value;
            if (!model) {
                return {
                    error: QueryStudioCoreLoc.noLiveQueryStudioModelValue(
                        String(uri ? ` for ${uri}` : ""),
                    ),
                };
            }
            const request = model.requestActivateTab(activation);
            return {
                requested: activation.tab,
                requestId: request.requestId,
            };
        }),
        vscode.commands.registerCommand("mssql.perf.queryStudioInteract", (args?: unknown) => {
            const normalized = normalizeQueryStudioPerfInteractionArgs(args);
            if ("error" in normalized) {
                return { error: normalized.error };
            }
            const { uri, action } = normalized.value;
            const model = uri ? liveModels.get(uri) : liveModels.values().next().value;
            if (!model) {
                return {
                    error: QueryStudioCoreLoc.noLiveQueryStudioModelValue(
                        String(uri ? ` for ${uri}` : ""),
                    ),
                };
            }
            const request = model.requestPerfInteraction(action);
            return { requested: action.kind, requestId: request.requestId };
        }),
        vscode.commands.registerCommand("mssql.perf.queryStudioState", (uri?: string) => {
            const model = uri ? liveModels.get(uri) : liveModels.values().next().value;
            if (!model) {
                return {
                    error: QueryStudioCoreLoc.noLiveQueryStudioModelValue(
                        String(uri ? ` for ${uri}` : ""),
                    ),
                };
            }
            const results = model.executionHost.resultsState();
            const metadata = model.sessionBinding.metadataStatus;
            return {
                uri: model.uriKey,
                phase: model.executionHost.executionState.kind,
                resultSets: results.resultSets.map((summary) => ({
                    id: summary.id,
                    rowCount: summary.rowCount,
                })),
                totalRows: results.totalRows,
                messageCount: results.messageCount,
                errorCount: results.errorCount,
                spill: model.executionHost.spillStats ?? null,
                metadata: metadata
                    ? {
                          readiness: metadata.readiness,
                          generation: metadata.generation,
                          mode: metadata.mode,
                      }
                    : null,
                syncResyncCount: model.syncResyncCount,
            };
        }),
    );
}

/**
 * QueryResults service + spill-hygiene lifecycle (C2D-1): deactivation
 * disposes every snapshot (final lease releases delete spill), the session
 * lock heartbeat stops, and a delayed startup sweep reclaims run dirs
 * orphaned by crashed sessions — off the activation path.
 */
function registerQueryResultsLifecycle(context: vscode.ExtensionContext): void {
    registerPinnedResultsEditor(context);
    // Menu enablement rides context keys (booleans/enums only, C2D-4).
    bindQueryResultContextKeys((key, value) => {
        void vscode.commands.executeCommand("setContext", key, value);
    });
    const spillParent = path.join(context.globalStorageUri.fsPath, "querystudio-spill");
    const sweepTimer = setTimeout(() => sweepOrphanSpillDirs(spillParent), 15_000);
    sweepTimer.unref?.();
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.queryResults.showStatus", async () => {
            const doc = await vscode.workspace.openTextDocument({
                language: "json",
                content: buildQueryResultsStatusDocument(),
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        }),
        // Palette pin (C2D-7, deferred from C2D-2): pin a Query Studio
        // document's complete results by uri, defaulting to the only/first
        // open one — the same path the webview pin buttons use.
        vscode.commands.registerCommand(
            "mssql.queryStudio.pinAllResults",
            async (args?: { uri?: string }) => {
                const model = args?.uri
                    ? liveModels.get(args.uri)
                    : liveModels.values().next().value;
                if (!model) {
                    void vscode.window.showInformationMessage(
                        QueryStudioCoreLoc.noQueryStudioDocumentIsOpen,
                    );
                    return { opened: false, error: QueryStudioCoreLoc.noQueryStudioDocumentIsOpen };
                }
                const outcome = await pinSourceResults(model.liveResultSource.sourceId);
                if (!outcome.opened && outcome.error) {
                    void vscode.window.showWarningMessage(outcome.error);
                }
                return outcome;
            },
        ),
        {
            dispose: () => {
                clearTimeout(sweepTimer);
                disposeQueryResultAccessService();
                disposeQueryResultContextService();
                stopSpillSessionLock();
            },
        },
    );
}

export function registerQueryStudio(context: vscode.ExtensionContext): void {
    const activeAtActivation = isQueryStudioEnabled();
    void vscode.commands.executeCommand(
        "setContext",
        PrivatePreviewContextKey.QueryStudioActive,
        activeAtActivation,
    );
    const provider = activeAtActivation ? new QueryStudioEditorProvider(context) : undefined;
    // The static .mssql association also applies with preview flags off. In
    // that case, use the ordinary SQL editor without creating QS services.
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            QUERY_STUDIO_VIEW_TYPE,
            {
                async resolveCustomTextEditor(document, panel, token) {
                    if (
                        !provider ||
                        !isQueryStudioEnabled() ||
                        !isQueryStudioResource(document.uri)
                    ) {
                        await vscode.commands.executeCommand(
                            "vscode.openWith",
                            document.uri,
                            "default",
                            { viewColumn: panel.viewColumn },
                        );
                        panel.dispose();
                        return;
                    }
                    await provider.resolveCustomTextEditor(document, panel, token);
                },
            },
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: true,
            },
        ),
    );
    if (provider) {
        context.subscriptions.push({ dispose: () => void provider.disposeAll() });
        registerQueryStudioFeatures(context);
    }
}

function registerQueryStudioFeatures(context: vscode.ExtensionContext): void {
    registerQueryStudioPerfProbe(context);
    registerQueryStudioActiveTextEditorRedirect(context);

    registerQueryResultsLifecycle(context);
    // mssql-def: virtual documents for scripted go-to-definition (LS-4);
    // registered once with the QS surface, shared by every controller.
    registerDefinitionContentProvider(context);
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.queryStudio.new", async () => {
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "",
            });
            freshDocumentUris.add(doc.uri.toString());
            await vscode.commands.executeCommand(
                "vscode.openWith",
                doc.uri,
                QUERY_STUDIO_VIEW_TYPE,
            );
        }),
        vscode.commands.registerCommand(
            "mssql.queryStudio.newQueryFromContext",
            async (args?: {
                profileId?: string;
                database?: string;
                initialSql?: string;
                autoRun?: boolean;
                /** Open with SQLCMD mode on (perftest sqlcmd scenario seam). */
                sqlcmd?: boolean;
                source?: string;
            }) => {
                const doc = await vscode.workspace.openTextDocument({
                    language: "sql",
                    content: args?.initialSql ?? "",
                });
                freshDocumentUris.add(doc.uri.toString());
                if (args?.profileId) {
                    pendingOpenContexts.set(doc.uri.toString(), {
                        profileId: args.profileId,
                        ...(args.database ? { database: args.database } : {}),
                        ...(args.autoRun ? { autoRun: true } : {}),
                        ...(args.sqlcmd ? { sqlcmd: true } : {}),
                    });
                }
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    doc.uri,
                    QUERY_STUDIO_VIEW_TYPE,
                );
            },
        ),
        vscode.commands.registerCommand("mssql.queryStudio.openActive", async () => {
            const uri = vscode.window.activeTextEditor?.document.uri;
            if (!uri || !isQueryStudioResource(uri)) {
                void vscode.window.showInformationMessage(QueryStudioLoc.openMssqlDocument);
                return;
            }
            await vscode.commands.executeCommand("vscode.openWith", uri, QUERY_STUDIO_VIEW_TYPE);
        }),
        vscode.commands.registerCommand(
            "mssql.queryStudio.openInClassicEditor",
            async (uri?: vscode.Uri) => {
                const target = uri ?? vscode.window.activeTextEditor?.document.uri;
                if (target) {
                    const uriKey = target.toString();
                    explicitClassicOpenUntil.set(uriKey, Date.now() + 2000);
                    setTimeout(() => explicitClassicOpenUntil.delete(uriKey), 2000);
                    await vscode.commands.executeCommand("vscode.openWith", target, "default");
                }
            },
        ),
        vscode.commands.registerCommand(
            "mssql.queryStudio.duplicateAsNewQuery",
            async (uri?: vscode.Uri) => {
                const source = uri
                    ? await vscode.workspace.openTextDocument(uri)
                    : vscode.window.activeTextEditor?.document;
                const doc = await vscode.workspace.openTextDocument({
                    language: "sql",
                    content: source?.getText() ?? "",
                });
                freshDocumentUris.add(doc.uri.toString());
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    doc.uri,
                    QUERY_STUDIO_VIEW_TYPE,
                );
            },
        ),
        vscode.commands.registerCommand("mssql.queryStudio.languageServiceStatus", () => {
            const controller: QueryStudioController | undefined = liveControllers
                .values()
                .next().value;
            if (!controller) {
                void vscode.window.showInformationMessage(
                    QueryStudioCoreLoc.noQueryStudioDocumentIsOpenOpenOne,
                );
                return;
            }
            languageStatusChannel ??= vscode.window.createOutputChannel(
                "Query Studio Language Service",
            );
            languageStatusChannel.clear();
            languageStatusChannel.append(
                renderLanguageServiceStatus(controller.languageServiceStatus),
            );
            languageStatusChannel.show(true);
        }),
        // Per-document provider picker (TSQ2-9/§3.5): binds the NEXT connect
        // of this document; the live session keeps the provider it opened
        // with — status shows the truth (activeBackendKind).
        vscode.commands.registerCommand(
            "mssql.sqlDataPlane.pickDocumentBackend",
            async (args?: { uri?: string }) => {
                const model = args?.uri
                    ? liveModels.get(args.uri)
                    : liveModels.values().next().value;
                if (!model) {
                    void vscode.window.showInformationMessage(
                        QueryStudioCoreLoc.noQueryStudioDocumentIsOpenOpenOne2,
                    );
                    return;
                }
                const registry = SqlDataPlaneService.get();
                const binding = model.sessionBinding;
                const current = binding.documentBackendOverride ?? registry.defaultBackendKind();
                type BackendPick = vscode.QuickPickItem & {
                    backendKind: SqlBackendKind | undefined;
                };
                const picks: BackendPick[] = registry
                    .entrySnapshots()
                    .filter((entry) => entry.realmClass !== "test")
                    .map((entry) => ({
                        label: (entry.kind === current ? "$(check) " : "") + entry.displayName,
                        description:
                            entry.kind +
                            (binding.activeBackendKind === entry.kind ? " · current session" : ""),
                        backendKind: entry.kind,
                    }));
                picks.push({
                    label: QueryStudioCoreLoc.useWorkspaceDefault,
                    description: QueryStudioCoreLoc.clearThePerDocumentOverrideValue(
                        String(registry.defaultBackendKind()),
                    ),
                    backendKind: undefined,
                });
                const picked = await vscode.window.showQuickPick(picks, {
                    title: QueryStudioCoreLoc.queryStudioSQLProviderForThisDocumentNext,
                });
                if (!picked) {
                    return;
                }
                binding.setDocumentBackendOverride(picked.backendKind);
                const effective = picked.backendKind ?? registry.defaultBackendKind();
                if (binding.activeBackendKind && binding.activeBackendKind !== effective) {
                    void vscode.window.showInformationMessage(
                        QueryStudioCoreLoc.providerChangeAfterReconnect(
                            String(registry.displayNameFor(effective)),
                            String(binding.activeBackendKind),
                        ),
                    );
                }
            },
        ),
    );
}

/** Ensure the Save As target is open in Query Studio and the orphaned source tab is gone. */
async function adoptSaveAsTarget(
    target: vscode.Uri,
    targetKey: string,
    sourceUriKey: string,
): Promise<void> {
    try {
        const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
        const targetQsTab = tabs.find(
            (tab) =>
                tab.input instanceof vscode.TabInputCustom &&
                tab.input.viewType === QUERY_STUDIO_VIEW_TYPE &&
                tab.input.uri.toString() === targetKey,
        );
        // Orphaned source tab: still keyed by the PRE-save uri (the model has
        // been re-keyed by the transplant, or will be — either way this tab's
        // editor no longer owns a document).
        const orphanTabs = tabs.filter(
            (tab) =>
                tab.input instanceof vscode.TabInputCustom &&
                tab.input.viewType === QUERY_STUDIO_VIEW_TYPE &&
                tab.input.uri.toString() === sourceUriKey,
        );
        if (!targetQsTab) {
            // Covers both the orphan case (no editor opened for the target at
            // all) and the demote case (target opened in the plain text
            // editor — openWith replaces it).
            await vscode.commands.executeCommand("vscode.openWith", target, QUERY_STUDIO_VIEW_TYPE);
        }
        if (orphanTabs.length > 0) {
            await vscode.window.tabGroups.close(orphanTabs, true);
        }
        diag.emit({
            feature: "queryStudio",
            kind: "event",
            type: "queryStudio.saveAs.adopted",
            status: "ok",
            fields: {
                extension: {
                    raw: path.extname(target.fsPath).toLowerCase(),
                    cls: "diagnostic.metadata",
                },
                reopened: { raw: !targetQsTab, cls: "diagnostic.metadata" },
                orphansClosed: { raw: orphanTabs.length, cls: "diagnostic.metadata" },
                transplantPending: {
                    raw: pendingModelTransplants.has(targetKey),
                    cls: "diagnostic.metadata",
                },
            },
        });
    } catch {
        // Best-effort: worst case the user reopens via "Reopen With".
    }
}

function registerQueryStudioActiveTextEditorRedirect(context: vscode.ExtensionContext): void {
    let redirecting = false;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    const subscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (redirecting || editor === undefined || editor.document.languageId !== "sql") {
            return;
        }
        const controller = liveControllerFor(editor.document.uri);
        if (controller === undefined) {
            return;
        }
        const uriKey = editor.document.uri.toString();
        if ((explicitClassicOpenUntil.get(uriKey) ?? 0) > Date.now()) {
            return;
        }
        redirecting = true;
        if (redirectTimer !== undefined) {
            clearTimeout(redirectTimer);
        }
        redirectTimer = setTimeout(() => {
            redirectTimer = undefined;
            void redirectClassicSqlEditorToQueryStudio(editor, controller, uriKey).finally(() => {
                queueMicrotask(() => {
                    redirecting = false;
                });
            });
        }, PROBLEM_REDIRECT_SELECTION_SETTLE_MS);
    });
    context.subscriptions.push(subscription, {
        dispose: () => {
            if (redirectTimer !== undefined) {
                clearTimeout(redirectTimer);
                redirectTimer = undefined;
                redirecting = false;
            }
        },
    });
}

async function redirectClassicSqlEditorToQueryStudio(
    openedEditor: vscode.TextEditor,
    controller: QueryStudioController,
    uriKey: string,
): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    const activeMatches =
        activeEditor !== undefined &&
        activeEditor.document.uri.toString() === uriKey &&
        activeEditor.document.languageId === "sql";
    const sourceEditor = activeMatches ? activeEditor : openedEditor;
    const position = sourceEditor.selection.active;
    if (activeMatches) {
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
    controller.revealEditorPosition(position.line + 1, position.character + 1);
}

/** Created once on first use; survives across Query Studio panels. */
let languageStatusChannel: vscode.OutputChannel | undefined;

function renderLanguageServiceStatus(status: LanguageServiceStatus): string {
    const lines: string[] = [];
    lines.push("Query Studio Language Service");
    lines.push("");
    lines.push(`Engine preference:     ${status.preference}`);
    lines.push(`Metadata generation:   ${status.metadataGeneration}`);
    lines.push(`Shadow STS connection: ${status.shadowConnectionState}`);
    lines.push("");
    lines.push("Features:");
    lines.push(`  ${"feature".padEnd(18)}${"maturity".padEnd(18)}${"engine".padEnd(24)}circuit`);
    for (const entry of status.router) {
        lines.push(
            `  ${entry.feature.padEnd(18)}${entry.maturity.padEnd(18)}${entry.effectiveEngine.padEnd(24)}${
                entry.circuitBroken ? "broken" : "closed"
            }`,
        );
    }
    lines.push("");
    lines.push("Metadata readiness:");
    lines.push(`  objects:     ${status.readiness.objects}`);
    lines.push(`  columns:     ${status.readiness.columns}`);
    lines.push(`  parameters:  ${status.readiness.parameters}`);
    lines.push(`  foreignKeys: ${status.readiness.foreignKeys}`);
    lines.push(`  definitions: ${status.readiness.definitions}`);
    lines.push(`  mode:        ${status.readiness.mode}`);
    lines.push("");
    lines.push("Diagnostics (native engine):");
    lines.push(`  enabled:           ${status.diagnostics.enabled}`);
    lines.push(`  scheduler:         ${status.diagnostics.scheduler}`);
    lines.push(`  last pass version: ${status.diagnostics.lastPassVersion ?? "(none)"}`);
    const reasons = Object.entries(status.diagnostics.suppressionCounts).sort(([a], [b]) =>
        a.localeCompare(b),
    );
    if (reasons.length === 0) {
        lines.push("  suppressions:      (none)");
    } else {
        lines.push("  suppressions by reason:");
        for (const [reason, count] of reasons) {
            lines.push(`    ${reason.padEnd(28)}${count}`);
        }
    }
    lines.push("");
    return lines.join("\n");
}
