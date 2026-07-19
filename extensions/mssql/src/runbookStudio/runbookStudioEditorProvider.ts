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

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import { canonicalizeRunbookArtifact, createFixtureRunbookArtifact } from "./runbookArtifact";
import { RUNBOOK_FS_SCHEME, RunbookFileSystemProvider } from "./runbookFileSystem";
import { registerRunbookLibrary } from "./runbookLibraryProvider";
import type { RunbookRunCoordinator } from "./runbookRunCoordinator";
import { RunbookStudioController } from "./runbookStudioController";
import { RunbookStudioDocumentRegistry } from "./runbookStudioDocumentRegistry";
import { RunbookRunStatusBar } from "./runbookRunStatusBar";
import { RunbookStudioService } from "./runbookStudioService";
import type { RbsRoute, RunbookArtifactFile } from "../sharedInterfaces/runbookStudio";

export const RUNBOOK_STUDIO_VIEW_TYPE = "mssql.runbookStudio";
export const RUNBOOK_FILE_SUFFIX = ".runbook.json";

/** Live controllers (one per panel) — deep-link + perf-probe seam. */
const liveControllers = new Set<RunbookStudioController>();
/** Singleton run status-bar pill (created with the feature registration). */
let runStatusBar: RunbookRunStatusBar | undefined;
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
        runStatusBar?.track(model);
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
    const serviceAccessor = (): RunbookStudioService | undefined => {
        const coordinator = coordinatorFactory();
        return coordinator instanceof RunbookStudioService ? coordinator : undefined;
    };
    // Virtual runbook documents (D-0014 step c): the mssql-runbook: FS
    // provider MUST register BEFORE the custom editor. On hot-exit restore
    // VS Code rehydrates the text model (readFile on the virtual URI)
    // while resolving the restored tab, so the scheme has to be servable
    // the moment the editor can resolve. It must also register even in
    // sessions where no Runbook Studio panel ever opens — a restored
    // window may carry mssql-runbook: tabs (or their backups) from a
    // previous session, and readFile arrives before any panel exists.
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(
            RUNBOOK_FS_SCHEME,
            new RunbookFileSystemProvider(context.globalStorageUri, {
                getBaseline: async (assetId) => {
                    const service = serviceAccessor();
                    if (!service) {
                        throw new Error(LocRunbookStudio.runtimeUnavailable);
                    }
                    return service.getLibraryDocumentBaseline(assetId);
                },
                commit: async (assetId, artifactJson, expected, resolution) => {
                    const service = serviceAccessor();
                    if (!service) {
                        throw new Error(LocRunbookStudio.runtimeUnavailable);
                    }
                    return service.commitLibraryDocument(
                        assetId,
                        artifactJson,
                        expected,
                        resolution,
                    );
                },
            }),
            { isCaseSensitive: true },
        ),
    );
    const provider = new RunbookStudioEditorProvider(context, coordinatorFactory);
    runStatusBar = new RunbookRunStatusBar();
    context.subscriptions.push(
        runStatusBar,
        vscode.window.registerCustomEditorProvider(RUNBOOK_STUDIO_VIEW_TYPE, provider, {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: true,
        }),
        { dispose: () => provider.disposeAll() },
        // The command-palette entry and the Library toolbar must use the
        // SAME library-first creation path (D-0014). The old palette path
        // created an untitled loose document, so the new runbook was absent
        // from the Library until an explicit publish and could be stranded
        // by hot exit. The library command creates the runtime draft and
        // stash first, then opens its mssql-runbook: virtual document.
        vscode.commands.registerCommand("mssql.runbookStudio.new", () =>
            vscode.commands.executeCommand("mssql.runbookLibrary.newRunbook"),
        ),
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
        // Debug Console "Runbooks" page action (also palette-visible while
        // the gate is on): open the newest Hobbes runtime session log from
        // the runtime's isolated data directory. The path mirrors
        // RunbookStudioService.storageRoot -> RuntimeSupervisor.dataDir.
        vscode.commands.registerCommand("mssql.runbookStudio.openRuntimeLog", async () => {
            const logsDir = path.join(
                (context.storageUri ?? context.globalStorageUri).fsPath,
                "runbookStudio",
                "hobbes-data",
                "logs",
            );
            let newest: { file: string; mtimeMs: number } | undefined;
            try {
                for (const entry of await fs.promises.readdir(logsDir)) {
                    if (!entry.startsWith("runtime-session-") || !entry.endsWith(".log")) {
                        continue;
                    }
                    const filePath = path.join(logsDir, entry);
                    const stat = await fs.promises.stat(filePath);
                    if (!newest || stat.mtimeMs > newest.mtimeMs) {
                        newest = { file: filePath, mtimeMs: stat.mtimeMs };
                    }
                }
            } catch {
                // no logs directory yet — same honest outcome as zero matches
            }
            diag.emit({
                feature: "runbookStudio",
                kind: "event",
                type: "runbookStudio.runtimeLog.open",
                status: newest ? "ok" : "info",
                fields: {
                    found: { raw: newest !== undefined, cls: "diagnostic.metadata" },
                },
            });
            if (!newest) {
                void vscode.window.showInformationMessage(
                    "No Hobbes runtime log found yet — start a runbook run with the Hobbes runtime to create one.",
                );
                return;
            }
            await vscode.window.showTextDocument(vscode.Uri.file(newest.file), {
                preview: true,
            });
        }),
        // Model configuration (global, runtime-side): planner + workflow
        // model ids on the ACTIVE provider profile via the runtime's own
        // settings round-trip. Free-text ids — the runtime does not expose
        // a model catalog to enumerate.
        vscode.commands.registerCommand("mssql.runbookStudio.configureModels", async () => {
            const coordinator = coordinatorFactory();
            const service = coordinator instanceof RunbookStudioService ? coordinator : undefined;
            if (!service) {
                void vscode.window.showErrorMessage(LocRunbookStudio.modelConfigUnavailable);
                return;
            }
            const config = await service.getModelConfiguration();
            if ("error" in config) {
                void vscode.window.showErrorMessage(config.error.message);
                return;
            }
            const pick = await vscode.window.showQuickPick(
                [
                    {
                        label: LocRunbookStudio.modelRolePlanner,
                        description: config.plannerModelId ?? "",
                        role: "planner" as const,
                    },
                    {
                        label: LocRunbookStudio.modelRoleWorkflow,
                        description: config.workflowModelId ?? "",
                        role: "workflow" as const,
                    },
                ],
                { title: config.providerLabel },
            );
            if (!pick) {
                return;
            }
            const modelId = await vscode.window.showInputBox({
                prompt: LocRunbookStudio.modelIdPrompt(pick.label, config.providerLabel),
                value:
                    pick.role === "planner"
                        ? (config.plannerModelId ?? "")
                        : (config.workflowModelId ?? ""),
            });
            if (!modelId) {
                return;
            }
            const refusal = await service.setModelConfiguration(pick.role, modelId.trim());
            if (refusal) {
                void vscode.window.showErrorMessage(refusal);
            } else {
                void vscode.window.showInformationMessage(
                    LocRunbookStudio.modelConfigSaved(pick.label, modelId.trim()),
                );
            }
        }),
    );
    // Runbook Library tree (R3): the runtime library next to Object
    // Explorer, sharing the lazily constructed service. The coordinator
    // factory yields the concrete service in production; narrow honestly
    // rather than assuming (perf/test hosts may inject bare coordinators).
    registerRunbookLibrary(
        context,
        serviceAccessor,
        () => activeRunbookArtifact(provider),
        () => {
            const controller = activeRunbookController();
            return controller ? vscode.Uri.parse(controller.documentUriKey) : undefined;
        },
    );
    registerRunbookStudioPerfProbe(context, provider, coordinatorFactory);
}

/** Artifact of the focused Runbook Studio panel (falls back to the only
 *  live panel when none is focused — command palette steals focus). */
function activeRunbookArtifact(
    provider: RunbookStudioEditorProvider,
): RunbookArtifactFile | undefined {
    const chosen = activeRunbookController();
    return chosen ? provider.documents.get(chosen.documentUriKey)?.artifact : undefined;
}

/** Focused Runbook Studio panel (falls back to the only live panel when a
 *  command surface temporarily owns focus). */
function activeRunbookController(): RunbookStudioController | undefined {
    let chosen: RunbookStudioController | undefined;
    for (const controller of liveControllers) {
        if (controller.isPanelActive) {
            chosen = controller;
            break;
        }
        chosen ??= controller;
    }
    return chosen;
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
