/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio Replay Lab (design 04 §17.3): the second production
 * instantiation of the generic feature-replay engine. Replays captured
 * QsRunRecords through the SQL Data Plane's normal API (the live document's
 * ExecutionHost) with config overrides (database / mode / stopOnError),
 * sequential and matrix runs, and Trace Identity replay tags.
 *
 * Honesty rules: records captured WITHOUT elevated capture carry no SQL
 * text and are refused at replay time (the row fails with the reason);
 * replays need a live Query Studio document — preferring one whose URI
 * digest matches the record.
 */

import * as path from "path";
import * as vscode from "vscode";
import { WebviewPanelController } from "../../controllers/webviewPanelController";
import { diag } from "../../diagnostics/diagnosticsCore";
import { FeatureCaptureLease } from "../../diagnostics/featureCapture/captureStore";
import { digestValue } from "../../diagnostics/redaction";
import {
    FeatureReplayEngine,
    FeatureReplayHost,
} from "../../diagnostics/featureCapture/replayEngine";
import { logger2 } from "../../models/logger2";
import { FeatureReplayTags } from "../../sharedInterfaces/featureReplay";
import { queryTuningParamsToOverrides } from "../../sharedInterfaces/queryTuning";
import {
    QsReplayConfig,
    QsReplayMatrixCell,
    QsRunRecord,
    QueryStudioReplayReducers,
    QueryStudioReplayWebviewState,
} from "../../sharedInterfaces/queryStudioReplay";
import { QueryStudioDocumentModel } from "../queryStudioDocumentModel";
import {
    isElevatedCaptureActive,
    qsRunCaptureStore,
    saveQsRunTraceNow,
    shouldCaptureQsRuns,
} from "./qsRunCapture";

export class QueryStudioReplayController extends WebviewPanelController<
    QueryStudioReplayWebviewState,
    QueryStudioReplayReducers
> {
    private readonly _logger = logger2.withPrefix("QueryStudioReplay");
    private readonly _replayEngine: FeatureReplayEngine<
        QsRunRecord,
        QsReplayConfig,
        QsReplayMatrixCell
    > = new FeatureReplayEngine(this.createReplayHost());
    private _lastError: string | undefined;
    private readonly _viewerLease: FeatureCaptureLease;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _listModels: () => QueryStudioDocumentModel[],
    ) {
        super(
            _extensionContext,
            "queryStudioReplay",
            "queryStudioReplay",
            {
                records: [],
                captureArmed: false,
                elevatedCapture: false,
                liveTargets: [],
                replay: {
                    cart: [],
                    runs: [],
                    queueRows: [],
                    builderOpen: false,
                },
            },
            {
                title: "Query Studio Replay Lab",
                viewColumn: vscode.ViewColumn.Active,
                showRestorePromptAfterClose: false,
            },
        );

        this._viewerLease = qsRunCaptureStore.acquireViewer("queryStudio.replayLab");
        this.registerDisposable(
            qsRunCaptureStore.onDidChange(() => {
                if (!this.isDisposed) {
                    this.updateState(this.createState());
                }
            }),
        );
        this.registerReducers();
        this.updateState(this.createState());
    }

    public override dispose(): void {
        this._replayEngine.dispose();
        this._viewerLease.dispose();
        super.dispose();
    }

    private registerReducers(): void {
        this.registerReducer("refresh", () => this.createState());
        this.registerReducer("clearRecords", () => {
            qsRunCaptureStore.clearEvents();
            return this.createState();
        });
        this.registerReducer("addToCart", (_state, payload) => {
            const records = payload.recordIds
                .map((recordId) => qsRunCaptureStore.getEvent(recordId))
                .filter((record): record is QsRunRecord => record !== undefined)
                .map((record) => ({ event: record }));
            this._replayEngine.addToCart(records);
            return this.createState();
        });
        this.registerReducer("removeFromCart", (_state, payload) => {
            this._replayEngine.removeFromCart(payload.snapshotId);
            return this.createState();
        });
        this.registerReducer("clearCart", () => {
            this._replayEngine.clearCart();
            return this.createState();
        });
        this.registerReducer("setCartOverride", (_state, payload) => {
            this._replayEngine.updateCartSnapshot(payload.snapshotId, {
                override: payload.override,
                configMode: payload.override ? "override" : "snapshot",
            });
            return this.createState();
        });
        this.registerReducer("queueCart", (_state, payload) => {
            this._lastError = undefined;
            this._replayEngine.queueCart(payload.configMode);
            return this.createState();
        });
        this.registerReducer("runMatrix", (_state, payload) => {
            this._lastError = undefined;
            const databases = payload.databases.filter((database) => database.trim().length > 0);
            const modes = payload.modes;
            const cells: QsReplayMatrixCell[] = [];
            const databaseAxis = databases.length > 0 ? databases : [undefined];
            const modeAxis = modes.length > 0 ? modes : [undefined];
            for (const database of databaseAxis) {
                for (const mode of modeAxis) {
                    if (database === undefined && mode === undefined) {
                        continue;
                    }
                    cells.push({
                        cellId: `cell-${cells.length + 1}`,
                        ordinal: cells.length + 1,
                        ...(database !== undefined ? { database } : {}),
                        ...(mode !== undefined ? { mode } : {}),
                        label: `${database ?? "record db"} x ${mode ?? "record mode"}`,
                    });
                }
            }
            this._replayEngine.runMatrix(cells);
            return this.createState();
        });
        this.registerReducer("cancelRun", (_state, payload) => {
            this._replayEngine.cancelRun(payload.runId);
            return this.createState();
        });
        this.registerReducer("saveTraceNow", async () => {
            const result = await saveQsRunTraceNow(this._extensionContext);
            if (result.error) {
                this._lastError = result.error;
            } else if (result.filePath) {
                void vscode.window.showInformationMessage(
                    `Query Studio run trace saved to ${result.filePath}`,
                );
            }
            return this.createState();
        });
    }

    private createState(): QueryStudioReplayWebviewState {
        return {
            records: qsRunCaptureStore.getEvents().slice().reverse(),
            captureArmed: shouldCaptureQsRuns(),
            elevatedCapture: isElevatedCaptureActive(),
            liveTargets: this._listModels().map((model) => ({
                uriKey: model.uriKey,
                fileName: path.basename(model.backingDocument?.fileName ?? model.uriKey),
                connected: model.sessionBinding.activeSession !== undefined,
            })),
            replay: this._replayEngine.getState(),
            ...(this._lastError ? { lastError: this._lastError } : {}),
        };
    }

    private createReplayHost(): FeatureReplayHost<QsRunRecord, QsReplayConfig, QsReplayMatrixCell> {
        return {
            feature: "queryStudio",
            isRunnable: (record) => record.result !== "pending" && record.result !== "queued",
            captureConfig: (record) => ({
                database: record.database ?? null,
                mode: record.mode,
                stopOnError: null,
                // Snapshot mode replays with the CAPTURED tuning params (QO-1)
                // so a faithful replay reproduces the run's parameter set.
                tuning: record.tuning ? queryTuningParamsToOverrides(record.tuning) : null,
            }),
            resolveLiveConfig: () => qsRunCaptureStore.getOverrides(),
            compactConfig: (config) => ({
                database: config.database ?? null,
                mode: config.mode ?? null,
                stopOnError: config.stopOnError ?? null,
                tuning: config.tuning ?? null,
            }),
            compactPartialConfig: (partial) => ({ ...(partial ?? {}) }),
            resolveMatrixCellConfig: (cell) => ({
                ...qsRunCaptureStore.getOverrides(),
                database: cell.database ?? null,
                mode: cell.mode ?? null,
                // Tuning axis for parameter-sweep experiments (QO-1).
                ...(cell.tuning ? { tuning: cell.tuning } : {}),
            }),
            formatCellLabel: (cell) => cell.label,
            formatSourceLabel: (record) =>
                `${record.database ?? "unknown db"} · ${new Date(record.timestamp).toLocaleTimeString()}`,
            createQueuedEvent: (snapshot) => ({
                ...snapshot.event,
                result: "queued",
            }),
            markEventRunning: (record, startedAt) => ({
                ...record,
                timestamp: startedAt,
                result: "pending",
            }),
            execute: (record, config, tags) => this.replayRunRecord(record, config, tags),
            onStateChanged: () => {
                if (!this.isDisposed) {
                    this.updateState(this.createState());
                }
            },
            isDisposed: () => this.isDisposed,
        };
    }

    /** Re-drive one captured run through the live document's execution host. */
    private async replayRunRecord(
        record: QsRunRecord,
        config: QsReplayConfig,
        tags: FeatureReplayTags,
    ): Promise<void> {
        try {
            if (!record.scriptText) {
                throw new Error(
                    "record has no SQL text — captured without elevated capture (digest-only)",
                );
            }
            const target = this.pickTarget(record);
            if (!target) {
                throw new Error("no live Query Studio document to replay against");
            }
            if (!target.sessionBinding.activeSession) {
                throw new Error(`replay target ${target.uriKey} is not connected`);
            }
            if (config.database && config.database !== record.database) {
                const changed = await target.executionHost.setDatabase(config.database);
                if (!changed) {
                    throw new Error(`could not switch replay database to ${config.database}`);
                }
            }
            const outcome = target.executionHost.execute(record.scriptText, {
                selectionStartLine: 0,
                scope: record.scope,
                mode: config.mode ?? record.mode,
                ...(config.tuning ? { tuningOverrides: config.tuning } : {}),
                replayTags: tags,
            });
            if (!outcome.started) {
                throw new Error(outcome.reason ?? "replay execution refused");
            }
            await this.waitForRunCompletion(target);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this._lastError = `Replay of ${record.id} failed: ${message}`;
            this._logger.warn(this._lastError);
            diag.emit({
                feature: "queryStudio",
                kind: "event",
                type: "queryStudio.runRecord.captured",
                status: "warning",
                fields: {
                    batches: { raw: record.batches.length, cls: "diagnostic.metadata" },
                    elevated: { raw: record.elevated, cls: "diagnostic.metadata" },
                    replay: { raw: true, cls: "diagnostic.metadata" },
                    refused: { raw: true, cls: "diagnostic.metadata" },
                },
            });
            throw error;
        }
    }

    private pickTarget(record: QsRunRecord): QueryStudioDocumentModel | undefined {
        const models = this._listModels();
        return (
            models.find((model) => digestValue("uri", model.uriKey) === record.documentUriDigest) ??
            models[0]
        );
    }

    private waitForRunCompletion(target: QueryStudioDocumentModel): Promise<void> {
        return new Promise<void>((resolve) => {
            const check = () => {
                const kind = target.executionHost.executionState.kind;
                return kind !== "executing" && kind !== "cancelRequested";
            };
            if (check()) {
                resolve();
                return;
            }
            const subscription = target.executionHost.attach({
                onResultSetStarted: () => undefined,
                onRowsAppended: () => undefined,
                onResultSetEnded: () => undefined,
                onMessages: () => undefined,
                onExecutionStateChanged: () => {
                    if (check()) {
                        subscription.dispose();
                        resolve();
                    }
                },
            });
        });
    }
}
