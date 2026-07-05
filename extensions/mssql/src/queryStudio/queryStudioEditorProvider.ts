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

export const QUERY_STUDIO_VIEW_TYPE = "mssql.queryStudio";

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
            });
            this.models.set(uriKey, model);
        } else if (model.backingDocument !== document) {
            // Re-resolve (Save As / revert): rebind-safe per doc 04 §7.2.
            model.rebind(document);
        }
        model.panelCount++;

        const controller = new QueryStudioController(this.context, panel, model);
        panel.onDidDispose(() => {
            controller.dispose();
            const current = this.models.get(uriKey);
            if (current) {
                current.panelCount = Math.max(0, current.panelCount - 1);
                if (current.panelCount === 0) {
                    this.models.delete(uriKey);
                    current.dispose();
                }
            }
        });
    }

    /** Deactivate sweep (doc 04 §7.3). */
    async disposeAll(): Promise<void> {
        for (const model of [...this.models.values()]) {
            model.dispose();
        }
        this.models.clear();
        void this.registry; // registry retained for future pure-logic reuse
    }
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
    );
}
