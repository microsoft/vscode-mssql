/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PinnedResultsController (C2D-3): per-panel controller for the pinned
 * results custom document. Answers the same result-pane RPCs live Query
 * Studio answers (`qs/getRows`, `qs/saveResult`, `qs/openCellDocument`,
 * `qs/openPlan`, `qs/getMessages*`) — but every read comes from the
 * snapshot through QueryResultAccessService, never a live ExecutionHost.
 * Coarse state carries frozen summaries only; the grid pulls bounded
 * windows exactly as the live pane does.
 */

import * as vscode from "vscode";
import { WebviewBaseController } from "../controllers/webviewBaseController";
import {
    QsCopyMessagesToClipboardRequest,
    QsGetMessagesRequest,
    QsGetRowsRequest,
    QsNavigateToLineRequest,
    QsOpenCellDocumentRequest,
    QsOpenPlanRequest,
    QsResultSetSummary,
    QsSaveResultRequest,
    QsSetViewModeRequest,
    QsUpdateGridSelectionRequest,
} from "../sharedInterfaces/queryStudio";
import {
    buildBoundedMessagesText,
    QUERY_STUDIO_MESSAGES_COPY_MAX_ROWS,
} from "../sharedInterfaces/queryStudioMessages";
import { PinnedResultsState } from "../sharedInterfaces/queryResultsSnapshot";
import { readGridStyle } from "../queryStudio/gridStyle";
import { cellDocumentText, prettyPrintCellText } from "../queryStudio/cellDocument";
import { saveQueryStudioResult } from "../queryStudio/resultExport";
import { resolveQueryTuning } from "../queryStudio/tuning/queryTuningResolver";
import { VectorWorkbenchService } from "./vector/vectorWorkbenchService";
import { SpatialSessionManager } from "./spatial/spatialSessionManager";
import {
    QsSpatialCancelRequest,
    QsSpatialCloseRequest,
    QsSpatialNextRequest,
    QsSpatialOpenRequest,
} from "../sharedInterfaces/spatialResults";
import { ingestBudgetFrom } from "./vector/vectorResultSource";
import {
    QsVectorCancelRequest,
    QsVectorCloseRequest,
    QsVectorCompareRequest,
    QsVectorFindingDetailRequest,
    QsVectorOpenRequest,
    QsVectorProfileRequest,
    QsVectorProjectionRequest,
} from "../sharedInterfaces/vectorWorkbench";
import { openExecutionPlanWebview } from "../controllers/sharedExecutionPlanUtils";
import { ExecutionPlanService } from "../services/executionPlanService";
import SqlDocumentService from "../controllers/sqlDocumentService";
import { getQueryResultAccessService } from "./queryResultAccessService";
import { getQueryResultContextService } from "./queryResultContextService";
import { PinnedQueryResultsDocument } from "./pinnedResultsDocumentProvider";
import { QueryResultSnapshotDescription } from "./queryResultTypes";
import {
    QueryStudioPanelViewState,
    QsGetPanelViewStateRequest,
    QsUpdatePanelViewStateNotification,
    createQueryStudioPanelViewState,
    normalizeQueryStudioPanelViewState,
} from "../sharedInterfaces/queryStudioViewState";

export class PinnedResultsController extends WebviewBaseController<PinnedResultsState, void> {
    readonly resultSetCount: number;
    /** Per-panel, memory-only state restored when VS Code recreates this webview. */
    private panelViewState: QueryStudioPanelViewState;

    constructor(
        context: vscode.ExtensionContext,
        private readonly panel: vscode.WebviewPanel,
        private readonly document: PinnedQueryResultsDocument,
    ) {
        const description = document.snapshotId
            ? getQueryResultAccessService().describeSnapshot(document.snapshotId)
            : undefined;
        super(
            context,
            "queryResultsSnapshot",
            PinnedResultsController.buildState(description),
            "queryResultsSnapshot",
        );
        this.panelViewState = createQueryStudioPanelViewState(
            document.snapshotId ?? document.uri.toString(),
        );
        this.resultSetCount = description?.resultSetCount ?? 0;
        this.panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)],
        };
        this.panel.webview.html = this._getHtmlTemplate();
        this.updateConnectionWebview(this.panel.webview);
        this.initializeBase();
        this.registerHandlers();
        this.registerDisposable(
            this.panel.onDidChangeViewState((event) => {
                if (!event.webviewPanel.visible) {
                    this.suspendVectorWorkbench();
                    this.suspendSpatialResults();
                }
            }),
        );
        this.state = PinnedResultsController.buildState(
            document.snapshotId
                ? getQueryResultAccessService().describeSnapshot(document.snapshotId)
                : undefined,
        );
    }

    private static buildState(
        description: QueryResultSnapshotDescription | undefined,
    ): PinnedResultsState {
        if (!description) {
            return {
                kind: "queryResultsSnapshot",
                expired: true,
                resultSets: [],
                totalRows: 0,
                messageCount: 0,
                errorCount: 0,
                hasLocalMessages: false,
            };
        }
        const resultSets: QsResultSetSummary[] = description.resultSets.map((set) => ({
            resultSetId: set.resultSetId,
            batchOrdinal: set.batchOrdinal ?? 0,
            columnNames: set.columnNames,
            ...(set.columns ? { columns: set.columns } : {}),
            rowCount: set.rowCount,
            complete: set.complete,
            ...(set.truncatedReason ? { truncatedReason: set.truncatedReason } : {}),
            ...(set.isPlanResult ? { isPlanResult: true } : {}),
        }));
        return {
            kind: "queryResultsSnapshot",
            expired: false,
            sourceTitle: description.source.sourceTitle,
            createdEpochMs: description.createdEpochMs,
            resultSets,
            totalRows: description.totalRows,
            messageCount: description.messages.count,
            errorCount: description.messages.errorCount,
            hasLocalMessages: description.hasLocalMessages,
            gridStyle: readGridStyle((key) => vscode.workspace.getConfiguration().get(key)),
            spatialBasemapEnabled:
                vscode.workspace
                    .getConfiguration()
                    .get<boolean>("mssql.queryStudio.spatial.basemap.enabled") === true,
        };
    }

    private get snapshotId(): string {
        return this.document.snapshotId ?? "";
    }

    /**
     * Pinned results are pure local content (VEC-5 P0): platform-enforced
     * zero-network CSP. (Query Studio adopts after the Monaco-worker path is
     * validated under CSP by the live perf scenarios.)
     */
    protected override cspOptions(): { enabled: boolean; allowWorker?: boolean } {
        return { enabled: true, allowWorker: true };
    }

    /** Vector Workbench over the FROZEN snapshot (VEC-11) — lazy, like live QS. */
    private vectorService: VectorWorkbenchService | undefined;
    private spatialService: SpatialSessionManager | undefined;

    private vectorWorkbench(): VectorWorkbenchService {
        if (!this.vectorService) {
            this.vectorService = new VectorWorkbenchService(() => resolveQueryTuning().params);
            this.registerDisposable(this.vectorService);
        }
        return this.vectorService;
    }

    private suspendVectorWorkbench(): void {
        this.vectorService?.dispose();
        this.vectorService = undefined;
    }

    private spatialResults(): SpatialSessionManager {
        if (!this.spatialService) {
            this.spatialService = new SpatialSessionManager();
            this.registerDisposable(this.spatialService);
        }
        return this.spatialService;
    }

    private suspendSpatialResults(): void {
        this.spatialService?.dispose();
        this.spatialService = undefined;
    }

    private summaryFor(resultSetId: string): QsResultSetSummary | undefined {
        return this.state.resultSets.find((set) => set.resultSetId === resultSetId);
    }

    private registerHandlers(): void {
        const service = getQueryResultAccessService();
        this.onRequest(QsGetPanelViewStateRequest.type, async () => this.panelViewState);
        this.onNotification(QsUpdatePanelViewStateNotification.type, (next) => {
            // The snapshot identity is the generation boundary: callbacks from
            // a stale renderer must not overwrite this panel's current state.
            const normalized = normalizeQueryStudioPanelViewState(
                next,
                this.panelViewState.generation,
            );
            if (normalized) {
                this.panelViewState = normalized;
            }
        });

        // Vector Workbench parity (VEC-11): Profile/Compare/Projection analyze
        // the frozen snapshot exactly like the live pane (local computation
        // only); derived/transformed snapshots refuse honestly — their rows
        // would misattribute result ordinals. Live-session workspaces
        // (Search/Index/Pipeline) stay locked in the pinned UI.
        this.onRequest(QsVectorOpenRequest.type, async (params) => {
            const snapshot = service.storeForSnapshot(this.snapshotId);
            if (snapshot?.derived) {
                return {
                    handle: "",
                    generation: 0,
                    transport: "textFallback" as const,
                    totalRows: 0,
                    effectiveBudget: ingestBudgetFrom(resolveQueryTuning().params),
                    error: "Transformed snapshots cannot be analyzed — pin the original result set instead.",
                };
            }
            return this.vectorWorkbench().open(snapshot?.store, params);
        });
        this.onRequest(QsVectorProfileRequest.type, async ({ handle }) =>
            this.vectorWorkbench().profile(handle),
        );
        this.onRequest(QsVectorFindingDetailRequest.type, async ({ handle, kind }) =>
            this.vectorWorkbench().findingDetail(handle, kind),
        );
        this.onRequest(QsVectorCompareRequest.type, async ({ handle, ordinals }) =>
            this.vectorWorkbench().compare(handle, ordinals),
        );
        this.onRequest(QsVectorProjectionRequest.type, async ({ handle }) =>
            this.vectorWorkbench().projection(handle),
        );
        this.onRequest(QsVectorCancelRequest.type, async ({ handle }) => {
            this.vectorService?.cancel(handle);
        });
        this.onRequest(QsVectorCloseRequest.type, async ({ handle }) => {
            this.vectorService?.close(handle);
        });
        this.onRequest(QsSpatialOpenRequest.type, async (params) => {
            const snapshot = service.storeForSnapshot(this.snapshotId);
            if (snapshot?.derived) {
                return {
                    handle: "",
                    generation: 0,
                    totalRows: 0,
                    chunkRows: 512,
                    error: "Transformed snapshots cannot be mapped — pin the original result set instead.",
                };
            }
            return this.spatialResults().open(snapshot?.store, params);
        });
        this.onRequest(QsSpatialNextRequest.type, async (params) =>
            this.spatialResults().next(params),
        );
        this.onRequest(QsSpatialCancelRequest.type, async ({ handle, generation }) => {
            this.spatialService?.cancel(handle, generation);
        });
        this.onRequest(QsSpatialCloseRequest.type, async ({ handle }) => {
            this.spatialService?.close(handle);
        });
        this.onRequest(QsGetRowsRequest.type, async (params) => {
            const reason =
                params.purpose === "copy"
                    ? "copy"
                    : params.purpose === "text"
                      ? "text"
                      : "gridPreview";
            return service.getWindow({
                snapshotId: this.snapshotId,
                resultSetId: params.resultSetId,
                rowStart: params.start,
                rowCount: params.count,
                ...(params.columnStart !== undefined && params.columnCount !== undefined
                    ? { columnStart: params.columnStart, columnCount: params.columnCount }
                    : {}),
                reason,
            });
        });
        this.onRequest(QsSaveResultRequest.type, async ({ resultSetId, format, selection }) => {
            const summary = this.summaryFor(resultSetId);
            if (!summary) {
                return { saved: false, error: "Result set not found in this snapshot." };
            }
            return saveQueryStudioResult({
                sourceUri: this.document.uri,
                summary,
                format,
                selection,
                getRows: (id, start, count) =>
                    service.getWindow({
                        snapshotId: this.snapshotId,
                        resultSetId: id,
                        rowStart: start,
                        rowCount: count,
                        reason: "export",
                    }),
            });
        });
        this.onRequest(
            QsOpenCellDocumentRequest.type,
            async ({ resultSetId, row, column, format }) => {
                try {
                    const window = await service.getWindow({
                        snapshotId: this.snapshotId,
                        resultSetId,
                        rowStart: row,
                        rowCount: 1,
                        reason: "cellDocument",
                    });
                    const value = window.values[0]?.[column];
                    if (value === undefined || value === null) {
                        return { opened: false };
                    }
                    const raw = cellDocumentText(value);
                    const formatLimit = resolveQueryTuning().params.cellDocumentFormatLimit;
                    const content =
                        format === "text" || raw.length > formatLimit
                            ? raw
                            : prettyPrintCellText(raw, format);
                    const doc = await vscode.workspace.openTextDocument({
                        language: format === "text" ? "plaintext" : format,
                        content,
                    });
                    await vscode.window.showTextDocument(doc, {
                        preview: true,
                        viewColumn: vscode.ViewColumn.Beside,
                    });
                    return { opened: true };
                } catch {
                    return { opened: false };
                }
            },
        );
        this.onRequest(QsOpenPlanRequest.type, async ({ resultSetId }) => {
            try {
                const summary = this.summaryFor(resultSetId);
                if (!summary?.isPlanResult) {
                    return { opened: false };
                }
                const window = await service.getWindow({
                    snapshotId: this.snapshotId,
                    resultSetId,
                    rowStart: 0,
                    rowCount: 1,
                    reason: "cellDocument",
                });
                const value = window.values[0]?.[0];
                if (value === undefined || value === null) {
                    return { opened: false };
                }
                const seam = (await vscode.commands.executeCommand(
                    "mssql.getControllerForTests",
                )) as
                    | {
                          context?: vscode.ExtensionContext;
                          executionPlanService?: ExecutionPlanService;
                          sqlDocumentService?: SqlDocumentService;
                      }
                    | undefined;
                if (!seam?.executionPlanService || !seam.sqlDocumentService) {
                    return { opened: false };
                }
                openExecutionPlanWebview(
                    seam.context ?? this._context,
                    seam.executionPlanService,
                    seam.sqlDocumentService,
                    cellDocumentText(value),
                    `${this.state.sourceTitle ?? "Pinned results"} plan`,
                );
                return { opened: true };
            } catch {
                return { opened: false };
            }
        });
        this.onRequest(QsGetMessagesRequest.type, async (params) => {
            const afterIndex = (params as { afterIndex?: number })?.afterIndex ?? 0;
            const window = await service.getSnapshotMessages(
                this.snapshotId,
                afterIndex,
                Math.max(0, this.state.messageCount - afterIndex),
            );
            return window;
        });
        this.onRequest(QsCopyMessagesToClipboardRequest.type, async () => {
            if (this.state.messageCount > QUERY_STUDIO_MESSAGES_COPY_MAX_ROWS) {
                return {
                    outcome: "tooLarge" as const,
                    messages: this.state.messageCount,
                    characters: 0,
                    buildMs: 0,
                    clipboardMs: 0,
                    reason: "messages" as const,
                };
            }
            const builtAt = performance.now();
            const window = await service.getSnapshotMessages(
                this.snapshotId,
                0,
                this.state.messageCount,
            );
            const built = buildBoundedMessagesText(window.messages);
            const buildMs = Math.max(0, performance.now() - builtAt);
            if (built.kind !== "copied") {
                return {
                    outcome: built.kind,
                    messages: built.messages,
                    characters: built.characters,
                    buildMs,
                    clipboardMs: 0,
                    ...(built.kind === "tooLarge" ? { reason: built.reason } : {}),
                };
            }
            const clipboardStarted = performance.now();
            await vscode.env.clipboard.writeText(built.text);
            return {
                outcome: "copied" as const,
                messages: built.messages,
                characters: built.characters,
                buildMs,
                clipboardMs: Math.max(0, performance.now() - clipboardStarted),
            };
        });
        this.onRequest(QsUpdateGridSelectionRequest.type, async (update) => {
            getQueryResultContextService().updateFromPinnedDocument(this.snapshotId, {
                ...update,
                snapshotView: { snapshotId: this.snapshotId },
            });
        });
        // Result-pane requests with no pinned-document meaning: honest no-ops.
        this.onRequest(QsNavigateToLineRequest.type, async () => undefined);
        this.onRequest(QsSetViewModeRequest.type, async () => undefined);
    }

    protected _getWebview(): vscode.Webview {
        return this.panel.webview;
    }
}
