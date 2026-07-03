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
import { importPerfMetrics, importPerfRun } from "../diagnostics/perfRunImport";
import { LiveTailSink } from "../diagnostics/sinks";
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

        this.registerHandlers();
        diag.emit({ feature: "sessionDiag", type: "debugConsole.opened" });
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
            if (request.mode === "full") {
                diag.setCaptureMode("full", {
                    reason: request.reason ?? "elevated from Debug Console",
                    durationMs: (request.durationMinutes ?? 15) * 60_000,
                });
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
            } else if (request.mode === "off") {
                await vscode.workspace
                    .getConfiguration()
                    .update("mssql.sessionDiag.enabled", false, vscode.ConfigurationTarget.Global);
            } else {
                await vscode.workspace
                    .getConfiguration()
                    .update("mssql.sessionDiag.enabled", true, vscode.ConfigurationTarget.Global);
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        "mssql.sessionDiag.captureMode",
                        request.mode,
                        vscode.ConfigurationTarget.Global,
                    );
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
            const samples = root ? importPerfMetrics(root) : [];
            return {
                scenarios: [...new Set(samples.map((s) => s.scenarioId))].sort(),
                metrics: [...new Set(samples.map((s) => s.metricName))].sort(),
                samples,
            };
        });

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
