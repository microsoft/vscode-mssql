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
import { Perf } from "../perf/perfTelemetry";
import { QueryStudioController } from "./queryStudioController";
import { QueryStudioDocumentModel } from "./queryStudioDocumentModel";
import { QueryStudioDocumentRegistry } from "./queryStudioDocumentRegistry";
import { LanguageServiceStatus } from "./queryStudioLanguageService";
import { QueryStudioReplayController } from "./replay/queryStudioReplayController";

export const QUERY_STUDIO_VIEW_TYPE = "mssql.queryStudio";

/** Live models by uri key — lookup seam for cross-feature consumers
 * (inline completions resolve a document's metadata catalog through this). */
const liveModels = new Map<string, QueryStudioDocumentModel>();

/** Live controllers (one per panel) — seam for the language status command. */
const liveControllers = new Set<QueryStudioController>();
/** Open-from-context payloads keyed by document uri, consumed at resolve. */
const pendingOpenContexts = new Map<
    string,
    { profileId: string; database?: string; autoRun?: boolean }
>();

export function findQueryStudioModel(uri: vscode.Uri): QueryStudioDocumentModel | undefined {
    return liveModels.get(uri.toString());
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
        const uriKey = document.uri.toString();

        let model = this.models.get(uriKey);
        if (!model) {
            const spillRoot = path.join(
                this.context.globalStorageUri.fsPath,
                "querystudio-spill",
                Buffer.from(uriKey).toString("base64url").slice(0, 32),
            );
            model = new QueryStudioDocumentModel(document, spillRoot, (m) => {
                this.models.delete(m.uriKey);
                liveModels.delete(m.uriKey);
            });
            this.models.set(uriKey, model);
            liveModels.set(uriKey, model);
        } else if (model.backingDocument !== document) {
            // Re-resolve (Save As / revert): rebind-safe per doc 04 §7.2.
            model.rebind(document);
        }
        model.panelCount++;

        const controller = new QueryStudioController(this.context, panel, model);
        liveControllers.add(controller);
        // Open-from-context (OE v2): a queued context connects the fresh
        // model to its profile (and optionally runs) once the panel exists.
        const pendingContext = pendingOpenContexts.get(uriKey);
        if (pendingContext) {
            pendingOpenContexts.delete(uriKey);
            void model.applyOpenContext(pendingContext);
        }
        panel.onDidDispose(() => {
            liveControllers.delete(controller);
            controller.dispose();
            const current = this.models.get(uriKey);
            if (current) {
                current.panelCount = Math.max(0, current.panelCount - 1);
                if (current.panelCount === 0) {
                    this.models.delete(uriKey);
                    liveModels.delete(uriKey);
                    current.dispose();
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
            (args?: { uri?: string; text?: string }) => {
                const model = args?.uri
                    ? liveModels.get(args.uri)
                    : liveModels.values().next().value;
                if (!model) {
                    return {
                        error: `no live Query Studio model${args?.uri ? ` for ${args.uri}` : ""}`,
                    };
                }
                const text = args?.text ?? model.backingDocument?.getText() ?? "";
                return model.executionHost.execute(text, {
                    selectionStartLine: 0,
                    scope: "document",
                });
            },
        ),
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
        { dispose: () => replayController?.dispose() },
    );
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
    return lines.join("\n");
}
