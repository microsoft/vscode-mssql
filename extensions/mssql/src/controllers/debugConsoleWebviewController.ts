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
    HistorySessionRow,
    DebugConsoleState,
    DebugSource,
    DcCaptureChangedNotification,
    DcExportRequest,
    DcGetCauseTreeRequest,
    DcGetOverviewRequest,
    DcGetPerfSummaryRequest,
    DcGetSqlActivityRequest,
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
    DcCancelSelfTestRequest,
    DcSelfTestProgressNotification,
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
import { diag } from "../diagnostics/diagnosticsCore";
import { DiagnosticsManager } from "../diagnostics/diagnosticsManager";
import { PerfHistoryService } from "../diagnostics/perfHistory/perfHistoryService";
import { importPerfMetrics, importPerfRun } from "../diagnostics/perfRunImport";
import { SelfTestService } from "../diagnostics/selfTest/selfTestService";
import { LiveTailSink } from "../diagnostics/sinks";
import {
    PhAddSourceRequest,
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
    public disposed = false;

    constructor(
        context: vscode.ExtensionContext,
        private readonly diagnostics: DiagnosticsManager,
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
        this.liveTail = new LiveTailSink();
        diag.addSink(this.liveTail);
        this.panel.onDidDispose(() => {
            this.disposed = true;
            diag.removeSink(this.liveTail.id);
            diag.removeSink(archiveSinkId);
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
    }

    private get liveSourceId(): string {
        return `live:${diag.sessionId}`;
    }

    private eventsFor(sourceId: string): DiagEvent[] {
        return this.diagnostics.store.eventsForSource(sourceId, this.liveArchive);
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
            const analyze = (
                sourceId: string,
                label: string,
                createdUtc: string,
                live: boolean,
                captureMode: HistorySessionRow["captureMode"],
                events: DiagEvent[],
                gaps: number,
            ) => {
                const actions = userActions(events);
                const errors = events.filter((e) => e.status === "error").length;
                sessions.push({
                    sourceId,
                    label,
                    createdUtc,
                    live,
                    events: events.length,
                    errors,
                    gaps,
                    captureMode,
                    actionCount: actions.length,
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
                    `Session ${manifest.createdUtc.slice(0, 16).replace("T", " ")}`,
                    manifest.createdUtc,
                    false,
                    manifest.captureMode,
                    this.diagnostics.store.eventsForSource(sourceId),
                    manifest.gapCount,
                );
            }
            analyze(
                this.liveSourceId,
                "Current session",
                new Date().toISOString(),
                true,
                diag.captureMode,
                this.liveArchive,
                this.liveGaps.length,
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
    }
}

let activeConsole: DebugConsoleWebviewController | undefined;

export function registerDebugConsole(
    context: vscode.ExtensionContext,
    diagnostics: DiagnosticsManager,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.openDebugConsole", () => {
            if (activeConsole && !activeConsole.disposed) {
                activeConsole.revealToForeground();
                return;
            }
            activeConsole = new DebugConsoleWebviewController(context, diagnostics);
            activeConsole.revealToForeground();
        }),
    );
}
