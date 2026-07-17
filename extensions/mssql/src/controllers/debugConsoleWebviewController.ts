/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MSSQL Debug Console host controller: bridges the diagnostics substrate
 * (live tail, session store, perf-run import, capture policy) to the webview.
 * The webview is a renderer — every query/aggregation runs here.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    DcGetHistoryRequest,
    HistoryActionTrend,
    HistoryArtifactChips,
    HistorySessionRow,
    DebugConsoleState,
    DebugSource,
    DcCaptureChangedNotification,
    DcExportRequest,
    DcGetCauseTreeRequest,
    DcGetHealthRequest,
    DcGetTraceQualityRequest,
    DcGetOverviewRequest,
    DcGetPerfSummaryRequest,
    DcGetSqlActivityRequest,
    DcGetSqlDataPlaneStatusRequest,
    DcSqlDataPlaneStatus,
    DcGetWaterfallRequest,
    DcImportPerfRunRequest,
    DcListSourcesRequest,
    DcListTracesRequest,
    DcLivePushNotification,
    DcQueryEventsRequest,
    DcSetCaptureModeRequest,
    DcSubscribeLiveRequest,
    DcUnsubscribeLiveRequest,
    DcListSelfTestScenariosRequest,
    DcRunSelfTestRequest,
    DcBackfillGapRequest,
    DcCancelSelfTestRequest,
    DcSelfTestProgressNotification,
    DcCompletionsStatusRequest,
    DcCompletionsEnableRequest,
    DcIcDebugActionRequest,
    DcIcDebugChangedNotification,
    DcIcDebugStateRequest,
    DcNavigateNotification,
    DcOpenCompletionsViewerRequest,
    DcPageId,
    DcCentralPreviewRequest,
    DcCentralUploadProgressNotification,
    DcCentralUploadRequest,
    CentralPreviewInfo,
    CentralTargetInfo,
    DiagEvent,
    GapRecord,
} from "../sharedInterfaces/debugConsole";
import {
    buildWaterfall,
    causeTree,
    computeKpis,
    deriveAnomalies,
    sqlActivityRows,
    userActions,
} from "../diagnostics/analysis";
import {
    ConsoleCompletionsDebugHost,
    createConsoleCompletionsDebugHost,
    createEmptyConsoleCompletionsDebugState,
    createGateOffCompletionEventDetailResult,
    createGateOffCompletionLiveRowsResult,
    createGateOffIcDebugCapabilities,
    createGateOffIcDebugCommandResult,
    projectIcDebugStateResult,
} from "../diagnostics/completionsDebugConsoleHost";
import {
    DcCompletionEventDetailRequest,
    DcCompletionLiveRowsRequest,
    DcIcDebugCapabilitiesRequest,
    DcIcDebugChanged2Notification,
    DcIcDebugCommandRequest,
} from "../sharedInterfaces/completionsDebugRpc";
import {
    DcOpenQueryStudioReplayRequest,
    DcReplayRunAnalysisRequest,
    DcReplayRunDetailRequest,
    DcReplayRunListRequest,
    projectLiveReplayRunRow,
} from "../sharedInterfaces/replayLabRpc";
import {
    listReplayRunManifests,
    readReplayRunDetail,
} from "../diagnostics/featureCapture/replayRunCatalog";
import {
    buildLiveReplayAnalysisItemInput,
    buildReplayAnalysisItemInput,
    buildReplayRunListResult,
    clampReplayLabItemsLimit,
    projectDurableReplayItemRow,
    projectDurableReplayRunRow,
    projectLiveReplayItemRow,
    sanitizeReplayLabConfigGroup,
} from "../diagnostics/replayLabRpcHost";
import { computeReplayRunAnalysis } from "../sharedInterfaces/inlineCompletionReplayAnalysis";
import {
    hasHistoryArtifactChips,
    projectHistoryArtifactChips,
} from "../diagnostics/sessionBundle/historyChips";
import { diag } from "../diagnostics/diagnosticsCore";
import { DiagnosticsManager } from "../diagnostics/diagnosticsManager";
import { PerfHistoryService } from "../diagnostics/perfHistory/perfHistoryService";
import { importPerfMetrics, importPerfRun } from "../diagnostics/perfRunImport";
import { SelfTestService } from "../diagnostics/selfTest/selfTestService";
import { LiveTailSink } from "../diagnostics/sinks";

import {
    centralUploadHost,
    CentralUploadService,
    CentralUploadTargetConfig,
    loadDiagSessionSource,
} from "../diagnostics/centralUpload";
import {
    CentralProjection,
    projectDiagSession,
    UploadPolicyId,
} from "../sharedInterfaces/centralContract";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import { projectSqlDataPlaneStatus } from "../services/sqlDataPlane/debugConsoleStatus";
import { tsNativeObservabilityCounters } from "../services/tsNative/observability";
import {
    disableAiCompletions,
    enableAiCompletions,
    getCompletionsEnablementStatus,
} from "../copilot/inlineCompletionEnablement";
import { isInlineCompletionFeatureEnabled } from "../copilot/inlineCompletionFeatureGate";
import * as Constants from "../constants/constants";
import { lintCorrelation } from "../sharedInterfaces/observabilityContract.generated";
import {
    PhAddSourceRequest,
    PhCompareRepsRequest,
    PhDeleteRunRequest,
    PhGetDumpRequest,
    PhGetRichDiagnosticsRequest,
    PhGetSqlActivityRequest,
    PhGetSummaryRequest,
    PhGetWaterfallRequest,
    PhIndexProgressNotification,
    PhListSourcesRequest,
    PhMetricSeriesRequest,
    PhQueryRunsRequest,
    PhQueryScenariosRequest,
    PhRemoveSourceRequest,
    PhRescanRequest,
    PhScenarioDetailsRequest,
} from "../sharedInterfaces/perfHistory";
import { WebviewPanelController } from "./webviewPanelController";

const LIVE_ARCHIVE_CAP = 100_000;
/** WI-4.2: items considered per run analysis (aggregates only leave the host). */
const REPLAY_ANALYSIS_MAX_ITEMS = 10_000;

export class DebugConsoleWebviewController extends WebviewPanelController<
    DebugConsoleState,
    void,
    void
> {
    private liveArchive: DiagEvent[] = [];
    private liveGaps: GapRecord[] = [];
    private liveTail: LiveTailSink;
    private subscribed = false;
    private perfRunCounter = 0;
    private readonly selfTest: SelfTestService;
    private readonly perfHistory: PerfHistoryService;
    /** Console-hosted Inline Completion Debug host (lazy; gated on the feature). */
    private icDebugHost: ConsoleCompletionsDebugHost | undefined;
    public disposed = false;

    constructor(
        context: vscode.ExtensionContext,
        private readonly diagnostics: DiagnosticsManager,
        initialPage?: DcPageId,
    ) {
        super(
            context,
            "debugConsole",
            "debugConsole",
            {
                sources: [],
                activeSourceId: `live:${diag.sessionId}`,
                captureMode: diag.captureMode,
                ...(diag.captureExpiresEpochMs !== undefined
                    ? { captureExpiresEpochMs: diag.captureExpiresEpochMs }
                    : {}),
                provenance: diagnostics.provenance,
                fixtureMode: false,
                ...(initialPage !== undefined ? { initialPage } : {}),
            },
            {
                title: "MSSQL Debug Console",
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "executionPlan_light.svg",
                    ),
                },
            },
        );

        // Archive sink: retains this session's events for history queries while
        // the console is open (durable copy lives in Session Diag when enabled).
        const archiveSinkId = "consoleArchive";
        if (!diag.hasSink(archiveSinkId)) {
            diag.addSink({
                id: archiveSinkId,
                tryWrite: (event) => {
                    this.liveArchive.push(event);
                    if (this.liveArchive.length > LIVE_ARCHIVE_CAP) {
                        this.liveArchive.splice(0, this.liveArchive.length - LIVE_ARCHIVE_CAP);
                    }
                },
            });
        }

        // Seed with THIS session's already-persisted events: when
        // mssql.sessionDiag.enabled captured startup/activation before the
        // console opened, that data appears immediately in the live source
        // instead of only after a restart.
        try {
            diag.flushAll();
            const persisted = diagnostics.store.eventsForSource(`store:${diag.sessionId}`);
            if (persisted.length > 0) {
                const known = new Set(this.liveArchive.map((event) => event.seq));
                this.liveArchive = [
                    ...persisted.filter((event) => !known.has(event.seq)),
                    ...this.liveArchive,
                ].slice(-LIVE_ARCHIVE_CAP);
            }
        } catch {
            // seeding is best-effort; live capture continues regardless
        }
        this.liveTail = new LiveTailSink();
        diag.addSink(this.liveTail);
        this.panel.onDidDispose(() => {
            this.disposed = true;
            diag.removeSink(this.liveTail.id);
            diag.removeSink(archiveSinkId);
            this.icDebugHost?.dispose();
            this.icDebugHost = undefined;
        });

        diag.onCaptureModeChanged((mode) => {
            void this.sendNotification(DcCaptureChangedNotification.type, {
                mode,
                ...(diag.captureExpiresEpochMs !== undefined
                    ? { expiresEpochMs: diag.captureExpiresEpochMs }
                    : {}),
            });
        });

        // Self-test runner: runs perftest scenarios in-process; progress streams
        // to the webview and events flow through diag into the live views.
        // Completed runs attach as a console source for trace/waterfall drill-in.
        this.selfTest = new SelfTestService(
            context,
            (progress) => {
                void this.sendNotification(DcSelfTestProgressNotification.type, progress);
                // Tests open editors over the console; when the run finishes,
                // bring the console back so the results are visible.
                if ((progress.phase === "runEnd" || progress.phase === "error") && !this.disposed) {
                    try {
                        this.revealToForeground();
                    } catch {
                        // panel going away — nothing to reveal
                    }
                }
            },
            (runId, runDir) => {
                const imported = importPerfRun(runDir);
                if (!imported) {
                    return undefined;
                }
                this.perfRunCounter++;
                const sourceId = `perfrun:${this.perfRunCounter}`;
                this.diagnostics.store.registerPerfRun(
                    sourceId,
                    `Self-test ${runId}`,
                    imported.events,
                );
                return sourceId;
            },
        );

        // Perf Test History: source registry + incremental index + lazy artifacts.
        this.perfHistory = new PerfHistoryService(context, (progress) => {
            void this.sendNotification(PhIndexProgressNotification.type, progress);
        });

        this.registerHandlers();
        this.registerPerfHistoryHandlers();
        diag.emit({ feature: "sessionDiag", type: "debugConsole.opened" });
    }

    private registerPerfHistoryHandlers(): void {
        this.onRequest(PhListSourcesRequest.type, async () => this.perfHistory.listSources());
        this.onRequest(PhAddSourceRequest.type, async ({ kind }) => {
            const outcome = await this.perfHistory.addSource(kind);
            return { sources: await this.perfHistory.listSources(), ...outcome };
        });
        this.onRequest(PhRemoveSourceRequest.type, async ({ sourceId }) => {
            await this.perfHistory.removeSource(sourceId);
            return this.perfHistory.listSources();
        });
        this.onRequest(PhRescanRequest.type, async ({ sourceId }) =>
            this.perfHistory.rescan(sourceId),
        );
        this.onRequest(PhGetSummaryRequest.type, async ({ sourceId }) =>
            this.perfHistory.summary(sourceId),
        );
        this.onRequest(PhQueryRunsRequest.type, async (query) => this.perfHistory.queryRuns(query));
        this.onRequest(PhQueryScenariosRequest.type, async (query) =>
            this.perfHistory.queryScenarios(query),
        );
        this.onRequest(PhMetricSeriesRequest.type, async (query) =>
            this.perfHistory.metricSeries(query),
        );
        this.onRequest(PhScenarioDetailsRequest.type, async (query) =>
            this.perfHistory.scenarioDetails(query),
        );
        this.onRequest(PhGetWaterfallRequest.type, async (query) =>
            this.perfHistory.waterfall(query),
        );
        this.onRequest(PhGetSqlActivityRequest.type, async (query) =>
            this.perfHistory.sqlActivity(query),
        );
        this.onRequest(PhGetDumpRequest.type, async (query) => this.perfHistory.dump(query));
        this.onRequest(PhGetRichDiagnosticsRequest.type, async (query) =>
            this.perfHistory.richDiagnostics(query),
        );
        this.onRequest(PhCompareRepsRequest.type, async (query) =>
            this.perfHistory.compareReps(query),
        );
        this.onRequest(PhDeleteRunRequest.type, async ({ sourceId, runId }) => {
            // Destructive: removes the run directory from disk. Confirm once.
            const choice = await vscode.window.showWarningMessage(
                `Delete perf run '${runId}'? This removes the run directory and its artifacts from disk.`,
                { modal: true },
                "Delete run",
            );
            if (choice !== "Delete run") {
                return { ok: false, error: "cancelled" };
            }
            return this.perfHistory.deleteRun(sourceId, runId);
        });
    }

    private get liveSourceId(): string {
        return `live:${diag.sessionId}`;
    }

    private eventsFor(sourceId: string): DiagEvent[] {
        return this.diagnostics.store.eventsForSource(sourceId, this.liveArchive);
    }

    /**
     * Passive live snapshot of the SQL Data Plane registry for the Debug
     * Console page. statusSummary() is documented as safe/passive (never
     * constructs a backend); we only reshape it into the typed contract and
     * append ts-native aggregate counters. All fields are protocol metadata.
     */
    private sqlDataPlaneStatus(): DcSqlDataPlaneStatus {
        const svc = SqlDataPlaneService.get();
        const cfg = vscode.workspace.getConfiguration();
        const settingKeys = [
            "mssql.sqlDataPlane.enabled",
            "mssql.sqlDataPlane.backend",
            "mssql.sqlDataPlane.capabilityFallback",
            "mssql.sqlDataPlane.tsNative.overrides",
            "mssql.sqlDataPlane.timeouts.openMs",
            "mssql.sqlDataPlane.timeouts.cancelAckMs",
            "mssql.sqlDataPlane.timeouts.closeMs",
            "mssql.sqlDataPlane.timeouts.disposeDrainMs",
        ];
        const settings: Record<string, unknown> = {};
        for (const key of settingKeys) {
            const value = cfg.get<unknown>(key);
            if (value !== undefined) {
                settings[key] = value;
            }
        }
        return projectSqlDataPlaneStatus({
            summary: svc.statusSummary(),
            nowEpochMs: Date.now(),
            observability: tsNativeObservabilityCounters(),
            fallbackPolicy: cfg.get<string>("mssql.sqlDataPlane.capabilityFallback", "prompt"),
            environment: {
                node: process.versions.node,
                platform: process.platform,
                arch: process.arch,
                extensionVersion:
                    (vscode.extensions.getExtension("ms-mssql.mssql")?.packageJSON?.version as
                        | string
                        | undefined) ?? "unknown",
                settings,
            },
            rememberedFallbacks: svc.rememberedFallbacks(),
            capabilities: svc.capabilitySnapshot(),
        });
    }

    private gapsFor(sourceId: string): GapRecord[] {
        return sourceId === this.liveSourceId ? this.liveGaps : [];
    }

    private listSources(): DebugSource[] {
        return this.diagnostics.store.listSources({
            sessionId: diag.sessionId,
            eventCount: this.liveArchive.length,
            captureMode: diag.captureMode,
            provenance: this.diagnostics.provenance,
        });
    }

    private registerHandlers(): void {
        this.onRequest(DcListSourcesRequest.type, async () => this.listSources());

        this.onRequest(DcQueryEventsRequest.type, async (query) =>
            this.diagnostics.store.query(
                this.eventsFor(query.sourceId),
                query,
                this.gapsFor(query.sourceId),
            ),
        );

        this.onRequest(DcGetOverviewRequest.type, async ({ sourceId }) => {
            const events = this.eventsFor(sourceId);
            const gaps = this.gapsFor(sourceId);
            return {
                kpis: computeKpis(
                    events,
                    gaps,
                    sourceId === this.liveSourceId ? diag.captureMode : "off",
                ),
                actions: userActions(events),
                anomalies: deriveAnomalies(events, gaps),
            };
        });

        this.onRequest(DcGetCauseTreeRequest.type, async ({ sourceId, eventId }) =>
            causeTree(this.eventsFor(sourceId), eventId),
        );

        this.onRequest(DcGetWaterfallRequest.type, async ({ sourceId, traceId }) =>
            buildWaterfall(this.eventsFor(sourceId), traceId),
        );

        this.onRequest(DcListTracesRequest.type, async ({ sourceId }) =>
            userActions(this.eventsFor(sourceId)),
        );

        this.onRequest(DcGetSqlActivityRequest.type, async ({ sourceId }) =>
            sqlActivityRows(this.eventsFor(sourceId)),
        );

        this.onRequest(DcGetSqlDataPlaneStatusRequest.type, async () => this.sqlDataPlaneStatus());

        this.onRequest(DcSubscribeLiveRequest.type, async () => {
            this.subscribed = true;
            const { lastSeq } = this.liveTail.subscribe((events, gap) => {
                if (!this.subscribed) {
                    return;
                }
                if (gap) {
                    this.liveGaps.push(gap);
                    void this.sendNotification(DcLivePushNotification.type, {
                        kind: "gap",
                        gap,
                    });
                }
                void this.sendNotification(DcLivePushNotification.type, {
                    kind: "events",
                    events,
                    lastSeq: events.length > 0 ? events[events.length - 1].seq : 0,
                });
            });
            return {
                snapshot: this.diagnostics.store.query(
                    this.liveArchive,
                    { sourceId: this.liveSourceId, limit: 500 },
                    this.liveGaps,
                ),
                lastSeq,
            };
        });

        this.onRequest(DcUnsubscribeLiveRequest.type, async () => {
            this.subscribed = false;
            this.liveTail.unsubscribe();
        });

        // Recover a live-tail gap from the session store's journal — the
        // payoff for always-on capture: overflow drops become recoverable.
        this.onRequest(DcBackfillGapRequest.type, async ({ fromSeq, throughSeq }) => {
            if (!this.diagnostics.storeActive) {
                return {
                    ok: false,
                    status: "failed" as const,
                    reason: "Session Diag store is off — enable mssql.sessionDiag.enabled to make gaps recoverable",
                };
            }
            try {
                diag.flushAll();
                const events = this.diagnostics.store
                    .eventsForSource(`store:${diag.sessionId}`)
                    .filter((event) => event.seq >= fromSeq && event.seq <= throughSeq);
                if (events.length === 0) {
                    return {
                        ok: false,
                        status: "failed" as const,
                        reason: `range ${fromSeq}–${throughSeq} not in the store (evicted by the store buffer before flush)`,
                    };
                }
                const expected = throughSeq - fromSeq + 1;
                return {
                    ok: true,
                    events,
                    status:
                        events.length >= expected ? ("succeeded" as const) : ("partial" as const),
                    ...(events.length < expected
                        ? { reason: `${events.length} of ${expected} recovered` }
                        : {}),
                };
            } catch (error) {
                return {
                    ok: false,
                    status: "failed" as const,
                    reason: error instanceof Error ? error.message : String(error),
                };
            }
        });

        // Sink + store health: degradation is visible, never inferred.
        this.onRequest(DcGetHealthRequest.type, async () => ({
            sinks: diag.sinkHealthSnapshot(),
            store: {
                enabled: this.diagnostics.storeActive,
                ...this.diagnostics.store.validateStore(),
            },
            bundles: this.diagnostics.bundleManager.healthSnapshot(),
        }));
        // Trace Identity V1 lint: how well-stitched is this source (or one
        // trace)? Fog is reported, never painted over.
        this.onRequest(DcGetTraceQualityRequest.type, async ({ sourceId, traceId }) => {
            let events = this.eventsFor(sourceId).filter(
                (event) => !event.tags?.includes("viewerInternal"),
            );
            if (traceId) {
                events = events.filter((event) => event.traceId === traceId);
            }
            return lintCorrelation(events);
        });

        this.onRequest(DcSetCaptureModeRequest.type, async (request) => {
            // Applies immediately (settings persistence happens in background).
            this.diagnostics.applyCaptureMode(request.mode, {
                ...(request.reason !== undefined ? { reason: request.reason } : {}),
                ...(request.durationMinutes !== undefined
                    ? { durationMinutes: request.durationMinutes }
                    : {}),
            });
            if (request.mode === "full") {
                diag.emit({
                    feature: "sessionDiag",
                    type: "sessionDiag.elevated",
                    status: "warning",
                    fields: {
                        reason: {
                            raw: request.reason ?? "elevated from Debug Console",
                            cls: "user.text",
                        },
                    },
                });
            }
            this.diagnostics.updateStatusItem();
            return {
                mode: diag.captureMode,
                ...(diag.captureExpiresEpochMs !== undefined
                    ? { expiresEpochMs: diag.captureExpiresEpochMs }
                    : {}),
            };
        });

        this.onRequest(DcImportPerfRunRequest.type, async () => {
            const picked = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                title: "Select a perftest run directory (perf-runs/<runId>)",
            });
            if (!picked || picked.length === 0) {
                return undefined;
            }
            const runDir = picked[0].fsPath;
            const imported = importPerfRun(runDir);
            if (!imported) {
                void vscode.window.showWarningMessage(
                    "No harness markers found in the selected directory.",
                );
                return undefined;
            }
            this.perfRunCounter++;
            this.diagnostics.store.registerPerfRun(
                `perfrun:${this.perfRunCounter}`,
                imported.label,
                imported.events,
            );
            return this.listSources();
        });

        this.onRequest(DcGetPerfSummaryRequest.type, async (request) => {
            const root =
                request.perfRunsRoot ??
                vscode.workspace
                    .getConfiguration()
                    .get<string>("mssql.debugConsole.perfRunsRoot", "");
            const imported = root ? importPerfMetrics(root) : { samples: [], runs: [] };
            return {
                scenarios: [...new Set(imported.samples.map((s) => s.scenarioId))].sort(),
                metrics: [...new Set(imported.samples.map((s) => s.metricName))].sort(),
                samples: imported.samples,
                runs: imported.runs,
            };
        });

        this.onRequest(DcGetHistoryRequest.type, async () => {
            const sessions: HistorySessionRow[] = [];
            const trendMap = new Map<
                string,
                {
                    feature: string;
                    points: HistoryActionTrend["points"];
                }
            >();
            let totalEvents = 0;
            let totalActions = 0;
            // WI-4.4: per-session artifact chips from the bundle catalog
            // (descriptor counts only — no child manifest or segment is
            // opened here). No bundle → no chips object (legacy honesty).
            const chipsFor = async (
                hostSessionId: string,
            ): Promise<HistoryArtifactChips | undefined> => {
                try {
                    const bundle = await this.diagnostics.bundleManager.getBundle(hostSessionId);
                    if (!bundle) {
                        return undefined;
                    }
                    const chips = projectHistoryArtifactChips(bundle);
                    return hasHistoryArtifactChips(chips) ? chips : undefined;
                } catch {
                    return undefined; // catalog trouble never fails History
                }
            };
            const analyze = (
                sourceId: string,
                hostSessionId: string,
                label: string,
                createdUtc: string,
                live: boolean,
                captureMode: HistorySessionRow["captureMode"],
                events: DiagEvent[],
                gaps: number,
                artifacts: HistoryArtifactChips | undefined,
            ) => {
                const actions = userActions(events);
                const errors = events.filter((e) => e.status === "error").length;
                sessions.push({
                    sourceId,
                    hostSessionId,
                    label,
                    createdUtc,
                    live,
                    events: events.length,
                    errors,
                    gaps,
                    captureMode,
                    actionCount: actions.length,
                    ...(artifacts !== undefined ? { artifacts } : {}),
                });
                totalEvents += events.length;
                totalActions += actions.length;
                // Per-action-label medians for cross-session trends.
                const byLabel = new Map<
                    string,
                    { feature: string; durations: number[]; errors: number }
                >();
                for (const action of actions) {
                    if (action.durationMs === undefined) continue;
                    const entry = byLabel.get(action.label) ?? {
                        feature: action.feature,
                        durations: [],
                        errors: 0,
                    };
                    entry.durations.push(action.durationMs);
                    if (action.status === "error") entry.errors++;
                    byLabel.set(action.label, entry);
                }
                for (const [actionLabel, entry] of byLabel) {
                    const sorted = [...entry.durations].sort((a, b) => a - b);
                    const median = sorted[Math.floor((sorted.length - 1) / 2)];
                    const trend = trendMap.get(actionLabel) ?? {
                        feature: entry.feature,
                        points: [],
                    };
                    trend.points.push({
                        sourceId,
                        sessionLabel: label,
                        createdUtc,
                        medianMs: Number(median.toFixed(1)),
                        count: entry.durations.length,
                        errors: entry.errors,
                    });
                    trendMap.set(actionLabel, trend);
                }
            };

            // Stored sessions (newest first, bounded), then the live session.
            for (const { manifest } of this.diagnostics.store.listLocalSessions().slice(0, 15)) {
                if (manifest.sessionId === diag.sessionId) continue;
                const sourceId = `store:${manifest.sessionId}`;
                analyze(
                    sourceId,
                    manifest.sessionId,
                    `Session ${manifest.createdUtc.slice(0, 16).replace("T", " ")}`,
                    manifest.createdUtc,
                    false,
                    manifest.captureMode,
                    this.diagnostics.store.eventsForSource(sourceId),
                    manifest.gapCount,
                    await chipsFor(manifest.sessionId),
                );
            }
            analyze(
                this.liveSourceId,
                diag.sessionId,
                "Current session",
                new Date().toISOString(),
                true,
                diag.captureMode,
                this.liveArchive,
                this.liveGaps.length,
                await chipsFor(diag.sessionId),
            );
            sessions.sort((a, b) => a.createdUtc.localeCompare(b.createdUtc));
            const trends: HistoryActionTrend[] = [...trendMap.entries()]
                .map(([label, entry]) => ({
                    label,
                    feature: entry.feature,
                    points: entry.points.sort((a, b) => a.createdUtc.localeCompare(b.createdUtc)),
                }))
                .filter((trend) => trend.points.length >= 1)
                .sort((a, b) => b.points.length - a.points.length)
                .slice(0, 8);
            return { sessions, trends, totalEvents, totalActions };
        });

        this.onRequest(DcListSelfTestScenariosRequest.type, async () => this.selfTest.catalog());

        this.onRequest(DcRunSelfTestRequest.type, async (request) => this.selfTest.run(request));

        this.onRequest(DcCancelSelfTestRequest.type, async () => this.selfTest.cancel());

        this.onRequest(DcExportRequest.type, async ({ sourceId }) => {
            const events = this.eventsFor(sourceId);
            if (events.length === 0) {
                return { events: 0, redactions: 0, error: "No events to export" };
            }
            const target = await vscode.window.showSaveDialog({
                title: "Export diagnostic events (redacted JSONL)",
                filters: { "JSON Lines": ["jsonl"] },
                defaultUri: vscode.Uri.file(
                    path.join(
                        this.diagnostics.store.storeRoot,
                        `mssql-diag-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jsonl`,
                    ),
                ),
            });
            if (!target) {
                return { events: 0, redactions: 0, error: "cancelled" };
            }
            try {
                diag.flushAll();
                const redactions = events.reduce((sum, e) => sum + e.cls.redactedFields, 0);
                fs.mkdirSync(path.dirname(target.fsPath), { recursive: true });
                fs.writeFileSync(
                    target.fsPath,
                    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
                    "utf8",
                );
                diag.emit({
                    feature: "sessionDiag",
                    type: "sessionDiag.export.end",
                    fields: {
                        events: { raw: events.length, cls: "diagnostic.metadata" },
                        redactions: { raw: redactions, cls: "diagnostic.metadata" },
                    },
                });
                return { path: target.fsPath, events: events.length, redactions };
            } catch (error) {
                return { events: 0, redactions: 0, error: String(error) };
            }
        });

        // Completions page: enablement + full-viewer launch. The page shows
        // substrate activity (redacted protocol metadata); prompt/response
        // fidelity lives in the dedicated Inline Completion Debug panel.
        this.onRequest(DcCompletionsStatusRequest.type, async () =>
            getCompletionsEnablementStatus(),
        );

        this.onRequest(DcCompletionsEnableRequest.type, async ({ enable }) =>
            enable ? enableAiCompletions() : disableAiCompletions(),
        );

        this.onRequest(DcOpenCompletionsViewerRequest.type, async () => {
            if (!isInlineCompletionFeatureEnabled()) {
                return { ok: false, error: "Enable AI completions first." };
            }
            await vscode.commands.executeCommand(Constants.cmdOpenInlineCompletionDebug);
            return { ok: true };
        });

        // WI-3.6 Lab integration: the Query Studio "New replay…" entry opens
        // the standalone QS Replay panel — its cart/capture UX lives there;
        // durable QS runs list here via dc/replayRunList.
        this.onRequest(DcOpenQueryStudioReplayRequest.type, async () => {
            try {
                await vscode.commands.executeCommand("mssql.queryStudio.openReplayLab");
                return { ok: true };
            } catch (error) {
                return {
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        });

        // Console-hosted Inline Completion Debug: the host wraps the singleton
        // capture store; it comes up lazily on the first state pull and only
        // while the feature gate is on. When gated off, the page gets the
        // honest empty default state instead. omitEvents (WI-1.4) strips live
        // event bodies — the page reads those over dc/completionLiveRows.
        this.onRequest(DcIcDebugStateRequest.type, async (params) => {
            const host = this.ensureIcDebugHost();
            return projectIcDebugStateResult(
                host ? host.getState() : createEmptyConsoleCompletionsDebugState(),
                params,
            );
        });

        this.onRequest(DcIcDebugActionRequest.type, async ({ name, payload }) => {
            const host = this.ensureIcDebugHost();
            return host
                ? host.dispatchAction(name, payload)
                : createEmptyConsoleCompletionsDebugState();
        });

        // Typed, versioned Inline Completion Debug RPC (WI-1.2/WI-1.3):
        // capabilities handshake, validated command dispatch, thin cursor-paged
        // live rows, and section-lazy event detail. Additive — the legacy
        // state/action/changed trio above keeps working until the webview
        // migrates. Gate-off mirrors the state handler: honest empties.
        this.onRequest(DcIcDebugCapabilitiesRequest.type, async () => {
            const host = this.ensureIcDebugHost();
            return host ? host.getCapabilities() : createGateOffIcDebugCapabilities();
        });

        this.onRequest(DcIcDebugCommandRequest.type, async (params) => {
            const host = this.ensureIcDebugHost();
            return host ? host.dispatchCommand(params) : createGateOffIcDebugCommandResult();
        });

        this.onRequest(DcCompletionLiveRowsRequest.type, async (params) => {
            const host = this.ensureIcDebugHost();
            return host ? host.getLiveRows(params) : createGateOffCompletionLiveRowsResult();
        });

        this.onRequest(DcCompletionEventDetailRequest.type, async (params) => {
            const host = this.ensureIcDebugHost();
            return host ? host.getEventDetail(params) : createGateOffCompletionEventDetailResult();
        });

        // Replay Lab (WI-3.5): durable run catalog + lazy per-run detail. The
        // LIST is durable-rows-only (manifest-only enumeration; the page
        // merges its live engine rows client-side); the DETAIL combines the
        // durable manifest/items with this console's live queue rows so
        // queued/running items are visible before they settle. Both work with
        // the feature gate off — durable evidence outlives the gate.
        this.onRequest(DcReplayRunListRequest.type, async (params) => {
            const catalog = await listReplayRunManifests({
                storeRoot: this.diagnostics.store.storeRoot,
                currentHostSessionId: diag.sessionId,
            });
            return buildReplayRunListResult({
                entries: catalog.entries,
                issues: catalog.issues,
                params,
                currentHostSessionId: diag.sessionId,
                storeAvailable: this.diagnostics.storeActive || catalog.entries.length > 0,
            });
        });

        this.onRequest(DcReplayRunDetailRequest.type, async (params) => {
            const hostSessionId = params.hostSessionId ?? diag.sessionId;
            const itemsOffset = Math.max(0, params.itemsOffset ?? 0);
            const itemsLimit = clampReplayLabItemsLimit(params.itemsLimit);
            const durable = await readReplayRunDetail({
                storeRoot: this.diagnostics.store.storeRoot,
                hostSessionId,
                replayRunId: params.replayRunId,
                itemsOffset,
                itemsLimit,
            });
            // This console's live engine state (never created here — the Lab
            // page's provider brings the host up when the gate is on).
            const liveState =
                hostSessionId === diag.sessionId ? this.icDebugHost?.getReplayState() : undefined;
            const liveRun = liveState?.runs.find((run) => run.id === params.replayRunId);
            if (!durable.manifest && !liveRun) {
                return { found: false, items: [], itemsTotal: 0, itemsOffset };
            }
            const items = durable.items.map((record) =>
                projectDurableReplayItemRow(record, durable.manifest),
            );
            // Live queued/running rows append after the settled page (they
            // have no durable record yet).
            const liveItems = (liveState?.queueRows ?? [])
                .filter((row) => row.runId === params.replayRunId)
                .map(projectLiveReplayItemRow);
            const row = liveRun
                ? {
                      ...projectLiveReplayRunRow(liveRun),
                      ...(durable.manifest
                          ? {
                                hostSessionId,
                                sourceCount: durable.manifest.sources.length,
                                completedItems: durable.manifest.completedItems,
                                failedItems: durable.manifest.failedItems,
                                cancelledItems: durable.manifest.cancelledItems,
                                blockedItems: durable.manifest.blockedItems ?? 0,
                                durable: true,
                            }
                          : {}),
                  }
                : projectDurableReplayRunRow(
                      { hostSessionId, manifest: durable.manifest! },
                      diag.sessionId,
                  );
            return {
                found: true,
                row,
                ...(durable.manifest
                    ? {
                          sources: durable.manifest.sources.map((source) => ({
                              captureEventId: source.captureEventId,
                              label: source.label,
                          })),
                      }
                    : {}),
                ...(durable.configGroups
                    ? { configGroups: durable.configGroups.map(sanitizeReplayLabConfigGroup) }
                    : {}),
                items: [...items, ...liveItems],
                itemsTotal: durable.itemsTotal + liveItems.length,
                itemsOffset,
            };
        });

        // WI-4.2: per-run paired analysis — thin aggregates only, computed
        // host-side by the pure functions in inlineCompletionReplayAnalysis.
        // Token/output-presence stats exist only for items whose result
        // events THIS console can resolve from its live ring; everything
        // else is honest missingness (analysis.unresolvedResultStats).
        this.onRequest(DcReplayRunAnalysisRequest.type, async (params) => {
            const hostSessionId = params.hostSessionId ?? diag.sessionId;
            const durable = await readReplayRunDetail({
                storeRoot: this.diagnostics.store.storeRoot,
                hostSessionId,
                replayRunId: params.replayRunId,
                itemsOffset: 0,
                itemsLimit: REPLAY_ANALYSIS_MAX_ITEMS,
            });
            const liveState =
                hostSessionId === diag.sessionId ? this.icDebugHost?.getReplayState() : undefined;
            const liveRun = liveState?.runs.find((run) => run.id === params.replayRunId);
            if (!durable.manifest && !liveRun) {
                return { found: false };
            }
            const ringEvents =
                hostSessionId === diag.sessionId ? (this.icDebugHost?.getState().events ?? []) : [];
            const byRingId = new Map(ringEvents.map((event) => [event.id, event]));
            const byCaptureId = new Map(
                ringEvents
                    .filter((event) => event.link !== undefined)
                    .map((event) => [event.link!.captureEventId, event]),
            );
            const items = durable.items.map((record) =>
                buildReplayAnalysisItemInput(
                    record,
                    (record.resultEventId !== undefined
                        ? byRingId.get(record.resultEventId)
                        : undefined) ??
                        (record.resultCaptureEventId !== undefined
                            ? byCaptureId.get(record.resultCaptureEventId)
                            : undefined),
                ),
            );
            for (const row of liveState?.queueRows ?? []) {
                if (row.runId === params.replayRunId) {
                    items.push(buildLiveReplayAnalysisItemInput(row));
                }
            }
            const cells = durable.manifest
                ? durable.manifest.cells.map((cell) => ({
                      cellId: cell.matrixCellId,
                      label: cell.label,
                      ordinal: cell.ordinal,
                  }))
                : (liveRun?.matrixCells ?? []).map((cell) => ({
                      cellId: cell.cellId,
                      label: `${cell.profileLabel} x ${cell.schemaLabel}`,
                      ordinal: cell.ordinal,
                  }));
            return {
                found: true,
                analysis: computeReplayRunAnalysis({
                    cells,
                    sourceCaptureEventIds: (durable.manifest?.sources ?? []).map(
                        (source) => source.captureEventId,
                    ),
                    repetitions: durable.manifest?.repetitions ?? 1,
                    items,
                    ...(params.baselineCellId !== undefined
                        ? { baselineCellId: params.baselineCellId }
                        : {}),
                }),
            };
        });

        // Central observability upload (central design §8.3): preview is the
        // exact projection dry-run; upload streams the same item stream. Only
        // stored (closed/partial) sessions are uploadable in v1 (C-6) — the
        // live source and imported perf runs return actionable errors.
        this.onRequest(DcCentralPreviewRequest.type, async ({ sourceId, policyId }) => {
            const resolved = await this.resolveCentralUpload(sourceId, policyId);
            if ("error" in resolved) {
                return { target: resolved.targetInfo, error: resolved.error };
            }
            return {
                target: resolved.targetInfo,
                preview: toPreviewInfo(resolved.projection),
            };
        });

        this.onRequest(DcCentralUploadRequest.type, async ({ sourceId, policyId }) => {
            const resolved = await this.resolveCentralUpload(sourceId, policyId);
            if ("error" in resolved) {
                return { outcome: "notConfigured", error: resolved.error };
            }
            if (resolved.projection.preview.refused.length > 0) {
                return {
                    outcome: "refusedByPolicy",
                    reasonCode: resolved.projection.preview.refused[0]!.reason,
                };
            }
            const host = centralUploadHost()!;
            const service = new CentralUploadService(
                await SqlDataPlaneService.get().service(),
                resolved.target,
            );
            try {
                const result = await service.upload(resolved.projection, {
                    uploadPolicyId: resolved.projection.identity.uploadPolicyId as UploadPolicyId,
                    ...(host.maxItemBytes() !== undefined
                        ? { maxItemBytes: host.maxItemBytes() }
                        : {}),
                    principalAlias: host.principalAlias(),
                    toolVersion:
                        (vscode.extensions.getExtension("ms-mssql.mssql")?.packageJSON
                            ?.version as string) ?? "unknown",
                    onProgress: (done, total) => {
                        void this.sendNotification(DcCentralUploadProgressNotification.type, {
                            sourceId,
                            done,
                            total,
                        });
                    },
                });
                if (result.receipt) {
                    return {
                        outcome: result.receipt.outcome,
                        receipt: {
                            uploadBatchId: result.receipt.uploadBatchId,
                            outcome: result.receipt.outcome,
                            naturalKey: result.receipt.naturalKey,
                            policyId: result.receipt.uploadPolicyId,
                            totalRows: Object.values(result.receipt.rowsByItemKind).reduce(
                                (a, b) => a + b,
                                0,
                            ),
                            projectionDigest: result.receipt.projectionDigest,
                            ...(result.receipt.committedAtUtc
                                ? { committedAtUtc: result.receipt.committedAtUtc }
                                : {}),
                        },
                    };
                }
                return {
                    outcome: result.disposition.disposition,
                    ...(result.disposition.reasonCode
                        ? { reasonCode: result.disposition.reasonCode }
                        : {}),
                };
            } catch (error) {
                return { outcome: "failed", error: (error as Error).message };
            }
        });
    }

    /**
     * Lazily create the console-hosted Inline Completion Debug host. Only when
     * the feature gate is on and the inline-completion module configured its
     * dependencies (configureCompletionsDebugHost in mainController); returns
     * undefined otherwise so callers fall back to the empty default state.
     */
    private ensureIcDebugHost(): ConsoleCompletionsDebugHost | undefined {
        if (this.disposed) {
            return undefined;
        }
        if (!this.icDebugHost && isInlineCompletionFeatureEnabled()) {
            const host = createConsoleCompletionsDebugHost();
            if (host) {
                host.onDidChange(() => {
                    if (!this.disposed) {
                        void this.sendNotification(DcIcDebugChangedNotification.type, undefined);
                    }
                });
                // Typed sibling (WI-1.2): revision + changed domains on the
                // same throttle; the legacy void poke above keeps firing.
                host.onDidChange2((payload) => {
                    if (!this.disposed) {
                        void this.sendNotification(DcIcDebugChanged2Notification.type, payload);
                    }
                });
                this.icDebugHost = host;
            }
        }
        return this.icDebugHost;
    }

    /** Resolve target + source + projection for the central upload RPCs. */
    private async resolveCentralUpload(
        sourceId: string,
        policyId: string | undefined,
    ): Promise<
        | { targetInfo: CentralTargetInfo; error: string }
        | {
              targetInfo: CentralTargetInfo;
              target: CentralUploadTargetConfig;
              projection: CentralProjection;
          }
    > {
        const host = centralUploadHost();
        const effectivePolicy = (policyId ??
            host?.defaultPolicyId() ??
            "team-default.v1") as UploadPolicyId;
        const baseInfo: CentralTargetInfo = {
            enabled: host?.enabled() ?? false,
            configured: false,
            policyId: effectivePolicy,
        };
        if (!host) {
            return { targetInfo: baseInfo, error: "central upload host not configured" };
        }
        const resolution = await host.resolveTarget();
        if (!resolution.target) {
            return {
                targetInfo: { ...baseInfo, error: resolution.error ?? "not configured" },
                error: resolution.error ?? "central upload target not configured",
            };
        }
        const targetInfo: CentralTargetInfo = {
            ...baseInfo,
            configured: true,
            ...(resolution.profileLabel ? { profileLabel: resolution.profileLabel } : {}),
            ...(resolution.database ? { database: resolution.database } : {}),
        };
        if (!sourceId.startsWith("store:")) {
            return {
                targetInfo,
                error: "only stored sessions upload in v1 — close the live session first (perf runs: use `perftest push`)",
            };
        }
        const sessionId = sourceId.slice("store:".length);
        const sessionDir = path.join(this.diagnostics.store.storeRoot, "sessions", sessionId);
        try {
            const source = await loadDiagSessionSource(sessionDir);
            if (source.manifest.status === "active") {
                return {
                    targetInfo,
                    error: "session is still active — close it before uploading (C-6 v1 rule)",
                };
            }
            const projection = projectDiagSession(source, { uploadPolicyId: effectivePolicy });
            return { targetInfo, target: resolution.target, projection };
        } catch (error) {
            return { targetInfo, error: `cannot load session: ${(error as Error).message}` };
        }
    }
}

function toPreviewInfo(projection: CentralProjection): CentralPreviewInfo {
    const p = projection.preview;
    return {
        sourceKind: p.sourceKind,
        naturalKey: p.naturalKey,
        policyId: p.uploadPolicyId,
        tables: p.tables,
        dropped: p.dropped,
        digested: p.digested,
        refused: p.refused,
        warnings: p.warnings,
        sourceSummary: p.sourceSummary,
        projectionDigest: p.projectionDigest,
    };
}

let activeConsole: DebugConsoleWebviewController | undefined;

export function registerDebugConsole(
    context: vscode.ExtensionContext,
    diagnostics: DiagnosticsManager,
): void {
    context.subscriptions.push(
        // Optional deep-link arg (WI-1.6): `{ page }` opens the console AT
        // that page — a fresh console gets it as initial state, an open one
        // is steered via dc/navigate before being revealed.
        vscode.commands.registerCommand("mssql.openDebugConsole", (route?: { page?: DcPageId }) => {
            const page = route?.page;
            if (activeConsole && !activeConsole.disposed) {
                if (page !== undefined) {
                    void activeConsole.sendNotification(DcNavigateNotification.type, { page });
                }
                activeConsole.revealToForeground();
                return;
            }
            activeConsole = new DebugConsoleWebviewController(context, diagnostics, page);
            activeConsole.revealToForeground();
        }),
    );
}
