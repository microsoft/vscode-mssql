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
import {
    RUNBOOK_FS_SCHEME,
    RunbookFileSystemProvider,
    runbookVirtualUri,
} from "./runbookFileSystem";
import { readStash, writeStash } from "./libraryStash";
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
        // Model configuration (global, runtime-side): each role is resolved
        // through its assigned provider profile and live model catalog.
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
                        description: config.authoring.modelId,
                        role: "authoring" as const,
                    },
                    {
                        label: LocRunbookStudio.modelRoleWorkflow,
                        description: config.execution.modelId,
                        role: "execution" as const,
                    },
                ],
                { title: LocRunbookStudio.configureModelsTitle },
            );
            if (!pick) {
                return;
            }
            const roleConfig = config[pick.role];
            const model = await vscode.window.showQuickPick(
                roleConfig.models.map((option) => ({
                    label: option.name,
                    description: option.vendor,
                    detail: option.id,
                    modelId: option.id,
                    picked: option.id === roleConfig.modelId,
                })),
                { title: `${pick.label} — ${roleConfig.providerLabel}` },
            );
            if (!model) {
                return;
            }
            const refusal = await service.setModelConfiguration(pick.role, model.modelId);
            if (refusal) {
                void vscode.window.showErrorMessage(refusal);
            } else {
                void vscode.window.showInformationMessage(
                    LocRunbookStudio.modelConfigSaved(pick.label, model.modelId),
                );
            }
        }),
        vscode.commands.registerCommand("mssql.runbookStudio.checkRuntimeProvider", async () => {
            const service = serviceAccessor();
            if (!service) {
                void vscode.window.showErrorMessage(LocRunbookStudio.runtimeUnavailable);
                return;
            }
            const checked = await service.getRuntimeProviderStatus();
            if (!checked.status) {
                void vscode.window.showErrorMessage(
                    checked.error?.message ?? LocRunbookStudio.runtimeProviderStatusFailed,
                );
                return;
            }
            const status = checked.status;
            if (status.provider.ready) {
                void vscode.window.showInformationMessage(
                    LocRunbookStudio.runtimeProviderReady(status.provider.label),
                );
                return;
            }
            const detail = LocRunbookStudio.runtimeProviderUnavailable(
                status.provider.label,
                status.provider.reason ?? LocRunbookStudio.runtimeProviderNoReason,
            );
            if (!status.loginRequired || !status.provider.supportsLogin) {
                void vscode.window.showWarningMessage(detail);
                return;
            }
            const choice = await vscode.window.showWarningMessage(
                detail,
                LocRunbookStudio.runtimeProviderSignIn,
            );
            if (choice !== LocRunbookStudio.runtimeProviderSignIn) {
                return;
            }
            const outcome = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: LocRunbookStudio.runtimeProviderSigningIn(status.provider.label),
                    cancellable: true,
                },
                async (progress, token) =>
                    service.signInRuntimeProvider((event) => {
                        if (event.kind === "pending" || event.kind === "progress") {
                            progress.report({
                                message: LocRunbookStudio.runtimeProviderWaiting,
                            });
                        }
                        if (
                            event.kind === "deviceCode" &&
                            event.userCode &&
                            event.verificationUri
                        ) {
                            let signInUri: vscode.Uri | undefined;
                            try {
                                const parsed = vscode.Uri.parse(event.verificationUri, true);
                                if (parsed.scheme === "https") {
                                    signInUri = parsed;
                                }
                            } catch {
                                // Invalid provider URI: show the code but
                                // do not expose an untrusted open action.
                            }
                            const message = LocRunbookStudio.runtimeProviderDeviceCode(
                                event.userCode,
                            );
                            if (signInUri) {
                                void vscode.window
                                    .showInformationMessage(
                                        message,
                                        LocRunbookStudio.runtimeProviderOpenSignIn,
                                    )
                                    .then((openChoice) => {
                                        if (
                                            openChoice ===
                                            LocRunbookStudio.runtimeProviderOpenSignIn
                                        ) {
                                            void vscode.env.openExternal(signInUri);
                                        }
                                    });
                            } else {
                                void vscode.window.showInformationMessage(message);
                            }
                        }
                    }, token),
            );
            if (outcome === "cancelled") {
                void vscode.window.showInformationMessage(
                    LocRunbookStudio.runtimeProviderSignInCancelled,
                );
                return;
            }
            const rechecked =
                outcome === "succeeded" ? await service.getRuntimeProviderStatus() : undefined;
            if (rechecked?.status?.provider.ready) {
                void vscode.window.showInformationMessage(
                    LocRunbookStudio.runtimeProviderSignInSucceeded,
                );
            } else {
                void vscode.window.showErrorMessage(LocRunbookStudio.runtimeProviderSignInFailed);
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
    registerRunbookStudioAutomationCommands(context, provider, coordinatorFactory);
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
 * Structured, non-UI command seam for extension-host automation and future
 * Copilot Chat tools. It drives the same document model and coordinator as
 * the webview. Plan generation and execution remain separate commands so a
 * chat agent can present the compiled plan before requesting authority to
 * run it. Gates never auto-approve unless the caller explicitly supplies
 * `approveGates: true` (intended for controlled integration tests).
 */
function registerRunbookStudioAutomationCommands(
    context: vscode.ExtensionContext,
    provider: RunbookStudioEditorProvider,
    coordinatorFactory: () => RunbookRunCoordinator | undefined,
): void {
    const modelFor = (uri?: string) => {
        const controller = findRunbookStudioController(uri);
        return controller ? provider.documents.get(controller.documentUriKey) : undefined;
    };
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql.runbookStudio.compileIntentHeadless",
            async (args?: { uri?: string; intent?: string }) => {
                const model = modelFor(args?.uri);
                const coordinator = coordinatorFactory();
                const intent = args?.intent?.trim();
                if (!model || !coordinator || !intent) {
                    return {
                        ok: false,
                        errorCode: "RunbookStudio.AutomationInputInvalid",
                    };
                }
                const result = await coordinator.compileIntent(model, intent);
                const artifact = model.artifact;
                return {
                    ok: result.ok,
                    ...(result.error ? { errorCode: result.error.code } : {}),
                    ...(artifact?.lock
                        ? {
                              runbookId: artifact.id,
                              planRevision: artifact.lock.planRevision,
                              planHash: artifact.lock.planHash,
                              nodeCount: artifact.lock.nodes.length,
                              activityKinds: artifact.lock.nodes.flatMap((node) =>
                                  node.activityKind ? [node.activityKind] : [],
                              ),
                              parameterIds: artifact.source.parameters.map(
                                  (parameter) => parameter.id,
                              ),
                          }
                        : {}),
                };
            },
        ),
        vscode.commands.registerCommand(
            "mssql.runbookStudio.startRunHeadless",
            async (args?: {
                uri?: string;
                parameterValues?: Record<string, string | number | boolean | null>;
                approveGates?: boolean;
                timeoutMs?: number;
            }) => {
                const model = modelFor(args?.uri);
                const coordinator = coordinatorFactory();
                if (!model || !coordinator) {
                    return {
                        state: "refused",
                        errorCode: "RunbookStudio.AutomationInputInvalid",
                    };
                }
                const started = await coordinator.startRun(model, args?.parameterValues ?? {});
                if (!started.runId || started.error) {
                    return {
                        state: "refused",
                        ...(started.error ? { errorCode: started.error.code } : {}),
                    };
                }
                return waitForHeadlessRun(
                    model,
                    coordinator,
                    started.runId,
                    args?.approveGates === true,
                    boundedAutomationTimeout(args?.timeoutMs),
                );
            },
        ),
    );
}

function boundedAutomationTimeout(value: number | undefined): number {
    return Number.isFinite(value)
        ? Math.max(1_000, Math.min(30 * 60_000, Math.trunc(value!)))
        : 10 * 60_000;
}

function waitForHeadlessRun(
    model: Parameters<RunbookRunCoordinator["startRun"]>[0],
    coordinator: RunbookRunCoordinator,
    runId: string,
    approveGates: boolean,
    timeoutMs: number,
): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
        let settled = false;
        const approving = new Set<string>();
        let subscription: vscode.Disposable | undefined;
        const finish = (result: Record<string, unknown>) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            subscription?.dispose();
            resolve(result);
        };
        const inspect = () => {
            const run = model.activeRun;
            if (!run || run.runId !== runId) {
                return;
            }
            if (run.state === "succeeded" || run.state === "failed" || run.state === "cancelled") {
                finish({
                    state: run.state,
                    runId,
                    ...(run.verdict ? { verdict: run.verdict } : {}),
                    ...(run.error ? { errorCode: run.error.code } : {}),
                    nodeStates: run.nodes.map((node) => ({
                        nodeId: node.nodeId,
                        state: node.state,
                        outputCount: node.outputs?.length ?? 0,
                        ...(node.outcome ? { outcome: node.outcome } : {}),
                        ...(node.message ? { message: node.message } : {}),
                    })),
                });
                return;
            }
            const gate = run.pendingGate;
            if (!gate) {
                return;
            }
            if (!approveGates) {
                finish({ state: "waitingForApproval", runId, pendingGateNodeId: gate.nodeId });
                return;
            }
            if (approving.has(gate.nodeId)) {
                return;
            }
            approving.add(gate.nodeId);
            void coordinator.respondToGate(model, runId, gate.nodeId, true).then((response) => {
                approving.delete(gate.nodeId);
                if (!response.accepted) {
                    finish({
                        state: "refused",
                        runId,
                        errorCode: response.error?.code ?? "RunbookStudio.AutomationGateRefused",
                    });
                }
            });
        };
        const timer = setTimeout(() => {
            finish({
                state: "timedOut",
                runId,
                errorCode: "RunbookStudio.AutomationTimeout",
            });
        }, timeoutMs);
        subscription = model.onDidChange(inspect);
        inspect();
    });
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
    const waitForTerminal = (
        model: NonNullable<ReturnType<typeof modelFor>>,
        timeoutMs = 60_000,
    ): Promise<void> => {
        const terminalOutcome = (): "succeeded" | Error | undefined => {
            const run = model.activeRun;
            if (!run) {
                return undefined;
            }
            if (run.state === "succeeded") {
                return "succeeded";
            }
            if (run.state === "failed" || run.state === "cancelled") {
                return new Error(`fixture run reached ${run.state}`);
            }
            return undefined;
        };
        const current = terminalOutcome();
        if (current === "succeeded") {
            return Promise.resolve();
        }
        if (current) {
            return Promise.reject(current);
        }
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                subscription.dispose();
                reject(new Error("timed out waiting for the fixture run to finish"));
            }, timeoutMs);
            const subscription = model.onDidChange(() => {
                const result = terminalOutcome();
                if (!result) {
                    return;
                }
                clearTimeout(timer);
                subscription.dispose();
                if (result === "succeeded") {
                    resolve();
                } else {
                    reject(result);
                }
            });
        });
    };
    const assertRecoveredFixture = (
        model: NonNullable<ReturnType<typeof modelFor>>,
    ): { historyCount: number; outputCount: number } => {
        const run = model.activeRun;
        if (!run || model.history.length === 0) {
            throw new Error("the durable fixture run was not rehydrated");
        }
        if (run.state !== "succeeded" || run.verdict !== "pass") {
            throw new Error(
                `the recovered fixture run is ${run.state}/${run.verdict ?? "no-verdict"}`,
            );
        }
        if (run.nodes.some((node) => node.state !== "succeeded")) {
            throw new Error("the recovered fixture contains a non-succeeded node");
        }
        const outputCount = run.nodes.reduce(
            (total, node) => total + (node.outputs?.length ?? 0),
            0,
        );
        if (outputCount === 0) {
            throw new Error("the recovered fixture lost its durable node output handles");
        }
        return { historyCount: model.history.length, outputCount };
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
            "mssql.perf.runbookStudio.restartRecoveryFixture",
            async () => {
                const repId = Number.parseInt(process.env.PERF_REP_ID ?? "0", 10);
                if (!Number.isSafeInteger(repId) || repId < 0) {
                    throw new Error("PERF_REP_ID must be a non-negative integer");
                }
                const artifact = createFixtureRunbookArtifact();
                const existed =
                    (await readStash(context.globalStorageUri, artifact.id)) !== undefined;
                if (repId > 0 && !existed) {
                    throw new Error(
                        "the warmed profile did not retain the fixture stash from the prior host",
                    );
                }
                if (!existed) {
                    await writeStash(
                        context.globalStorageUri,
                        artifact.id,
                        canonicalizeRunbookArtifact(artifact),
                    );
                }

                const uri = runbookVirtualUri(artifact.id);
                const open = () =>
                    vscode.commands.executeCommand(
                        "vscode.openWith",
                        uri,
                        RUNBOOK_STUDIO_VIEW_TYPE,
                    );
                await open();
                let model = modelFor(uri.toString());
                const coordinator = coordinatorFactory();
                if (!model || !coordinator) {
                    throw new Error("the persistent fixture did not open in Runbook Studio");
                }

                if (model.history.length === 0) {
                    if (repId > 0) {
                        throw new Error(
                            "the new extension host did not rehydrate the prior fixture run",
                        );
                    }
                    const started = await coordinator.startRun(model, {
                        target: "fixture-connection",
                        maxCount: 100,
                    });
                    if (!started.runId || started.error) {
                        throw new Error(
                            `the warmup fixture run was refused: ${started.error?.code ?? "unknown"}`,
                        );
                    }
                    await waitForTerminal(model);
                    assertRecoveredFixture(model);

                    // Seed host: close the only panel and reopen the virtual
                    // URI so this repetition also proves the document-level
                    // rehydrate path. Later reps additionally require that
                    // the state survived a whole extension-host process.
                    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                    await open();
                    model = modelFor(uri.toString());
                    if (!model) {
                        throw new Error("the fixture did not reopen after its warmup run");
                    }
                } else if (repId > 0) {
                    // A warmed VS Code profile can hot-exit restore this tab
                    // before scenario.start. Assert that restored state first
                    // (the cross-process proof), then reopen once so the
                    // measured window contains a fresh recovery marker rather
                    // than waiting on the legitimate pre-window one.
                    assertRecoveredFixture(model);
                    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                    await open();
                    model = modelFor(uri.toString());
                    if (!model) {
                        throw new Error("the recovered fixture did not reopen for measurement");
                    }
                }

                return {
                    uri: uri.toString(),
                    repId,
                    recoveredFromPriorHost: repId > 0,
                    ...assertRecoveredFixture(model),
                };
            },
        ),
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
