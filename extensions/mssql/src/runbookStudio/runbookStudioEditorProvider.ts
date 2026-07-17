/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Studio custom text editor (A2 §5.1, Query Studio pattern):
 * CustomTextEditorProvider registration, one shared document model per URI,
 * one controller per panel, user-facing commands. Feature-gated behind
 * `mssql.runbookStudio.enabled` (preview master gate, default off).
 *
 * Activation stays lazy (A2 §4.3): registering the provider and commands
 * never launches the Hobbes runtime, enumerates models, or loads the
 * webview bundle — heavy services construct on first document resolve.
 */

import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import {
    canonicalizeRunbookArtifact,
    createFixtureRunbookArtifact,
    createNewRunbookArtifact,
} from "./runbookArtifact";
import type { RunbookRunCoordinator } from "./runbookRunCoordinator";
import { RunbookStudioController } from "./runbookStudioController";
import { RunbookStudioDocumentRegistry } from "./runbookStudioDocumentRegistry";
import type { RbsRoute } from "../sharedInterfaces/runbookStudio";

export const RUNBOOK_STUDIO_VIEW_TYPE = "mssql.runbookStudio";
export const RUNBOOK_FILE_SUFFIX = ".runbook.json";

/** Live controllers (one per panel) — deep-link + perf-probe seam. */
const liveControllers = new Set<RunbookStudioController>();
/** One-shot initial routes keyed by document uri (deep links). */
const pendingInitialRoutes = new Map<string, RbsRoute>();

export function findRunbookStudioController(
    uriKey: string | undefined,
): RunbookStudioController | undefined {
    if (uriKey === undefined) {
        return liveControllers.values().next().value;
    }
    for (const controller of liveControllers) {
        if (controller.documentUriKey === uriKey) {
            return controller;
        }
    }
    return undefined;
}

export class RunbookStudioEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly registry = new RunbookStudioDocumentRegistry();

    constructor(
        private readonly context: vscode.ExtensionContext,
        /** Lazily constructed on first resolve — never at activation. */
        private readonly coordinatorFactory: () => RunbookRunCoordinator | undefined,
    ) {}

    public get documents(): RunbookStudioDocumentRegistry {
        return this.registry;
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        Perf.marker("mssql.runbookStudio.open.begin", "begin");
        const model = this.registry.getOrCreate(document);
        model.panelCount++;
        diag.emit({
            feature: "runbookStudio",
            kind: "event",
            type: "runbookStudio.open.resolve",
            status: "ok",
            fields: {
                uriScheme: { raw: document.uri.scheme, cls: "diagnostic.metadata" },
                isUntitled: { raw: document.isUntitled, cls: "diagnostic.metadata" },
                isDirty: { raw: document.isDirty, cls: "diagnostic.metadata" },
                chars: { raw: document.getText().length, cls: "diagnostic.metadata" },
                parseOk: { raw: model.artifact !== undefined, cls: "diagnostic.metadata" },
            },
        });

        const initialRoute = pendingInitialRoutes.get(model.uriKey);
        pendingInitialRoutes.delete(model.uriKey);
        const controller = new RunbookStudioController(
            this.context,
            panel,
            model,
            this.coordinatorFactory(),
            initialRoute,
        );
        liveControllers.add(controller);
        panel.onDidDispose(() => {
            liveControllers.delete(controller);
            controller.dispose();
            model.notifyPanelClosed();
        });
    }

    disposeAll(): void {
        this.registry.disposeAll();
    }
}

export function registerRunbookStudio(
    context: vscode.ExtensionContext,
    coordinatorFactory: () => RunbookRunCoordinator | undefined = () => undefined,
): void {
    const enabled = () =>
        vscode.workspace.getConfiguration().get<boolean>("mssql.runbookStudio.enabled", false);
    if (!enabled()) {
        // Late enablement without a reload (harness scenarios flip the
        // setting after activation): register once when the gate turns on.
        const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("mssql.runbookStudio.enabled") && enabled()) {
                watcher.dispose();
                registerRunbookStudioFeatures(context, coordinatorFactory);
            }
        });
        context.subscriptions.push(watcher);
        return;
    }
    registerRunbookStudioFeatures(context, coordinatorFactory);
}

function registerRunbookStudioFeatures(
    context: vscode.ExtensionContext,
    coordinatorFactory: () => RunbookRunCoordinator | undefined,
): void {
    const provider = new RunbookStudioEditorProvider(context, coordinatorFactory);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(RUNBOOK_STUDIO_VIEW_TYPE, provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: true,
        }),
        { dispose: () => provider.disposeAll() },
        vscode.commands.registerCommand("mssql.runbookStudio.new", async () => {
            const artifact = createNewRunbookArtifact(
                LocRunbookStudio.newRunbookName,
                `runbook-${Date.now().toString(36)}`,
            );
            const doc = await vscode.workspace.openTextDocument({
                language: "json",
                content: canonicalizeRunbookArtifact(artifact),
            });
            await vscode.commands.executeCommand(
                "vscode.openWith",
                doc.uri,
                RUNBOOK_STUDIO_VIEW_TYPE,
            );
        }),
        // Deep-link target (A2 §9.2): open a run's document at a route.
        // Run-id resolution against the ledger arrives with RBS2-7; the
        // command shape is stable from day one.
        vscode.commands.registerCommand(
            "mssql.runbookStudio.openRun",
            async (args?: { documentUri?: string; runId?: string; route?: RbsRoute }) => {
                const uriKey = args?.documentUri;
                const existing = findRunbookStudioController(uriKey);
                if (existing) {
                    existing.navigate(args?.route ?? "run");
                    return { opened: true };
                }
                if (!uriKey) {
                    return { opened: false };
                }
                pendingInitialRoutes.set(uriKey, args?.route ?? "run");
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    vscode.Uri.parse(uriKey),
                    RUNBOOK_STUDIO_VIEW_TYPE,
                );
                return { opened: true };
            },
        ),
    );
    registerRunbookStudioPerfProbe(context, provider, coordinatorFactory);
}

/**
 * PERF_MODE-only probes (A2 §12.2): drive the NORMAL product path (document
 * model -> coordinator -> ledger -> adapter) and return safe semantic state.
 * Never secrets, SQL text, rows, or artifacts. Outside perf mode the
 * commands do not exist.
 */
function registerRunbookStudioPerfProbe(
    context: vscode.ExtensionContext,
    provider: RunbookStudioEditorProvider,
    coordinatorFactory: () => RunbookRunCoordinator | undefined,
): void {
    if (!Perf.enabled) {
        return;
    }
    const modelFor = (uri?: string) => {
        const controller = findRunbookStudioController(uri);
        return controller ? provider.documents.get(controller.documentUriKey) : undefined;
    };
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.perf.runbookStudio.openFixture", async () => {
            const doc = await vscode.workspace.openTextDocument({
                language: "json",
                content: canonicalizeRunbookArtifact(createFixtureRunbookArtifact()),
            });
            await vscode.commands.executeCommand(
                "vscode.openWith",
                doc.uri,
                RUNBOOK_STUDIO_VIEW_TYPE,
            );
            return { uri: doc.uri.toString() };
        }),
        vscode.commands.registerCommand(
            "mssql.perf.runbookStudio.getState",
            (args?: { uri?: string }) => {
                const controller = findRunbookStudioController(args?.uri);
                if (!controller) {
                    return { error: "no live Runbook Studio document" };
                }
                const state = controller.state;
                return {
                    uri: controller.documentUriKey,
                    documentKind: state.documentKind,
                    parseOk: state.artifact !== undefined,
                    errorCode: state.artifactError?.code,
                    parameterCount: state.artifact?.parameters.length ?? 0,
                    nodeCount: state.artifact?.nodes.length ?? 0,
                    hasLock: state.artifact?.hasLock ?? false,
                    runState: state.run?.state,
                    runId: state.run?.runId,
                    verdict: state.run?.verdict,
                    pendingGateNodeId: state.run?.pendingGate?.nodeId,
                    nodeStates: state.run?.nodes.map((n) => ({
                        nodeId: n.nodeId,
                        state: n.state,
                        outputCount: n.outputs?.length ?? 0,
                    })),
                    historyCount: state.history.length,
                };
            },
        ),
        vscode.commands.registerCommand(
            "mssql.perf.runbookStudio.startRun",
            async (args?: {
                uri?: string;
                parameterValues?: Record<string, string | number | boolean | null>;
            }) => {
                const model = modelFor(args?.uri);
                const coordinator = coordinatorFactory();
                if (!model || !coordinator) {
                    return { error: "no live Runbook Studio document" };
                }
                const result = await coordinator.startRun(model, args?.parameterValues ?? {});
                return { runId: result.runId, errorCode: result.error?.code };
            },
        ),
        vscode.commands.registerCommand(
            "mssql.perf.runbookStudio.cancelRun",
            async (args?: { uri?: string; runId?: string }) => {
                const model = modelFor(args?.uri);
                const coordinator = coordinatorFactory();
                if (!model || !coordinator || !args?.runId) {
                    return { error: "no live run" };
                }
                return coordinator.cancelRun(model, args.runId);
            },
        ),
        vscode.commands.registerCommand(
            "mssql.perf.runbookStudio.respondToGate",
            async (args?: { uri?: string; runId?: string; nodeId?: string; approve?: boolean }) => {
                const model = modelFor(args?.uri);
                const coordinator = coordinatorFactory();
                if (!model || !coordinator || !args?.runId || !args?.nodeId) {
                    return { error: "no pending gate" };
                }
                const result = await coordinator.respondToGate(
                    model,
                    args.runId,
                    args.nodeId,
                    args.approve ?? true,
                );
                return { accepted: result.accepted, errorCode: result.error?.code };
            },
        ),
        vscode.commands.registerCommand(
            "mssql.perf.runbookStudio.fetchOutput",
            async (args?: {
                uri?: string;
                handleId?: string;
                startRow?: number;
                rowCount?: number;
            }) => {
                const model = modelFor(args?.uri);
                const coordinator = coordinatorFactory();
                if (!model || !coordinator || !args?.handleId) {
                    return { error: "no output handle" };
                }
                const page = await coordinator.fetchOutputPage(model, {
                    handleId: args.handleId,
                    startRow: args.startRow ?? 0,
                    rowCount: args.rowCount ?? 100,
                });
                // Semantic counts only — never row values (A2 §12.2).
                return {
                    rows: page.rows?.length ?? 0,
                    totalRows: page.totalRows,
                    errorCode: page.error?.code,
                };
            },
        ),
    );
}
