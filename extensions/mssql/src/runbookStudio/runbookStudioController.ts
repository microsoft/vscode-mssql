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
import * as constants from "../constants/constants";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { WebviewBaseController } from "../controllers/webviewBaseController";
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import {
    RbsArtifactSummary,
    RbsApplyPresentationOverlayRequest,
    RbsApplyPresentationLayoutRequest,
    RbsCancelCompileRequest,
    RbsCompileProgressNotification,
    RbsCompileRequest,
    RbsError,
    RbsExecutePlanQueryRequest,
    RbsExportEvidenceRequest,
    RbsFetchOutputPageRequest,
    RbsListConnectionsRequest,
    RbsNavigateNotification,
    RbsOpenDiagnosticsRequest,
    RbsPreviewPresentationLayoutRequest,
    RbsRespondToGateRequest,
    RbsRoute,
    RbsRunEventNotification,
    RbsSelectRunRequest,
    RbsStartRunRequest,
    RbsState,
    RbsSetOutputViewRequest,
    RbsSetOutputPresentationRequest,
    RbsUpdateIntentRequest,
    RbsCancelRunRequest,
    RbsClearPresentationOverlayRequest,
    RbsGetRunRequest,
    RBS_STATE_SCHEMA_VERSION,
    RunbookArtifactFile,
    RunbookRunEvent,
} from "../sharedInterfaces/runbookStudio";
import {
    compatibleViews,
    defaultViewFor,
    expectedContractFor,
    isViewCandidateSelectable,
    OutputSchemaDescriptor,
    outputSchemaFingerprint,
    PresentationDefinition,
    PresentationLayoutEdit,
    PresentationLayoutPolicyEdit,
    PresentationSourceRef,
    ResolvedPresentation,
    RUN_FIELD_NAMES,
} from "../sharedInterfaces/runbookPresentation";
import { findActivity } from "./activities/activityCatalog";
import { RunbookStudioDocumentModel } from "./runbookStudioDocumentModel";
import {
    preflightContextForRuntime,
    preflightRunbookRequirements,
} from "./capabilities/runbookCapabilities";
import { resolvePlanQueryLaunch } from "./planQueryLaunch";
import type { RunbookRunCoordinator } from "./runbookRunCoordinator";
import {
    applyPresentationLayoutEdits,
    defaultPresentationSections,
    pinnedViewsOf,
    outputPresentationsOf,
    presentationSourcesEqual,
    presentationWidgetsOf,
    resetOutputPresentation,
    resolveDerivedSourcePlan,
    resolvePresentation,
    upsertOutputPresentation,
    upsertOutputPin,
    validateOutputViewSettings,
    validatePresentationDefinition,
} from "./presentation/presentationResolver";
import {
    applyTransformPipeline,
    validateTransformPipeline,
} from "./presentation/presentationTransforms";
import {
    createSampleRunSnapshot,
    fetchSampleOutputPage,
    isSampleHandle,
} from "./presentation/samplePresentation";
import { presentationSaveRequiresDraftDemotionConfirmation } from "./presentation/presentationSavePolicy";

/** Coarse state pushes are throttled; edits/typing must not flood the webview. */
const STATE_PUSH_MIN_INTERVAL_MS = 100;
const MAX_PRESENTATION_PREVIEWS = 20;

type PresentationPreviewTarget =
    | { kind: "run"; runId: string }
    | { kind: "sample"; scenario: "clean" | "blockingErrors" | "approvalRejected" };

export class RunbookStudioController extends WebviewBaseController<RbsState, void> {
    private statePushTimer: ReturnType<typeof setTimeout> | undefined;
    private lastStatePush = 0;
    private openMarkerEnded = false;
    private presentationPreviewSequence = 0;
    private readonly presentationPreviews = new Map<
        string,
        { definition: PresentationDefinition; target: PresentationPreviewTarget }
    >();
    private readonly presentationOverlays = new Map<
        string,
        {
            definition: PresentationDefinition;
            edits: PresentationLayoutEdit[];
            policy?: PresentationLayoutPolicyEdit;
        }
    >();

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

        // Rehydrate history + last-run presentation from the durable ledger
        // on OPEN (not first run) — feature-detected because the coordinator
        // seam does not declare persistence (perf/test hosts inject fakes).
        const seeding = coordinator as
            | (RunbookRunCoordinator & {
                  seedHistory?: (model: RunbookStudioDocumentModel) => void;
              })
            | undefined;
        seeding?.seedHistory?.(this.model);

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
            if (applied) {
                this.presentationOverlays.clear();
            }
            return { applied };
        });

        this.onRequest(
            RbsSetOutputPresentationRequest.type,
            async ({
                nodeId,
                views,
                presentation,
                defaultView,
                settings,
                baseRevision,
                resetToSuggested,
            }) => {
                const artifact = this.model.artifact;
                const node = artifact?.lock?.nodes.find((candidate) => candidate.id === nodeId);
                const definition = validatePresentationDefinition(artifact?.presentation);
                if ((definition?.revision ?? 0) !== baseRevision) {
                    return { applied: false, reason: "revisionConflict" as const };
                }
                const contract = node
                    ? expectedContractFor(node.kind, node.activityKind)
                    : undefined;
                const uniqueViews = new Set(views);
                const outputSchema = findActivity(node?.activityKind)?.outputSchema;
                const validMode =
                    (views.length === 1 && presentation.mode === "single") ||
                    (views.length > 1 && presentation.mode !== "single");
                if (
                    !artifact ||
                    !node ||
                    !contract ||
                    views.length === 0 ||
                    uniqueViews.size !== views.length ||
                    !views.includes(defaultView) ||
                    !validMode ||
                    views.some(
                        (view) => !isViewCandidateSelectable(contract, view, outputSchema),
                    ) ||
                    (settings !== undefined && !validateOutputViewSettings(settings, views))
                ) {
                    return { applied: false, reason: "invalid" as const };
                }
                const metadata = {
                    authoredContract: contract,
                    authoredContractFingerprint: outputSchemaFingerprint(contract, outputSchema),
                    ...(outputSchema ? { outputSchema } : {}),
                    planRevision: artifact.lock?.planRevision,
                };
                const next =
                    resetToSuggested && definition
                        ? resetOutputPresentation(
                              definition,
                              nodeId,
                              defaultViewFor(contract),
                              metadata,
                          )
                        : upsertOutputPresentation(
                              definition,
                              nodeId,
                              views,
                              presentation,
                              defaultView,
                              settings,
                              metadata,
                          );
                const applied = await this.model.applyArtifactEdit({
                    ...artifact,
                    presentation: next,
                });
                if (applied) {
                    this.presentationOverlays.clear();
                }
                return { applied };
            },
        );

        this.onRequest(
            RbsApplyPresentationLayoutRequest.type,
            async ({ edits, policy, baseRevision }) => {
                const prepared = this.preparePresentationLayout(edits, policy, baseRevision);
                if ("reason" in prepared) {
                    return { applied: false, reason: prepared.reason };
                }
                if (!(await this.confirmApprovedPresentationDemotion())) {
                    return { applied: false, reason: "cancelled" as const };
                }
                const applied = await this.model.applyArtifactEdit({
                    ...prepared.artifact,
                    presentation: prepared.definition,
                });
                if (applied) {
                    this.presentationOverlays.clear();
                }
                return { applied };
            },
        );

        this.onRequest(
            RbsPreviewPresentationLayoutRequest.type,
            async ({ edits, policy, baseRevision, target }) => {
                const prepared = this.preparePresentationLayout(edits, policy, baseRevision);
                if ("reason" in prepared) {
                    return { reason: prepared.reason };
                }
                const snapshot =
                    target.kind === "run"
                        ? this.model.displayRun?.runId === target.runId
                            ? this.model.displayRun
                            : undefined
                        : createSampleRunSnapshot(prepared.artifact, target.scenario);
                return snapshot
                    ? {
                          presentation: this.rememberPresentationPreview(
                              prepared.definition,
                              target,
                              resolvePresentation(prepared.definition, snapshot),
                          ),
                      }
                    : { reason: "targetMissing" as const };
            },
        );

        this.onRequest(
            RbsApplyPresentationOverlayRequest.type,
            async ({ runId, edits, policy, baseRevision }) => {
                if (this.model.displayRun?.runId !== runId) {
                    return { applied: false, reason: "targetMissing" as const };
                }
                const prepared = this.preparePresentationLayout(edits, policy, baseRevision);
                if ("reason" in prepared) {
                    return { applied: false, reason: prepared.reason };
                }
                this.presentationOverlays.set(runId, {
                    definition: prepared.definition,
                    edits,
                    ...(policy ? { policy } : {}),
                });
                this.queueStatePush();
                return { applied: true };
            },
        );

        this.onRequest(RbsClearPresentationOverlayRequest.type, async ({ runId }) => {
            const cleared = this.presentationOverlays.delete(runId);
            if (cleared) {
                this.queueStatePush();
            }
            return { cleared };
        });

        this.onRequest(RbsExecutePlanQueryRequest.type, async ({ nodeId, connectionValues }) => {
            if (!vscode.workspace.isTrusted) {
                return { opened: false, error: this.untrustedError() };
            }
            const artifact = this.model.artifact;
            if (!artifact) {
                return {
                    opened: false,
                    error: {
                        code: "RunbookStudio.InvalidArtifact" as const,
                        message: LocRunbookStudio.planQueryUnavailable,
                    },
                };
            }
            const resolved = resolvePlanQueryLaunch(artifact, nodeId, connectionValues);
            if (resolved.ok === false) {
                const policyDenied = resolved.reason === "sqlNotReadOnly";
                const bindingMissing = resolved.reason === "connectionValueMissing";
                return {
                    opened: false,
                    error: {
                        code: policyDenied
                            ? ("RunbookStudio.ActivityPolicyDenied" as const)
                            : bindingMissing
                              ? ("RunbookStudio.BindingInvalid" as const)
                              : ("RunbookStudio.InvalidArtifact" as const),
                        message: policyDenied
                            ? LocRunbookStudio.sqlNotReadOnly
                            : bindingMissing
                              ? LocRunbookStudio.parameterRequired(
                                    resolved.connectionParameterLabel ?? "connection",
                                )
                              : LocRunbookStudio.planQueryUnavailable,
                    },
                };
            }
            if (
                !vscode.workspace
                    .getConfiguration()
                    .get<boolean>("mssql.queryStudio.enabled", false)
            ) {
                return {
                    opened: false,
                    error: {
                        code: "RunbookStudio.RuntimeCapabilityUnsupported" as const,
                        message: LocRunbookStudio.queryStudioDisabled,
                    },
                };
            }
            try {
                await vscode.commands.executeCommand("mssql.queryStudio.newQueryFromContext", {
                    profileId: resolved.profileId,
                    initialSql: resolved.sql,
                    autoRun: true,
                    source: "runbookStudioPlan",
                });
                return { opened: true };
            } catch {
                return {
                    opened: false,
                    error: {
                        code: "RunbookStudio.Internal" as const,
                        message: LocRunbookStudio.queryStudioOpenFailed,
                        retryable: true,
                    },
                };
            }
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

        this.onRequest(RbsSelectRunRequest.type, async ({ runId }) => {
            if (!this.coordinator) {
                return { ok: false };
            }
            // The ledger resolves sealed records across restarts; an
            // unknown or unreadable run refuses honestly (the picker entry
            // stays, the presentation does not change).
            const snapshot = await this.coordinator.getRun(this.model, runId);
            if (!snapshot) {
                return { ok: false };
            }
            this.model.selectRun(snapshot);
            return { ok: true };
        });

        this.onRequest(RbsFetchOutputPageRequest.type, async (page) => {
            const preview = page.derivedPreviewId
                ? this.presentationPreviews.get(page.derivedPreviewId)
                : undefined;
            if (
                (page.derivedPreviewId && !preview) ||
                (page.derivedPreviewId && !page.derivedSourceId)
            ) {
                return {
                    error: {
                        code: "RunbookStudio.PresentationInvalid" as const,
                        message: LocRunbookStudio.presentationTransformFailed,
                    },
                };
            }
            if (isSampleHandle(page.handleId)) {
                const samplePage = fetchSampleOutputPage({
                    handleId: page.handleId,
                    startRow: page.derivedSourceId ? 0 : page.startRow,
                    rowCount: page.derivedSourceId ? 1000 : page.rowCount,
                });
                if (!page.derivedSourceId) {
                    return (
                        samplePage ?? {
                            error: {
                                code: "RunbookStudio.ResultNotFound" as const,
                                message: LocRunbookStudio.dataExpired,
                            },
                        }
                    );
                }
                const artifact = this.model.artifact;
                const base = validatePresentationDefinition(artifact?.presentation);
                const definition =
                    preview?.target.kind === "sample"
                        ? preview.definition
                        : preview
                          ? undefined
                          : base;
                const scenarios =
                    preview?.target.kind === "sample"
                        ? [preview.target.scenario]
                        : (["clean", "blockingErrors", "approvalRejected"] as const);
                const derived =
                    artifact && definition
                        ? scenarios
                              .flatMap((scenario) => {
                                  const snapshot = createSampleRunSnapshot(artifact, scenario);
                                  if (!snapshot) {
                                      return [];
                                  }
                                  const resolved = resolveDerivedSourcePlan(
                                      definition,
                                      page.derivedSourceId!,
                                      snapshot,
                                  );
                                  return (resolved.state === "ready" ||
                                      resolved.state === "expired") &&
                                      resolved.handleId === page.handleId
                                      ? [resolved]
                                      : [];
                              })
                              .at(0)
                        : undefined;
                if (!samplePage || !derived) {
                    return {
                        error: {
                            code: "RunbookStudio.PresentationInvalid" as const,
                            message: LocRunbookStudio.presentationTransformFailed,
                        },
                    };
                }
                const transformed = applyTransformPipeline(
                    { columns: samplePage.columns, rows: samplePage.rows },
                    derived.pipeline,
                );
                if (!transformed.ok) {
                    return {
                        error: {
                            code: "RunbookStudio.PresentationInvalid" as const,
                            message: LocRunbookStudio.presentationTransformFailed,
                        },
                    };
                }
                const start = Math.max(0, page.startRow);
                const count = Math.min(Math.max(0, page.rowCount), 1000);
                return {
                    columns: transformed.table.columns,
                    rows: transformed.table.rows.slice(start, start + count),
                    totalRows: transformed.table.rows.length,
                };
            }
            if (!this.coordinator) {
                return { error: this.runtimeUnavailableError() };
            }
            if (!page.derivedSourceId) {
                return this.coordinator.fetchOutputPage(this.model, page);
            }
            const run = this.model.displayRun;
            const base = validatePresentationDefinition(this.model.artifact?.presentation);
            const definition =
                preview?.target.kind === "run" && run?.runId === preview.target.runId
                    ? preview.definition
                    : preview
                      ? undefined
                      : run
                        ? (this.presentationOverlays.get(run.runId)?.definition ?? base)
                        : base;
            const derived =
                definition && run
                    ? resolveDerivedSourcePlan(definition, page.derivedSourceId, run)
                    : undefined;
            if (!derived || derived.state !== "ready" || derived.handleId !== page.handleId) {
                return {
                    error: {
                        code: "RunbookStudio.PresentationInvalid",
                        message: LocRunbookStudio.presentationTransformFailed,
                    },
                };
            }
            return this.coordinator.fetchOutputPage(this.model, {
                handleId: page.handleId,
                startRow: page.startRow,
                rowCount: page.rowCount,
                pipeline: derived.pipeline,
            });
        });

        this.onRequest(RbsExportEvidenceRequest.type, async ({ runId, format }) => {
            if (!this.coordinator) {
                return { exported: false, error: this.runtimeUnavailableError() };
            }
            return this.coordinator.exportEvidence(this.model, runId, format);
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
                this.state = RunbookStudioController.buildState(
                    this.model,
                    undefined,
                    this.presentationOverlays,
                );
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
        presentationOverlays?: ReadonlyMap<
            string,
            {
                definition: PresentationDefinition;
                edits: PresentationLayoutEdit[];
                policy?: PresentationLayoutPolicyEdit;
            }
        >,
    ): RbsState {
        const artifact = model.artifact;
        let summary: RbsArtifactSummary | undefined;
        if (artifact) {
            const presentationDefinition = validatePresentationDefinition(artifact.presentation);
            summary = {
                id: artifact.id,
                name: artifact.name,
                ...(artifact.description !== undefined
                    ? { description: artifact.description }
                    : {}),
                ...(artifact.family !== undefined ? { family: artifact.family } : {}),
                intent: artifact.source.intent,
                parameters: artifact.source.parameters,
                ...(artifact.source.requirements
                    ? { requirements: artifact.source.requirements }
                    : {}),
                ...(artifact.source.design ? { design: artifact.source.design } : {}),
                readiness: this.resolveReadiness(artifact.source.requirements),
                hasLock: artifact.lock !== undefined,
                ...(artifact.lock ? { planRevision: artifact.lock.planRevision } : {}),
                ...(artifact.lock ? { entryNodeId: artifact.lock.entryNodeId } : {}),
                nodes: artifact.lock?.nodes ?? [],
                edges: artifact.lock?.edges ?? [],
                pinnedViews: pinnedViewsOf(presentationDefinition),
                outputPresentations: outputPresentationsOf(presentationDefinition),
                outputSchemas: Object.fromEntries(
                    (artifact.lock?.nodes ?? []).flatMap((node) => {
                        const schema = findActivity(node.activityKind)?.outputSchema;
                        return schema ? [[node.id, schema]] : [];
                    }),
                ),
                presentationRevision: presentationDefinition?.revision ?? 0,
                presentationLayoutStrategy:
                    presentationDefinition?.results.layout.strategy ??
                    (presentationDefinition?.results.layout.sectionFlow === "dashboard"
                        ? "grid"
                        : "flow"),
                presentationSections: (
                    presentationDefinition?.results.sections ?? defaultPresentationSections()
                ).map((section) => ({
                    id: section.id,
                    ...(section.label ? { label: section.label } : {}),
                    role: section.role,
                    order: section.order,
                })),
                presentationWidgets: presentationWidgetsOf(presentationDefinition),
                derivedSources: (presentationDefinition?.derivedSources ?? []).map((source) => ({
                    id: source.id,
                    from: source.from,
                    pipeline: source.pipeline,
                    authoredContract: source.authoredContract,
                })),
            };
        }
        // Pure resolution (rendering spec: deterministic, zero model calls,
        // handles only) for the SELECTED run — the user's History pick, or
        // the active/most recent run by default. Same-process official
        // candidate marker pair.
        const displayRun = model.displayRun;
        const displayOverlay = displayRun ? presentationOverlays?.get(displayRun.runId) : undefined;
        let presentation: ReturnType<typeof resolvePresentation> | undefined;
        const presentationDefinition = validatePresentationDefinition(artifact?.presentation);
        if (displayRun) {
            Perf.marker("mssql.runbookStudio.presentation.resolve.begin", "begin");
            presentation = resolvePresentation(
                displayOverlay?.definition ?? presentationDefinition,
                displayRun,
            );
            Perf.marker("mssql.runbookStudio.presentation.resolve.end", "end", {
                widgetCount: presentation.sections.reduce((n, s) => n + s.widgets.length, 0),
                sectionCount: presentation.sections.length,
                nodeCount: displayRun.nodes.length,
            });
        }
        const previewScenarioIds = ["clean", "blockingErrors", "approvalRejected"] as const;
        const previewScenarios = artifact
            ? previewScenarioIds.flatMap((id) => {
                  const sampleRun = createSampleRunSnapshot(artifact, id);
                  return sampleRun
                      ? [
                            {
                                id,
                                presentation: resolvePresentation(
                                    presentationDefinition,
                                    sampleRun,
                                ),
                            },
                        ]
                      : [];
              })
            : [];
        const cleanPreview = previewScenarios.find((scenario) => scenario.id === "clean");
        const cleanWidgetCount = cleanPreview
            ? cleanPreview.presentation.sections.reduce(
                  (count, section) => count + section.widgets.length,
                  0,
              )
            : 0;
        const cleanNodeIds = new Set(
            cleanPreview?.presentation.sections.flatMap((section) =>
                section.widgets.map((widget) => widget.nodeId),
            ) ?? [],
        );
        const previewPresentations = previewScenarios.map((scenario) => ({
            ...scenario,
            hiddenBranchWidgetCount: Math.max(
                0,
                cleanWidgetCount -
                    scenario.presentation.sections.reduce(
                        (count, section) => count + section.widgets.length,
                        0,
                    ),
            ),
            hiddenBranchNodeIds: [...cleanNodeIds].filter(
                (nodeId) =>
                    !scenario.presentation.sections.some((section) =>
                        section.widgets.some((widget) => widget.nodeId === nodeId),
                    ),
            ),
        }));
        const availableRuns = model.history.map((entry) => ({
            runId: entry.runId,
            ...(entry.startedEpochMs ? { startedEpochMs: entry.startedEpochMs } : {}),
            state: entry.state,
            ...(entry.verdict ? { verdict: entry.verdict } : {}),
        }));
        return {
            schemaVersion: RBS_STATE_SCHEMA_VERSION,
            documentKind: model.documentKind,
            fileName: model.fileName,
            workspaceTrusted: vscode.workspace.isTrusted,
            ...(summary ? { artifact: summary } : {}),
            ...(model.artifactError ? { artifactError: model.artifactError } : {}),
            ...(displayRun ? { run: displayRun } : {}),
            ...(displayRun ? { selectedRunId: displayRun.runId } : {}),
            ...(availableRuns.length > 0 ? { availableRuns } : {}),
            ...(presentation ? { presentation } : {}),
            ...(displayRun && displayOverlay
                ? {
                      presentationOverlay: {
                          runId: displayRun.runId,
                          edits: displayOverlay.edits,
                          ...(displayOverlay.policy ? { policy: displayOverlay.policy } : {}),
                      },
                  }
                : {}),
            ...(cleanPreview ? { previewPresentation: cleanPreview.presentation } : {}),
            ...(previewPresentations.length > 0 ? { previewScenarios: previewPresentations } : {}),
            history: model.history,
            debugEnabled: vscode.workspace
                .getConfiguration()
                .get<boolean>("mssql.runbookStudio.debugTools", false),
            ...(initialRoute ? { initialRoute } : {}),
        };
    }

    private static resolveReadiness(requirements: RunbookArtifactFile["source"]["requirements"]) {
        const runtimeKind = vscode.workspace
            .getConfiguration()
            .get<string>("mssql.runbookStudio.runtime", "local");
        return preflightRunbookRequirements(requirements, {
            ...preflightContextForRuntime(runtimeKind),
            ...(runtimeKind === "local"
                ? {
                      providerAvailable:
                          vscode.extensions.getExtension(
                              constants.sqlDatabaseProjectsExtensionId,
                          ) !== undefined,
                  }
                : {}),
        });
    }

    private async confirmApprovedPresentationDemotion(): Promise<boolean> {
        const artifact = this.model.artifact;
        const lifecycleState = artifact
            ? await this.coordinator?.getLibraryLifecycleState?.(artifact.id)
            : undefined;
        if (
            !artifact ||
            !presentationSaveRequiresDraftDemotionConfirmation(
                this.model.backingDocument.uri.scheme,
                lifecycleState,
            )
        ) {
            return true;
        }
        const choice = await vscode.window.showWarningMessage(
            LocRunbookStudio.presentationApprovedDemotionWarning(artifact.name),
            { modal: true },
            LocRunbookStudio.presentationApprovedDemotionContinue,
        );
        return choice === LocRunbookStudio.presentationApprovedDemotionContinue;
    }

    /** Retain the exact host-validated definition behind a staged preview.
     * The opaque id lets derived page pulls use that definition without
     * accepting a transform pipeline from the webview. */
    private rememberPresentationPreview(
        definition: PresentationDefinition,
        target: PresentationPreviewTarget,
        presentation: ResolvedPresentation,
    ): ResolvedPresentation {
        const id = `preview-${++this.presentationPreviewSequence}`;
        this.presentationPreviews.set(id, { definition, target });
        while (this.presentationPreviews.size > MAX_PRESENTATION_PREVIEWS) {
            const oldest = this.presentationPreviews.keys().next().value as string | undefined;
            if (!oldest) {
                break;
            }
            this.presentationPreviews.delete(oldest);
        }
        return {
            ...presentation,
            sections: presentation.sections.map((section) => ({
                ...section,
                widgets: section.widgets.map((widget) =>
                    widget.derivedSourceId ? { ...widget, derivedPreviewId: id } : widget,
                ),
            })),
        };
    }

    private preparePresentationLayout(
        edits: PresentationLayoutEdit[],
        policy: PresentationLayoutPolicyEdit | undefined,
        baseRevision: number,
    ):
        | { artifact: RunbookArtifactFile; definition: PresentationDefinition }
        | { reason: "invalid" | "revisionConflict" } {
        const artifact = this.model.artifact;
        const definition = validatePresentationDefinition(artifact?.presentation);
        if ((definition?.revision ?? 0) !== baseRevision) {
            return { reason: "revisionConflict" };
        }
        const sections = definition?.results.sections ?? defaultPresentationSections();
        const sectionIds = new Set(sections.map((section) => section.id));
        const contractByNode: Record<string, string> = {};
        const fingerprintByNode: Record<string, string> = {};
        const outputSchemaByNode: Record<string, OutputSchemaDescriptor> = {};
        const sourceByNode: Record<string, PresentationSourceRef> = {};
        const titleByNode: Record<string, string> = {};
        const derivedById = new Map(
            (definition?.derivedSources ?? []).map((source) => [source.id, source]),
        );
        const existingDerivedIds = new Set(derivedById.keys());
        const removedDerivedIds = edits.flatMap((edit) =>
            edit.removeDerivedSourceId ? [edit.removeDerivedSourceId] : [],
        );
        const removedDerivedIdSet = new Set(removedDerivedIds);
        const renamedDerivedIds = edits.flatMap((edit) =>
            edit.renameDerivedSourceFrom && edit.derivedSource
                ? [[edit.renameDerivedSourceFrom, edit.derivedSource.id] as const]
                : [],
        );
        const renamedFromIds = new Set(renamedDerivedIds.map(([from]) => from));
        const renamedToIds = new Set(renamedDerivedIds.map(([, to]) => to));
        const validDerivedLifecycle =
            removedDerivedIdSet.size === removedDerivedIds.length &&
            renamedFromIds.size === renamedDerivedIds.length &&
            renamedToIds.size === renamedDerivedIds.length &&
            renamedDerivedIds.every(
                ([from, to]) =>
                    from !== to &&
                    existingDerivedIds.has(from) &&
                    !existingDerivedIds.has(to) &&
                    !removedDerivedIdSet.has(from) &&
                    !removedDerivedIdSet.has(to) &&
                    !renamedFromIds.has(to),
            ) &&
            !edits.some(
                (edit) => edit.renameDerivedSourceFrom !== undefined && !edit.derivedSource,
            ) &&
            !edits.some(
                (edit) =>
                    edit.derivedSource !== undefined &&
                    removedDerivedIdSet.has(edit.derivedSource.id),
            );
        for (const id of removedDerivedIds) {
            derivedById.delete(id);
        }
        for (const [id, source] of [...derivedById]) {
            const parentId = source.from.kind === "derived" ? source.from.sourceId : undefined;
            const renamedParent = parentId
                ? renamedDerivedIds.find(([from]) => from === parentId)?.[1]
                : undefined;
            if (renamedParent) {
                derivedById.set(id, {
                    ...source,
                    from: {
                        kind: "derived",
                        sourceId: renamedParent,
                    },
                });
            }
        }
        for (const [from, to] of renamedDerivedIds) {
            const authored = edits.find(
                (candidate) => candidate.renameDerivedSourceFrom === from,
            )?.derivedSource;
            if (!authored) {
                continue;
            }
            derivedById.delete(from);
            derivedById.set(to, {
                ...authored,
                provenance: { by: "user" },
            });
        }
        for (const edit of edits) {
            if (edit.derivedSource && !edit.renameDerivedSourceFrom) {
                derivedById.set(edit.derivedSource.id, {
                    ...edit.derivedSource,
                    provenance: { by: "user" },
                });
            }
        }
        let valid =
            artifact?.lock !== undefined &&
            validDerivedLifecycle &&
            (edits.length > 0 || policy !== undefined) &&
            edits.length <= 100 &&
            (policy === undefined || ["flow", "stacked", "grid"].includes(policy.strategy));
        for (const edit of edits) {
            const source =
                edit.source ??
                ({
                    kind: "activity-output",
                    nodeId: edit.nodeId,
                    slot: "primary",
                } satisfies PresentationSourceRef);
            if (edit.removeDerivedSourceId) {
                valid =
                    valid &&
                    edit.derivedSource === undefined &&
                    edit.removeDerivedSourceId.length > 0 &&
                    edit.removeDerivedSourceId.length <= 256 &&
                    existingDerivedIds.has(edit.removeDerivedSourceId) &&
                    source.kind === "derived" &&
                    source.sourceId === edit.removeDerivedSourceId &&
                    edit.nodeId.length > 0 &&
                    edit.nodeId.length <= 256;
                continue;
            }
            const widgetById = edit.widgetId
                ? definition?.results.widgets.find((widget) => widget.id === edit.widgetId)
                : undefined;
            const widgetForSource = definition?.results.widgets.find((widget) =>
                presentationSourcesEqual(widget.source, source),
            );
            const existingWidget = widgetById ?? widgetForSource;
            const expectedExistingSource = edit.renameDerivedSourceFrom
                ? ({
                      kind: "derived",
                      sourceId: edit.renameDerivedSourceFrom,
                  } satisfies PresentationSourceRef)
                : source;
            valid =
                valid &&
                (widgetById === undefined ||
                    presentationSourcesEqual(widgetById.source, expectedExistingSource)) &&
                (widgetForSource === undefined ||
                    edit.widgetId === undefined ||
                    widgetForSource.id === edit.widgetId) &&
                (edit.widgetId === undefined ||
                    (edit.widgetId.length > 0 && edit.widgetId.length <= 256)) &&
                (edit.renameDerivedSourceFrom === undefined ||
                    (edit.derivedSource !== undefined &&
                        source.kind === "derived" &&
                        source.sourceId === edit.derivedSource.id));
            if (edit.derivedSource) {
                const authored = edit.derivedSource;
                let fromContract: string | undefined;
                if (authored.from.kind === "activity-output") {
                    const { nodeId, slot } = authored.from;
                    const node = artifact?.lock?.nodes.find((candidate) => candidate.id === nodeId);
                    fromContract =
                        slot === "primary" && node
                            ? expectedContractFor(node.kind, node.activityKind)
                            : undefined;
                } else if (authored.from.kind === "derived") {
                    fromContract = derivedById.get(authored.from.sourceId)?.authoredContract;
                }
                valid =
                    valid &&
                    source.kind === "derived" &&
                    source.sourceId === authored.id &&
                    authored.id.length > 0 &&
                    authored.id.length <= 256 &&
                    validateTransformPipeline(authored.pipeline) &&
                    (fromContract === "rowset/1" || fromContract === "timeseries/1") &&
                    authored.authoredContract === fromContract;
            }
            let contract: string | undefined;
            let outputSchema: OutputSchemaDescriptor | undefined;
            if (source.kind === "activity-output") {
                const node = artifact?.lock?.nodes.find(
                    (candidate) => candidate.id === source.nodeId,
                );
                contract = node ? expectedContractFor(node.kind, node.activityKind) : undefined;
                outputSchema = findActivity(node?.activityKind)?.outputSchema;
                titleByNode[edit.nodeId] = node?.label ?? source.nodeId;
                valid =
                    valid &&
                    source.slot === "primary" &&
                    edit.nodeId === source.nodeId &&
                    node !== undefined;
            } else if (source.kind === "run-field") {
                contract = "scalarSet/1";
                titleByNode[edit.nodeId] = source.field;
                valid = valid && RUN_FIELD_NAMES.includes(source.field);
            } else if (source.kind === "run-metric") {
                contract = "scalarSet/1";
                titleByNode[edit.nodeId] = source.key;
                valid =
                    valid &&
                    source.key.length > 0 &&
                    source.key.length <= 256 &&
                    (existingWidget !== undefined ||
                        this.model.displayRun?.runMetrics?.[source.key] !== undefined);
            } else {
                const derived = derivedById.get(source.sourceId);
                contract = derived?.authoredContract;
                titleByNode[edit.nodeId] = source.sourceId;
                valid = valid && derived !== undefined;
            }
            const span = edit.placement.span;
            valid =
                valid &&
                contract !== undefined &&
                (source.kind === "activity-output"
                    ? isViewCandidateSelectable(contract, edit.defaultView, outputSchema)
                    : compatibleViews(contract).includes(edit.defaultView)) &&
                sectionIds.has(edit.sectionId) &&
                edit.nodeId.length > 0 &&
                edit.nodeId.length <= 256 &&
                Number.isInteger(edit.placement.order) &&
                edit.placement.order >= 0 &&
                (span?.compact === undefined ||
                    (Number.isInteger(span.compact) && span.compact >= 1 && span.compact <= 1)) &&
                (span?.medium === undefined ||
                    (Number.isInteger(span.medium) && span.medium >= 1 && span.medium <= 6)) &&
                (span?.wide === undefined ||
                    (Number.isInteger(span.wide) && span.wide >= 1 && span.wide <= 12));
            if (contract) {
                contractByNode[edit.nodeId] = contract;
                sourceByNode[edit.nodeId] = source;
                fingerprintByNode[edit.nodeId] = outputSchemaFingerprint(contract, outputSchema);
                if (outputSchema) {
                    outputSchemaByNode[edit.nodeId] = outputSchema;
                }
            }
        }
        if (!valid || !artifact) {
            return { reason: "invalid" };
        }
        const candidate = applyPresentationLayoutEdits(
            definition,
            edits,
            {
                contractByNode,
                fingerprintByNode,
                outputSchemaByNode,
                sourceByNode,
                titleByNode,
                planRevision: artifact.lock?.planRevision,
            },
            policy,
        );
        const validated = validatePresentationDefinition(candidate);
        return validated ? { artifact, definition: validated } : { reason: "invalid" };
    }
}
