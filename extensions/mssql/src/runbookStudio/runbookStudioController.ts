/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-panel Runbook Studio controller: hosts the provided CustomTextEditor
 * webview panel through the standard WebviewBaseController RPC machinery,
 * projects the shared document model into coarse RbsState pushes, and routes
 * typed requests. The webview is a pure renderer — no network, no runtime,
 * no SQL from the page (A2 §4.2); everything crosses this controller.
 */

import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { WebviewBaseController } from "../controllers/webviewBaseController";
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import {
    RbsArtifactSummary,
    RbsCancelCompileRequest,
    RbsCompileProgressNotification,
    RbsCompileRequest,
    RbsError,
    RbsFetchOutputPageRequest,
    RbsListConnectionsRequest,
    RbsNavigateNotification,
    RbsOpenDiagnosticsRequest,
    RbsRespondToGateRequest,
    RbsRoute,
    RbsRunEventNotification,
    RbsStartRunRequest,
    RbsState,
    RbsSetOutputViewRequest,
    RbsUpdateIntentRequest,
    RbsCancelRunRequest,
    RbsGetRunRequest,
    RBS_STATE_SCHEMA_VERSION,
    RunbookRunEvent,
} from "../sharedInterfaces/runbookStudio";
import { RunbookStudioDocumentModel } from "./runbookStudioDocumentModel";
import type { RunbookRunCoordinator } from "./runbookRunCoordinator";
import {
    pinnedViewsOf,
    resolvePresentation,
    upsertOutputPin,
    validatePresentationDefinition,
} from "./presentation/presentationResolver";

/** Coarse state pushes are throttled; edits/typing must not flood the webview. */
const STATE_PUSH_MIN_INTERVAL_MS = 100;

export class RunbookStudioController extends WebviewBaseController<RbsState, void> {
    private statePushTimer: ReturnType<typeof setTimeout> | undefined;
    private lastStatePush = 0;
    private openMarkerEnded = false;

    constructor(
        context: vscode.ExtensionContext,
        private readonly panel: vscode.WebviewPanel,
        private readonly model: RunbookStudioDocumentModel,
        private readonly coordinator: RunbookRunCoordinator | undefined,
        initialRoute?: RbsRoute,
    ) {
        super(
            context,
            "runbookStudio",
            RunbookStudioController.buildState(model, initialRoute),
            "runbookStudio",
        );
        this.panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)],
        };
        this.panel.webview.html = this._getHtmlTemplate();
        // Bind the RPC reader/writer to the PROVIDED panel's webview — a
        // custom editor must do this explicitly (Query Studio precedent) or
        // every message drops with "webview is not set".
        this.updateConnectionWebview(this.panel.webview);
        this.initializeBase();
        this.registerHandlers();

        this.registerDisposable(this.model.onDidChange(() => this.queueStatePush()));
        this.registerDisposable(
            vscode.workspace.onDidGrantWorkspaceTrust(() => this.queueStatePush()),
        );
        this.registerDisposable(this.panel.onDidChangeViewState(() => this.queueStatePush()));

        void this.whenWebviewReady()
            .then(() => this.endOpenMarker("ok"))
            .catch(() => this.endOpenMarker("timeout"));
    }

    public get documentUriKey(): string {
        return this.model.uriKey;
    }

    /** Whether this panel is the focused editor (Save to Library target). */
    public get isPanelActive(): boolean {
        return this.panel.active;
    }

    public navigate(route: RbsRoute): void {
        void this.sendNotification(RbsNavigateNotification.type, { route });
    }

    public pushRunEvent(event: RunbookRunEvent): void {
        void this.sendNotification(RbsRunEventNotification.type, event);
    }

    protected _getWebview(): vscode.Webview {
        return this.panel.webview;
    }

    /** Strict CSP (A2 §4.2): the page can make zero network requests. */
    protected override cspOptions(): { enabled: boolean; allowWorker?: boolean } {
        return { enabled: true };
    }

    private endOpenMarker(outcome: "ok" | "timeout"): void {
        if (this.openMarkerEnded) {
            return;
        }
        this.openMarkerEnded = true;
        Perf.marker("mssql.runbookStudio.open.end", "end", {
            documentKind: this.model.documentKind,
            ...(outcome === "timeout" ? { error: "webviewReadyTimeout" } : {}),
        });
    }

    private registerHandlers(): void {
        this.onRequest(RbsUpdateIntentRequest.type, async ({ intent }) => {
            const artifact = this.model.artifact;
            if (!artifact) {
                return { applied: false };
            }
            const applied = await this.model.applyArtifactEdit({
                ...artifact,
                source: { ...artifact.source, intent },
            });
            return { applied };
        });

        this.onRequest(RbsCompileRequest.type, async ({ intent }) => {
            if (!vscode.workspace.isTrusted) {
                return { ok: false, error: this.untrustedError() };
            }
            if (!this.coordinator) {
                return { ok: false, error: this.runtimeUnavailableError() };
            }
            // Best-effort model chip for the generation console — resolved
            // in parallel, fire-and-forget; the compile never waits on it.
            this.sendPlannerModelEvent(this.coordinator);
            // Forward each planner console event as-is — the adapter already
            // coalesces reasoning deltas, so no extra throttling here.
            return this.coordinator.compileIntent(this.model, intent, (event) => {
                void this.sendNotification(RbsCompileProgressNotification.type, event);
            });
        });

        this.onRequest(RbsCancelCompileRequest.type, async () => {
            return { cancelled: this.coordinator?.cancelCompile() ?? false };
        });

        this.onRequest(RbsSetOutputViewRequest.type, async ({ nodeId, view }) => {
            const artifact = this.model.artifact;
            if (!artifact?.lock?.nodes.some((n) => n.id === nodeId)) {
                return { applied: false };
            }
            const definition = upsertOutputPin(
                validatePresentationDefinition(artifact.presentation),
                nodeId,
                view,
            );
            const applied = await this.model.applyArtifactEdit({
                ...artifact,
                presentation: definition,
            });
            return { applied };
        });

        this.onRequest(RbsListConnectionsRequest.type, async () => {
            const profiles = (await this.coordinator?.listConnectionProfiles()) ?? [];
            return { profiles };
        });

        this.onRequest(RbsStartRunRequest.type, async ({ parameterValues }) => {
            if (!vscode.workspace.isTrusted) {
                return { error: this.untrustedError() };
            }
            if (!this.coordinator) {
                return { error: this.runtimeUnavailableError() };
            }
            return this.coordinator.startRun(this.model, parameterValues);
        });

        this.onRequest(RbsCancelRunRequest.type, async ({ runId }) => {
            if (!this.coordinator) {
                return { outcome: "failed" as const };
            }
            return this.coordinator.cancelRun(this.model, runId);
        });

        this.onRequest(RbsRespondToGateRequest.type, async ({ runId, nodeId, approve }) => {
            if (!this.coordinator) {
                return { accepted: false, error: this.runtimeUnavailableError() };
            }
            return this.coordinator.respondToGate(this.model, runId, nodeId, approve);
        });

        this.onRequest(RbsGetRunRequest.type, async ({ runId }) => {
            return this.coordinator?.getRun(this.model, runId);
        });

        this.onRequest(RbsFetchOutputPageRequest.type, async (page) => {
            if (!this.coordinator) {
                return { error: this.runtimeUnavailableError() };
            }
            return this.coordinator.fetchOutputPage(this.model, page);
        });

        this.onRequest(RbsOpenDiagnosticsRequest.type, async ({ runId, nodeId }) => {
            // Debug Console deep link (A2 §9.2): observation and navigation
            // only — the console is never the product host. A run whose
            // trace this window no longer retains fails safely.
            const traceId = runId ? this.coordinator?.traceIdOf(runId) : undefined;
            diag.emit({
                feature: "runbookStudio",
                kind: "event",
                type: "runbookStudio.openDiagnostics.requested",
                status: traceId || !runId ? "ok" : "partial",
                fields: {
                    hasRunId: { raw: runId !== undefined, cls: "diagnostic.metadata" },
                    hasNodeId: { raw: nodeId !== undefined, cls: "diagnostic.metadata" },
                    traceRetained: { raw: traceId !== undefined, cls: "diagnostic.metadata" },
                },
            });
            if (runId && !traceId) {
                return { opened: false };
            }
            await vscode.commands.executeCommand("mssql.openDebugConsole", {
                page: traceId ? "waterfall" : "overview",
                ...(traceId ? { traceId } : {}),
            });
            return { opened: true };
        });
    }

    /** Fire-and-forget "model" console event: resolve the planner model id
     *  from the coordinator's model configuration (feature-detected — the
     *  RunbookRunCoordinator interface does not declare it) so the
     *  generation console can show a model chip. Display-only; this never
     *  blocks and never fails the compile. */
    private sendPlannerModelEvent(coordinator: RunbookRunCoordinator): void {
        const candidate = coordinator as RunbookRunCoordinator & {
            getModelConfiguration?: () => Promise<
                | { providerLabel: string; plannerModelId?: string; workflowModelId?: string }
                | { error: RbsError }
            >;
        };
        if (
            !("getModelConfiguration" in coordinator) ||
            typeof candidate.getModelConfiguration !== "function"
        ) {
            return;
        }
        void candidate
            .getModelConfiguration()
            .then((config) => {
                if (this.isDisposed || "error" in config || !config.plannerModelId) {
                    return;
                }
                void this.sendNotification(RbsCompileProgressNotification.type, {
                    kind: "model",
                    text: config.plannerModelId,
                    label: config.providerLabel,
                });
            })
            .catch(() => undefined);
    }

    private untrustedError(): RbsError {
        return {
            code: "RunbookStudio.WorkspaceUntrusted",
            message: LocRunbookStudio.untrustedWorkspace,
        };
    }

    private runtimeUnavailableError(): RbsError {
        return {
            code: "RunbookStudio.RuntimeUnavailable",
            message: LocRunbookStudio.runtimeUnavailable,
            retryable: true,
        };
    }

    private queueStatePush(): void {
        if (this.isDisposed) {
            return;
        }
        const elapsed = Date.now() - this.lastStatePush;
        if (this.statePushTimer) {
            return;
        }
        const delay = Math.max(0, STATE_PUSH_MIN_INTERVAL_MS - elapsed);
        this.statePushTimer = setTimeout(() => {
            this.statePushTimer = undefined;
            this.lastStatePush = Date.now();
            if (!this.isDisposed) {
                this.state = RunbookStudioController.buildState(this.model);
            }
        }, delay);
    }

    public override dispose(): void {
        if (this.statePushTimer) {
            clearTimeout(this.statePushTimer);
            this.statePushTimer = undefined;
        }
        super.dispose();
    }

    private static buildState(
        model: RunbookStudioDocumentModel,
        initialRoute?: RbsRoute,
    ): RbsState {
        const artifact = model.artifact;
        let summary: RbsArtifactSummary | undefined;
        if (artifact) {
            summary = {
                id: artifact.id,
                name: artifact.name,
                ...(artifact.description !== undefined
                    ? { description: artifact.description }
                    : {}),
                ...(artifact.family !== undefined ? { family: artifact.family } : {}),
                intent: artifact.source.intent,
                parameters: artifact.source.parameters,
                hasLock: artifact.lock !== undefined,
                ...(artifact.lock ? { planRevision: artifact.lock.planRevision } : {}),
                ...(artifact.lock ? { entryNodeId: artifact.lock.entryNodeId } : {}),
                nodes: artifact.lock?.nodes ?? [],
                edges: artifact.lock?.edges ?? [],
                pinnedViews: pinnedViewsOf(validatePresentationDefinition(artifact.presentation)),
            };
        }
        // Pure resolution (rendering spec: deterministic, zero model calls,
        // handles only). Same-process official candidate marker pair.
        let presentation: ReturnType<typeof resolvePresentation> | undefined;
        if (model.activeRun) {
            Perf.marker("mssql.runbookStudio.presentation.resolve.begin", "begin");
            presentation = resolvePresentation(
                validatePresentationDefinition(artifact?.presentation),
                model.activeRun,
            );
            Perf.marker("mssql.runbookStudio.presentation.resolve.end", "end", {
                widgetCount: presentation.sections.reduce((n, s) => n + s.widgets.length, 0),
                sectionCount: presentation.sections.length,
                nodeCount: model.activeRun.nodes.length,
            });
        }
        return {
            schemaVersion: RBS_STATE_SCHEMA_VERSION,
            documentKind: model.documentKind,
            fileName: model.fileName,
            workspaceTrusted: vscode.workspace.isTrusted,
            ...(summary ? { artifact: summary } : {}),
            ...(model.artifactError ? { artifactError: model.artifactError } : {}),
            ...(model.activeRun ? { run: model.activeRun } : {}),
            ...(presentation ? { presentation } : {}),
            history: model.history,
            debugEnabled: vscode.workspace
                .getConfiguration()
                .get<boolean>("mssql.runbookStudio.debugTools", false),
            ...(initialRoute ? { initialRoute } : {}),
        };
    }
}
