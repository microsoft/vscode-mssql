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
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import { SqlBackendKind } from "../services/sqlDataPlane/backendFactory";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import { registerDefinitionContentProvider } from "./definitionContentProvider";
import { QueryStudioController } from "./queryStudioController";
import { QueryStudioDocumentModel } from "./queryStudioDocumentModel";
import {
    disposeQueryResultAccessService,
    getQueryResultAccessService,
} from "../queryResults/queryResultAccessService";
import { pinSourceResults } from "../queryResults/pinCommands";
import {
    bindQueryResultContextKeys,
    disposeQueryResultContextService,
} from "../queryResults/queryResultContextService";
import { buildQueryResultsStatusDocument } from "../queryResults/queryResultsStatus";
import { registerPinnedResultsEditor } from "../queryResults/pinnedResultsDocumentProvider";
import { stopSpillSessionLock, sweepOrphanSpillDirs } from "../queryResults/spillHygiene";
import { QueryStudioDocumentRegistry } from "./queryStudioDocumentRegistry";
import {
    queryStudioHotExitBackupRoot,
    restoreQueryStudioHotExitBackup,
} from "./queryStudioHotExitBackup";
import { LanguageServiceStatus } from "./queryStudioLanguageService";
import { QueryStudioReplayController } from "./replay/queryStudioReplayController";
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

    constructor(private readonly context: vscode.ExtensionContext) {}

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        Perf.marker("mssql.queryStudio.open.begin", "begin");
        const backupRoot = queryStudioHotExitBackupRoot(this.context.globalStorageUri);
        const restored = await restoreQueryStudioHotExitBackup(backupRoot, document);
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
                Buffer.from(uriKey).toString("base64url").slice(0, 32),
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

        const controller = new QueryStudioController(this.context, panel, model);
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
                return { error: `no live Query Studio model${uri ? ` for ${uri}` : ""}` };
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
                        error: `no live Query Studio model${args?.uri ? ` for ${args.uri}` : ""}`,
                    };
                }
                const text = args?.text ?? model.backingDocument?.getText() ?? "";
                await model.sessionBinding.waitForUserSessionReady();
                return model.executionHost.execute(text, {
                    selectionStartLine: 0,
                    scope: "document",
                });
            },
        ),
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
                    error: `no live Query Studio model${uri ? ` for ${uri}` : ""}`,
                };
            }
            const request = model.requestActivateTab(activation);
            return {
                requested: activation.tab,
                requestId: request.requestId,
                ...(activation.vector ? { vectorWorkspace: activation.vector.workspace } : {}),
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
                    error: `no live Query Studio model${uri ? ` for ${uri}` : ""}`,
                };
            }
            const request = model.requestPerfInteraction(action);
            return { requested: action.kind, requestId: request.requestId };
        }),
        vscode.commands.registerCommand("mssql.perf.queryStudioState", (uri?: string) => {
            const model = uri ? liveModels.get(uri) : liveModels.values().next().value;
            if (!model) {
                return { error: `no live Query Studio model${uri ? ` for ${uri}` : ""}` };
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
                    void vscode.window.showInformationMessage("No Query Studio document is open.");
                    return { opened: false, error: "No Query Studio document is open." };
                }
                const outcome = await pinSourceResults(model.liveResultSource.sourceId);
                if (!outcome.opened && outcome.error) {
                    void vscode.window.showWarningMessage(outcome.error);
                }
                return outcome;
            },
        ),
        // Harness probe (C2D-8, hidden): run one representative groupBy
        // transform against the NEWEST snapshot so perftest scenarios can
        // measure engine throughput via the registered markers.
        vscode.commands.registerCommand("mssql.queryResults.benchmarkTransform", async () => {
            const service = getQueryResultAccessService();
            const newest = [...service.listSnapshots()].sort(
                (a, b) => b.createdEpochMs - a.createdEpochMs,
            )[0];
            if (!newest) {
                return { evaluated: false, error: "No snapshots exist." };
            }
            const description = service.describeSnapshot(newest.snapshotId);
            const target = description?.resultSets.reduce(
                (best, set) => (set.rowCount > (best?.rowCount ?? -1) ? set : best),
                description.resultSets[0],
            );
            if (!description || !target) {
                return { evaluated: false, error: "Snapshot has no result sets." };
            }
            const result = await service.evaluateSnapshotTransform({
                v: 1,
                source: { snapshotId: newest.snapshotId, resultSetId: target.resultSetId },
                terminal: { kind: "groupBy", keys: [0], aggs: [{ fn: "count" }] },
            });
            return {
                evaluated: true,
                rowsScanned: result.stats.rowsScanned,
                groups: result.rows.length,
                elapsedMs: result.stats.elapsedMs,
                partial: result.stats.partial,
            };
        }),
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
    const enabled = () =>
        vscode.workspace.getConfiguration().get<boolean>("mssql.queryStudio.enabled", false);
    if (!enabled()) {
        // Late enablement without a reload (also unblocks harness scenarios
        // that flip the setting after activation): register once when the
        // preview gate turns on.
        const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("mssql.queryStudio.enabled") && enabled()) {
                watcher.dispose();
                registerQueryStudioFeatures(context);
            }
        });
        context.subscriptions.push(watcher);
        return;
    }
    registerQueryStudioFeatures(context);
}

function registerQueryStudioFeatures(context: vscode.ExtensionContext): void {
    registerQueryStudioPerfProbe(context);
    registerQueryStudioActiveTextEditorRedirect(context);
    registerQueryStudioSaveAsContinuity(context);
    registerQueryResultsLifecycle(context);
    void ensureMssqlFileAssociation();
    // mssql-def: virtual documents for scripted go-to-definition (LS-4);
    // registered once with the QS surface, shared by every controller.
    registerDefinitionContentProvider(context);
    const provider = new QueryStudioEditorProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(QUERY_STUDIO_VIEW_TYPE, provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: true,
        }),
        { dispose: () => void provider.disposeAll() },
        vscode.commands.registerCommand("mssql.queryStudio.new", async () => {
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "",
            });
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
            if (!uri) {
                void vscode.window.showInformationMessage(
                    "Open a .sql document first, then reopen it in Query Studio.",
                );
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
                    "No Query Studio document is open — open one to inspect its language service.",
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
        vscode.commands.registerCommand("mssql.queryStudio.openReplayLab", () => {
            if (replayController && !replayController.isDisposed) {
                replayController.revealToForeground();
                return;
            }
            replayController = new QueryStudioReplayController(context, () => [
                ...liveModels.values(),
            ]);
            replayController.onDisposed(() => {
                replayController = undefined;
            });
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
                        "No Query Studio document is open — open one to pick its SQL provider.",
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
                    label: "Use workspace default",
                    description: `clear the per-document override (${registry.defaultBackendKind()})`,
                    backendKind: undefined,
                });
                const picked = await vscode.window.showQuickPick(picks, {
                    title: "Query Studio: SQL provider for this document (next connect)",
                });
                if (!picked) {
                    return;
                }
                binding.setDocumentBackendOverride(picked.backendKind);
                const effective = picked.backendKind ?? registry.defaultBackendKind();
                if (binding.activeBackendKind && binding.activeBackendKind !== effective) {
                    void vscode.window.showInformationMessage(
                        `This document will use ${registry.displayNameFor(effective)} on its next connect. ` +
                            `The current session stays on ${binding.activeBackendKind} until you reconnect.`,
                    );
                }
            },
        ),
        { dispose: () => replayController?.dispose() },
    );
}

/**
 * `.mssql` is the Query-Studio-first extension (contributed to the sql
 * language + the QS custom-editor selector). The customEditors contribution
 * stays priority "option" so ordinary .sql files are not hijacked — this
 * makes QS the DEFAULT editor for `*.mssql` the same way VS Code's own
 * "Configure default editor" does: a workbench.editorAssociations entry.
 * Written once, globally, only when the user has no association yet.
 */
async function ensureMssqlFileAssociation(): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration();
        const associations =
            config.get<Record<string, string>>("workbench.editorAssociations") ?? {};
        if (associations["*.mssql"] !== undefined) {
            return; // user already decided — never overwrite
        }
        await config.update(
            "workbench.editorAssociations",
            { ...associations, "*.mssql": QUERY_STUDIO_VIEW_TYPE },
            vscode.ConfigurationTarget.Global,
        );
    } catch {
        // Best-effort: without the association, "Reopen With" still works.
    }
}

/** EOL/final-newline save transforms must not break Save As source matching. */
function normalizeForSaveAsMatch(text: string): string {
    return text.replace(/\r\n/g, "\n").trimEnd();
}

/**
 * Save As continuity (doc 04 §7.2 gap): VS Code does not reliably replace a
 * custom-editor tab on Save As — an untitled Query Studio tab is left
 * ORPHANED (backing document gone, results webview still showing) while the
 * content lands in the target file, and a titled Save As reopens the target
 * as a fresh document that would lose the session. Tab events never fire for
 * the orphan, so the watcher keys off the DOCUMENT save instead: a saved
 * .sql/.mssql file that is not an open Query Studio document but textually
 * matches a live model is that model's Save As target. The model itself
 * (connection, results, spill) is transplanted to the new URI, the target is
 * ensured open in Query Studio, and the orphaned source tab is closed.
 */
function registerQueryStudioSaveAsContinuity(context: vscode.ExtensionContext): void {
    // A resolve normally lands well under a second after the save; expired
    // entries mean the user saved a copy without reopening it — never adopt
    // an unrelated later open.
    const TRANSPLANT_WINDOW_MS = 5000;
    // Small grace so VS Code's own editor replacement (when it works) runs
    // first and the ensure step only fills the gaps.
    const ENSURE_DELAY_MS = 200;
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((saved) => {
            if (saved.uri.scheme !== "file" || !/\.(sql|mssql)$/i.test(saved.uri.fsPath)) {
                return;
            }
            const savedKey = saved.uri.toString();
            if (liveModels.has(savedKey)) {
                return; // ordinary Save of an already-open Query Studio doc
            }
            const savedText = normalizeForSaveAsMatch(saved.getText());
            let source: QueryStudioDocumentModel | undefined;
            for (const model of liveModels.values()) {
                try {
                    if (
                        model.panelCount > 0 &&
                        model.backingDocument.uri.toString() !== savedKey &&
                        normalizeForSaveAsMatch(model.backingDocument.getText()) === savedText
                    ) {
                        source = model;
                        break;
                    }
                } catch {
                    // A closed backing document that cannot be read cannot match.
                }
            }
            if (!source) {
                return;
            }
            const sourceModel = source;
            const sourceUriKey = sourceModel.uriKey;
            pendingModelTransplants.set(savedKey, sourceModel);
            setTimeout(() => {
                if (pendingModelTransplants.get(savedKey) === sourceModel) {
                    pendingModelTransplants.delete(savedKey);
                }
            }, TRANSPLANT_WINDOW_MS);
            // Fallback if the transplant window is missed: at least the
            // connection context survives into the fresh model.
            const profileId = sourceModel.sessionBinding.currentProfileId;
            const database = sourceModel.sessionBinding.connectionState.database;
            if (profileId) {
                pendingOpenContexts.set(savedKey, {
                    profileId,
                    ...(database ? { database } : {}),
                });
            }
            setTimeout(() => {
                void adoptSaveAsTarget(saved.uri, savedKey, sourceUriKey);
            }, ENSURE_DELAY_MS);
        }),
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
                setTimeout(() => {
                    redirecting = false;
                }, 0);
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

let replayController: QueryStudioReplayController | undefined;

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
