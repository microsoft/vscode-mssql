/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio Replay Lab panel (design 04 §17.3, hardened by WI-3.6 §7.8):
 * the standalone webview over the SAFE Query Studio replay adapter
 * (qsReplayAdapter.ts). The adapter enforces the safety contract — parse-only
 * and estimated-plan replay with exact target binding (fingerprint match or
 * explicit selection, never the first live document), the WI-3.7 mutating
 * gate, a host-side confirmation modal for estimated-plan runs, and real
 * cancellation into the execution host. This controller owns only the panel
 * chrome: state projection, reducers, the vscode modal seam, and the durable
 * run repository wiring (same ReplayRunRepository the completions Lab uses,
 * so QS runs are cataloged and listed in the Debug Console Replay Lab).
 */

import * as path from "path";
import * as vscode from "vscode";
import { WebviewPanelController } from "../../controllers/webviewPanelController";
import { FeatureCaptureLease } from "../../diagnostics/featureCapture/captureStore";
import { FeatureReplayEngine } from "../../diagnostics/featureCapture/replayEngine";
import { ReplayRunRepository } from "../../diagnostics/featureCapture/replayRunRepository";
import {
    QsReplayConfig,
    QsReplayMatrixCell,
    QsRunRecord,
    QueryStudioReplayReducers,
    QueryStudioReplayWebviewState,
} from "../../sharedInterfaces/queryStudioReplay";
import { QueryStudioDocumentModel } from "../queryStudioDocumentModel";
import {
    qsRunCaptureStore,
    isElevatedCaptureActive,
    saveQsRunTraceNow,
    shouldCaptureQsRuns,
} from "./qsRunCapture";
import {
    createQsReplayHost,
    createQsReplayRunObserver,
    explicitQsTargetRef,
    liveTargetFingerprint,
} from "./qsReplayAdapter";
import { createQsReplayRunRepository } from "./qsReplayRunPersistence";

export class QueryStudioReplayController extends WebviewPanelController<
    QueryStudioReplayWebviewState,
    QueryStudioReplayReducers
> {
    private readonly _replayEngine: FeatureReplayEngine<
        QsRunRecord,
        QsReplayConfig,
        QsReplayMatrixCell
    >;
    private readonly _runRepository: ReplayRunRepository | undefined;
    private _lastError: string | undefined;
    private _selectedTargetUriKey: string | undefined;
    private readonly _viewerLease: FeatureCaptureLease;

    constructor(
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _listModels: () => QueryStudioDocumentModel[],
        /** §7.8.3 dialog seam — a vscode modal in the product, a fake in tests. */
        private readonly _confirmReadOnlyRun: (message: string) => Promise<boolean> = async (
            message,
        ) => {
            const proceed = "Run estimated-plan replay";
            const choice = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                proceed,
            );
            return choice === proceed;
        },
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

        this._replayEngine = new FeatureReplayEngine(
            createQsReplayHost({
                listTargets: () => this._listModels(),
                getSelectedTargetUriKey: () => this._selectedTargetUriKey,
                confirmReadOnlyRun: (message) => this._confirmReadOnlyRun(message),
                getLiveOverrides: () => qsRunCaptureStore.getOverrides(),
                onExecuteError: (message) => {
                    this._lastError = message;
                },
                onStateChanged: () => {
                    if (!this.isDisposed) {
                        this.updateState(this.createState());
                    }
                },
                isDisposed: () => this.isDisposed,
            }),
        );
        // Durable run persistence (WI-3.6): QS runs land in the same
        // ReplayRunRepository store the completions Lab uses, so they are
        // cataloged, listed via dc/replayRunList, and survive restarts.
        this._runRepository = createQsReplayRunRepository();
        if (this._runRepository) {
            this._replayEngine.setRunObserver(
                createQsReplayRunObserver(this._runRepository, {
                    setRunDurable: (runId, durable) =>
                        this._replayEngine.setRunDurable(runId, durable),
                    isDisposed: () => this.isDisposed,
                    getExplicitTarget: () =>
                        explicitQsTargetRef(this._listModels(), this._selectedTargetUriKey),
                }),
            );
        }

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
        void this._runRepository?.dispose();
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
            // §7.8.5: user-entered databases are explicit selections, and the
            // WI-3.7 preflight gate refuses any normal/actualPlan cell.
            this._replayEngine.runMatrix(cells);
            return this.createState();
        });
        this.registerReducer("cancelRun", (_state, payload) => {
            this._replayEngine.cancelRun(payload.runId);
            return this.createState();
        });
        this.registerReducer("selectReplayTarget", (_state, payload) => {
            this._selectedTargetUriKey = payload.uriKey ?? undefined;
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
        const models = this._listModels();
        // Fingerprints of the records currently on screen — a live target is
        // "matching" when at least one captured record binds to it (§7.8.2).
        const recordFingerprints = new Set(
            qsRunCaptureStore
                .getEvents()
                .map((record) => record.profileFingerprint)
                .filter((fingerprint): fingerprint is string => fingerprint !== undefined),
        );
        return {
            records: qsRunCaptureStore.getEvents().slice().reverse(),
            captureArmed: shouldCaptureQsRuns(),
            elevatedCapture: isElevatedCaptureActive(),
            liveTargets: models.map((model) => {
                const fingerprint = liveTargetFingerprint(model);
                return {
                    uriKey: model.uriKey,
                    fileName: path.basename(model.backingDocument?.fileName ?? model.uriKey),
                    connected: model.sessionBinding.activeSession !== undefined,
                    ...(fingerprint !== undefined
                        ? { matchesRecord: recordFingerprints.has(fingerprint) }
                        : {}),
                };
            }),
            ...(this._selectedTargetUriKey !== undefined
                ? { selectedTargetUriKey: this._selectedTargetUriKey }
                : {}),
            replay: this._replayEngine.getState(),
            ...(this._lastError ? { lastError: this._lastError } : {}),
        };
    }
}
