/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as Interfaces from "./interfaces";
import QueryRunner from "../controllers/queryRunner";
import ResultsSerializer from "../models/resultsSerializer";
import StatusView from "../views/statusView";
import VscodeWrapper from "./../controllers/vscodeWrapper";
import { ISelectionData, ISlickRange } from "./interfaces";
import { Deferred } from "../protocol";
import { ExecutionPlanOptions, ResultSetSubset, ResultSetSummary } from "./contracts/queryExecute";
import { sendActionEvent } from "../telemetry/telemetry";
import { QueryResultWebviewController } from "../queryResult/queryResultWebViewController";
import { IMessage, QueryResultPaneTabs } from "../sharedInterfaces/queryResult";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import * as qr from "../sharedInterfaces/queryResult";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import { ExecutionPlanService } from "../services/executionPlanService";
import { countResultSets, isOpenQueryResultsInTabByDefaultEnabled } from "../queryResult/utils";
import { ApiStatus, StateChangeNotification } from "../sharedInterfaces/webview";
// tslint:disable-next-line:no-require-imports
const pd = require("pretty-data").pd;

// holds information about the state of a query runner
export class QueryRunnerState {
    listeners: vscode.Disposable[];
    constructor(public queryRunner: QueryRunner) {
        this.listeners = [];
    }
}

class ResultsConfig implements Interfaces.IResultsConfig {
    shortcuts: { [key: string]: string };
    messagesDefaultOpen: boolean;
    resultsFontSize: number;
    resultsFontFamily: string;
}

export class SqlOutputContentProvider {
    private _queryResultsMap: Map<string, QueryRunnerState> = new Map<string, QueryRunnerState>();
    private _queryResultWebviewController: QueryResultWebviewController;
    private _actualPlanStatuses: string[] = [];
    // Throttle timers for state updates per result URI (messages, results, etc.)
    private _stateUpdateTimers: Map<string, NodeJS.Timeout> = new Map();

    constructor(
        private _context: vscode.ExtensionContext,
        private _statusView: StatusView,
        private _vscodeWrapper: VscodeWrapper,
        private _untitledSqlDocumentService: UntitledSqlDocumentService,
        private _executionPlanService: ExecutionPlanService,
    ) {
        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        /**
         * TODO: aaskhan
         * Remove query results management code from queryResultwebviewController so
         * we don't have to initialize it when open in new tab is enabled.
         */
        this._queryResultWebviewController = new QueryResultWebviewController(
            this._context,
            this._vscodeWrapper,
            this._executionPlanService,
            this._untitledSqlDocumentService,
            this,
        );

        this._context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                "queryResult",
                this._queryResultWebviewController,
            ),
        );

        /**
         * Command to copy all messages to clipboard for the active query result
         */
        this._context.subscriptions.push(
            vscode.commands.registerCommand(Constants.cmdCopyAll, async (context) => {
                const uri = context.uri;
                await this._queryResultWebviewController.copyAllMessagesToClipboard(uri);
            }),
        );

        /**
         * Command to enable the actual execution plan for the active query result
         */
        this._context.subscriptions.push(
            vscode.commands.registerCommand(Constants.cmdEnableActualPlan, async (context) => {
                this.onToggleActualPlan(true);
            }),
        );

        /**
         * Command to disable the actual execution plan for the active query result
         */
        this._context.subscriptions.push(
            vscode.commands.registerCommand(Constants.cmdDisableActualPlan, async (context) => {
                this.onToggleActualPlan(false);
            }),
        );

        /**
         * Command that reveals the query result
         */
        this._context.subscriptions.push(
            vscode.commands.registerCommand(Constants.cmdrevealQueryResult, (uri: vscode.Uri) => {
                this.revealQueryResult(uri.toString(true));
            }),
        );
    }

    public setQueryResultWebviewController(
        queryResultWebviewController: QueryResultWebviewController,
    ): void {
        this._queryResultWebviewController = queryResultWebviewController;
    }

    public rowRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        rowStart: number,
        numberOfRows: number,
    ): Promise<ResultSetSubset> {
        return this._queryResultsMap
            .get(uri)
            .queryRunner.getRows(rowStart, numberOfRows, batchId, resultId)
            .then((r) => r.resultSubset);
    }

    public configRequestHandler(uri: string): Promise<Interfaces.IResultsConfig> {
        let queryUri = this._queryResultsMap.get(uri).queryRunner.uri;
        let extConfig = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            queryUri,
        );
        let config = new ResultsConfig();
        for (let key in Constants.extConfigResultKeys) {
            config[key] = extConfig[key];
        }
        return Promise.resolve(config);
    }

    public saveResultsRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        format: string,
        selection: Interfaces.ISlickRange[],
    ): void {
        let saveResults = new ResultsSerializer();
        saveResults.onSaveResults(uri, batchId, resultId, format, selection);
    }

    public openLinkRequestHandler(content: string, columnName: string, linkType: string): void {
        this.openLink(content, columnName, linkType);
    }

    public copyHeadersRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        selection,
    ): void {
        void this._queryResultsMap.get(uri).queryRunner.copyHeaders(batchId, resultId, selection);
    }

    public copyRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        selection: Interfaces.ISlickRange[],
        includeHeaders?: boolean,
    ): void {
        void this._queryResultsMap
            .get(uri)
            .queryRunner.copyResults(selection, batchId, resultId, includeHeaders);
    }

    public sendToClipboard(
        uri: string,
        data: qr.DbCellValue[][],
        batchId: number,
        resultId: number,
        selection: ISlickRange[],
        headersFlag: boolean,
    ): void {
        void this._queryResultsMap
            .get(uri)
            .queryRunner.exportCellsToClipboard(data, batchId, resultId, selection, headersFlag);
    }

    public copyAsCsvRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        selection: Interfaces.ISlickRange[],
        includeHeaders?: boolean,
    ): void {
        void this._queryResultsMap
            .get(uri)
            .queryRunner.copyResultsAsCsv(selection, batchId, resultId, includeHeaders);
    }

    public copyAsJsonRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        selection: Interfaces.ISlickRange[],
        includeHeaders?: boolean,
    ): void {
        void this._queryResultsMap
            .get(uri)
            .queryRunner.copyResultsAsJson(selection, batchId, resultId, includeHeaders);
    }

    public editorSelectionRequestHandler(uri: string, selection: ISelectionData): void {
        void this._queryResultsMap.get(uri).queryRunner.setEditorSelection(selection);
    }

    public showErrorRequestHandler(message: string): void {
        this._vscodeWrapper.showErrorMessage(message);
    }

    public showWarningRequestHandler(message: string): void {
        this._vscodeWrapper.showWarningMessage(message);
    }

    // PUBLIC METHODS //////////////////////////////////////////////////////

    public isRunningQuery(uri: string): boolean {
        return !this._queryResultsMap.has(uri)
            ? false
            : this._queryResultsMap.get(uri).queryRunner.isExecutingQuery;
    }

    public async runQuery(
        statusView: StatusView,
        uri: string,
        selection: ISelectionData,
        title: string,
        executionPlanOptions?: ExecutionPlanOptions,
        promise?: Deferred<boolean>,
    ): Promise<void> {
        // execute the query with a query runner
        await this.runQueryCallback(
            statusView ? statusView : this._statusView,
            uri,
            title,
            async (queryRunner: QueryRunner) => {
                if (queryRunner) {
                    await queryRunner.runQuery(
                        selection,
                        {
                            includeActualExecutionPlanXml:
                                executionPlanOptions?.includeActualExecutionPlanXml ??
                                this._actualPlanStatuses.includes(uri),
                            includeEstimatedExecutionPlanXml:
                                executionPlanOptions?.includeEstimatedExecutionPlanXml ?? false,
                        },
                        promise,
                    );
                }
            },
            executionPlanOptions,
        );
    }

    public async runCurrentStatement(
        statusView: StatusView,
        uri: string,
        selection: ISelectionData,
        title: string,
    ): Promise<void> {
        // execute the statement with a query runner
        await this.runQueryCallback(
            statusView ? statusView : this._statusView,
            uri,
            title,
            async (queryRunner) => {
                if (queryRunner) {
                    await queryRunner.runStatement(selection.startLine, selection.startColumn);
                }
            },
        );
    }

    private async runQueryCallback(
        statusView: StatusView,
        uri: string,
        title: string,
        queryCallback: (queryRunner: QueryRunner) => Promise<void>,
        executionPlanOptions?: ExecutionPlanOptions,
    ): Promise<void> {
        let queryRunner = await this.createQueryRunner(
            statusView ? statusView : this._statusView,
            uri,
            title,
        );
        this._queryResultWebviewController.addQueryResultState(
            uri,
            title,
            executionPlanOptions?.includeEstimatedExecutionPlanXml ||
                this._actualPlanStatuses.includes(uri) ||
                executionPlanOptions?.includeActualExecutionPlanXml,
            this._actualPlanStatuses.includes(uri),
        );
        if (queryRunner) {
            void queryCallback(queryRunner);
        }
    }

    public createQueryRunner(statusView: StatusView, uri: string, title: string): QueryRunner {
        // Reuse existing query runner if it exists
        let queryRunner: QueryRunner;

        if (this._queryResultsMap.has(uri)) {
            let existingRunner: QueryRunner = this._queryResultsMap.get(uri).queryRunner;

            // If the query is already in progress, don't attempt to send it
            if (existingRunner.isExecutingQuery) {
                this._vscodeWrapper.showInformationMessage(
                    LocalizedConstants.msgRunQueryInProgress,
                );
                return;
            }

            // If the query is not in progress, we can reuse the query runner
            queryRunner = existingRunner;
            queryRunner.resetHasCompleted();
        } else {
            // We do not have a query runner for this editor, so create a new one
            // and map it to the results uri
            queryRunner = new QueryRunner(uri, title, statusView ? statusView : this._statusView);

            const startListener = queryRunner.onStart(async (_panelUri) => {
                const resultWebviewState = this._queryResultWebviewController.getQueryResultState(
                    queryRunner.uri,
                );
                resultWebviewState.tabStates.resultPaneTab = QueryResultPaneTabs.Messages;
                resultWebviewState.isExecutionPlan = false;
                if (isOpenQueryResultsInTabByDefaultEnabled()) {
                    await this._queryResultWebviewController.createPanelController(queryRunner.uri);
                }
                this.updateWebviewState(queryRunner.uri, resultWebviewState);
                sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.OpenQueryResult, {
                    defaultLocation: isOpenQueryResultsInTabByDefaultEnabled() ? "tab" : "pane",
                });
            });
            const resultSetAvailableListener = queryRunner.onResultSetAvailable(
                async (resultSet: ResultSetSummary) => {
                    const resultWebviewState =
                        this._queryResultWebviewController.getQueryResultState(queryRunner.uri);
                    const batchId = resultSet.batchId;
                    const resultId = resultSet.id;
                    if (!resultWebviewState.resultSetSummaries[batchId]) {
                        resultWebviewState.resultSetSummaries[batchId] = {};
                    }
                    resultWebviewState.resultSetSummaries[batchId][resultId] = resultSet;
                    // Switch to results tab for the first result set
                    if (countResultSets(resultWebviewState.resultSetSummaries) === 1) {
                        resultWebviewState.tabStates.resultPaneTab = QueryResultPaneTabs.Results;
                    }
                    this.updateWebviewState(queryRunner.uri, resultWebviewState);
                },
            );

            const resultSetUpdatedListener = queryRunner.onResultSetUpdated(
                async (resultSet: ResultSetSummary) => {
                    const resultWebviewState =
                        this._queryResultWebviewController.getQueryResultState(queryRunner.uri);
                    const batchId = resultSet.batchId;
                    const resultId = resultSet.id;
                    if (!resultWebviewState.resultSetSummaries[batchId]) {
                        resultWebviewState.resultSetSummaries[batchId] = {};
                    }
                    resultWebviewState.resultSetSummaries[batchId][resultId] = resultSet;
                    this.updateWebviewState(queryRunner.uri, resultWebviewState);
                },
            );

            const resultSetCompleteListener = queryRunner.onResultSetComplete(
                async (resultSet: ResultSetSummary) => {
                    const resultWebviewState =
                        this._queryResultWebviewController.getQueryResultState(queryRunner.uri);
                    const batchId = resultSet.batchId;
                    const resultId = resultSet.id;
                    if (!resultWebviewState.resultSetSummaries[batchId]) {
                        resultWebviewState.resultSetSummaries[batchId] = {};
                    }
                    resultWebviewState.resultSetSummaries[batchId][resultId] = resultSet;

                    this.updateWebviewState(queryRunner.uri, resultWebviewState);
                },
            );

            const batchStartListener = queryRunner.onBatchStart(async (batch) => {
                let time = new Date().toLocaleTimeString();
                if (batch.executionElapsed && batch.executionEnd) {
                    time = new Date(batch.executionStart).toLocaleTimeString();
                }

                // Build a message for the selection and send the message
                // from the webview
                let message: IMessage = {
                    message: LocalizedConstants.runQueryBatchStartMessage,
                    selection: batch.selection,
                    isError: false,
                    time: time,
                    link: {
                        text: LocalizedConstants.runQueryBatchStartLine(
                            batch.selection.startLine + 1,
                        ),
                        uri: queryRunner.uri,
                    },
                };

                const resultWebviewState = this._queryResultWebviewController.getQueryResultState(
                    queryRunner.uri,
                );
                resultWebviewState.messages.push(message);
                this.scheduleThrottledUpdate(queryRunner.uri);
            });
            const onMessageListener = queryRunner.onMessage(async (message) => {
                const resultWebviewState = this._queryResultWebviewController.getQueryResultState(
                    queryRunner.uri,
                );

                resultWebviewState.messages.push(message);

                this.scheduleThrottledUpdate(queryRunner.uri);
            });
            const onCompleteListener = queryRunner.onComplete(async (e) => {
                const { totalMilliseconds, hasError, isRefresh } = e;
                if (!isRefresh) {
                    // only update query history with new queries
                    this._vscodeWrapper.executeCommand(
                        Constants.cmdRefreshQueryHistory,
                        queryRunner.uri,
                        hasError,
                    );
                }

                const resultWebviewState = this._queryResultWebviewController.getQueryResultState(
                    queryRunner.uri,
                );
                resultWebviewState.messages.push({
                    message: LocalizedConstants.elapsedTimeLabel(totalMilliseconds),
                    isError: false, // Elapsed time messages are never displayed as errors
                });
                // if there is an error, show the error message and set the tab to the messages tab
                let tabState: QueryResultPaneTabs;
                if (hasError) {
                    tabState = QueryResultPaneTabs.Messages;
                } else {
                    if (resultWebviewState.isExecutionPlan) {
                        tabState = QueryResultPaneTabs.ExecutionPlan;
                    } else {
                        if (Object.keys(resultWebviewState.resultSetSummaries)?.length > 0) {
                            tabState = QueryResultPaneTabs.Results;
                        } else {
                            tabState = QueryResultPaneTabs.Messages;
                        }
                    }
                }
                resultWebviewState.tabStates.resultPaneTab = tabState;
                this.updateWebviewState(queryRunner.uri, resultWebviewState);
            });

            const onExecutionPlanListener = queryRunner.onExecutionPlan(async (e) => {
                const planGraphs = await this._executionPlanService.getExecutionPlan({
                    graphFileContent: e.xml,
                    graphFileType: "xml",
                });

                const resultWebviewState = this._queryResultWebviewController.getQueryResultState(
                    e.uri,
                );

                const existingGraphs = resultWebviewState.executionPlanState.executionPlanGraphs;
                existingGraphs.push(...planGraphs.graphs);

                const xmlPlans = resultWebviewState.executionPlanState.xmlPlans;
                xmlPlans[`${e.batchId},${e.resultId}`] = e.xml;

                resultWebviewState.isExecutionPlan = true;
                resultWebviewState.executionPlanState = {
                    errorMessage: planGraphs.errorMessage,
                    executionPlanGraphs: existingGraphs,
                    loadState: ApiStatus.Loaded,
                    totalCost: existingGraphs.reduce(
                        (acc, graph) => acc + graph.root.cost + graph.root.subTreeCost,
                        0,
                    ),
                    xmlPlans: xmlPlans,
                };

                this.updateWebviewState(queryRunner.uri, resultWebviewState);
            });

            const queryRunnerState = new QueryRunnerState(queryRunner);
            queryRunnerState.listeners.push(
                startListener,
                resultSetAvailableListener,
                resultSetUpdatedListener,
                resultSetCompleteListener,
                batchStartListener,
                onMessageListener,
                onCompleteListener,
                onExecutionPlanListener,
            );

            this._queryResultsMap.set(uri, queryRunnerState);
        }

        return queryRunner;
    }

    public cancelQuery(input: QueryRunner | string): void {
        let self = this;
        let queryRunner: QueryRunner;

        if (typeof input === "string") {
            if (this._queryResultsMap.has(input)) {
                // Option 1: The string is a results URI (the results tab has focus)
                queryRunner = this._queryResultsMap.get(input).queryRunner;
            }
        } else {
            queryRunner = input;
        }

        if (queryRunner === undefined || !queryRunner.isExecutingQuery) {
            self._vscodeWrapper.showInformationMessage(LocalizedConstants.msgCancelQueryNotRunning);
            return;
        }

        // Switch the spinner to canceling, which will be reset when the query execute sends back its completed event
        this._statusView.cancelingQuery(queryRunner.uri);

        // Cancel the query
        queryRunner.cancel().then(
            (_success) => undefined,
            (error) => {
                // On error, show error message
                self._vscodeWrapper.showErrorMessage(
                    LocalizedConstants.msgCancelQueryFailed(error.message),
                );
            },
        );
    }

    /**
     * Schedule a throttled state update for a given URI.
     * Coalesces rapid updates (messages/results) into a single update.
     */
    private scheduleThrottledUpdate(uri: string, delayMs: number = 100): void {
        if (this._stateUpdateTimers.has(uri)) {
            return; // already scheduled
        }
        const timer = setTimeout(() => {
            try {
                const state = this._queryResultWebviewController.getQueryResultState(uri);
                this.updateWebviewState(uri, state);
            } finally {
                this._stateUpdateTimers.delete(uri);
            }
        }, delayMs);
        this._stateUpdateTimers.set(uri, timer);
    }

    /**
     * Executed from the MainController when an untitled text document was saved to the disk. If
     * any queries were executed from the untitled document, the queryrunner will be remapped to
     * a new resuls uri based on the uri of the newly saved file.
     * @param untitledUri   The URI of the untitled file
     * @param savedUri  The URI of the file after it was saved
     */
    public onUntitledFileSaved(untitledUri: string, savedUri: string): void {
        // If we don't have any query runners mapped to this uri, don't do anything
        let untitledResultsUri = decodeURIComponent(untitledUri);
        if (!this._queryResultsMap.has(untitledResultsUri)) {
            return;
        }

        // NOTE: We don't need to remap the query in the service because the queryrunner still has
        // the old uri. As long as we make requests to the service against that uri, we'll be good.

        // Remap the query runner in the map
        let savedResultUri = decodeURIComponent(savedUri);
        this._queryResultsMap.set(savedResultUri, this._queryResultsMap.get(untitledResultsUri));
        this._queryResultsMap.delete(untitledResultsUri);
    }

    public async updateQueryRunnerUri(oldUri: string, newUri: string): Promise<void> {
        let queryRunner = this.getQueryRunner(oldUri);
        if (queryRunner) {
            queryRunner.updateQueryRunnerUri(oldUri, newUri);
        }

        let state = this._queryResultWebviewController.getQueryResultState(oldUri);
        if (state) {
            state.uri = newUri;
            /**
             * TODO: aaskhan
             * Remove adhoc state updates.
             */
            await this._queryResultWebviewController.sendNotification(
                StateChangeNotification.type<qr.QueryResultWebviewState>(),
                state,
            );
            //Update the URI in the query result webview state
            this._queryResultWebviewController.setQueryResultState(newUri, state);
            this._queryResultWebviewController.deleteQueryResultState(oldUri);
        }
    }

    /**
     * Executed from the MainController when a text document (that already exists on disk) was
     * closed. If the query is in progress, it will be canceled. If there is a query at all,
     * the query will be disposed.
     * @param doc   The document that was closed
     */
    public onDidCloseTextDocument(doc: vscode.TextDocument): void {
        const closedDocumentUri = doc.uri.toString(true);

        for (let [key, _value] of this._queryResultsMap.entries()) {
            if (closedDocumentUri === key) {
                /**
                 * If the result is in a webview view, immediately dispose the runner
                 * For panel results, we wait until the panel is closed to dispose the runner
                 */
                if (!this._queryResultWebviewController.hasPanel(key)) {
                    this.cleanupRunner(key);
                }
            }
        }

        if (this._actualPlanStatuses.includes(closedDocumentUri)) {
            this._actualPlanStatuses = this._actualPlanStatuses.filter(
                (uri) => uri !== closedDocumentUri,
            );
            this.updateActualPlanContext();
        }
    }

    /**
     * Updates the vscode context for the actual plan status.
     * this is used in the package.json to
     * know when to change the enabling/disabling icon
     */
    private updateActualPlanContext(): void {
        vscode.commands.executeCommand(
            "setContext",
            "mssql.executionPlan.urisWithActualPlanEnabled",
            this._actualPlanStatuses,
        );
    }

    public cleanupRunner(uri: string): void {
        let queryRunnerState = this._queryResultsMap.get(uri);
        if (queryRunnerState) {
            // Clear any pending throttled state update for this URI
            const timer = this._stateUpdateTimers.get(uri);
            if (timer) {
                clearTimeout(timer);
                this._stateUpdateTimers.delete(uri);
            }
            this._queryResultsMap.delete(uri);
            queryRunnerState.listeners?.forEach((listener) => listener.dispose());
            if (queryRunnerState.queryRunner.isExecutingQuery) {
                // We need to cancel it, which will dispose it
                this.cancelQuery(queryRunnerState.queryRunner);
            } else {
                // We need to explicitly dispose the query
                void queryRunnerState.queryRunner.dispose();
            }
        }
    }

    public onToggleActualPlan(isEnable: boolean): void {
        const uri = this._vscodeWrapper.activeTextEditorUri;
        let actualPlanStatuses = this._actualPlanStatuses;

        // adds the current uri to the list of uris with actual plan enabled
        // or removes the uri if the user is disabling it
        if (isEnable && !actualPlanStatuses.includes(uri)) {
            actualPlanStatuses.push(uri);
        } else {
            this._actualPlanStatuses = actualPlanStatuses.filter((statusUri) => statusUri != uri);
        }

        this.updateActualPlanContext();
    }

    /**
     * Open a xml/json link - Opens the content in a new editor pane
     */
    public openLink(content: string, columnName: string, linkType: string): void {
        const self = this;
        if (linkType === "xml") {
            try {
                content = pd.xml(content);
            } catch {
                // If Xml fails to parse, fall back on original Xml content
            }
        } else if (linkType === "json") {
            let jsonContent: string = undefined;
            try {
                jsonContent = JSON.parse(content);
            } catch {
                // If Json fails to parse, fall back on original Json content
            }
            if (jsonContent) {
                // If Json content was valid and parsed, pretty print content to a string
                content = JSON.stringify(jsonContent, undefined, 4);
            }
        }

        vscode.workspace.openTextDocument({ language: linkType }).then(
            (doc: vscode.TextDocument) => {
                vscode.window.showTextDocument(doc, 2, false).then(
                    (editor) => {
                        editor
                            .edit((edit) => {
                                edit.insert(new vscode.Position(0, 0), content);
                            })
                            .then((result) => {
                                if (!result) {
                                    self._vscodeWrapper.showErrorMessage(
                                        LocalizedConstants.msgCannotOpenContent,
                                    );
                                }
                            });
                    },
                    (error) => {
                        self._vscodeWrapper.showErrorMessage(error);
                    },
                );
            },
            (error) => {
                self._vscodeWrapper.showErrorMessage(error);
            },
        );
    }

    /**
     * Return the query for a file uri
     */
    public getQueryRunner(uri: string): QueryRunner {
        if (this._queryResultsMap.has(uri)) {
            return this._queryResultsMap.get(uri).queryRunner;
        } else {
            return undefined;
        }
    }

    /**
     * Reveals the results grid in either webview panel or webview view.
     * @param uri
     */
    public revealQueryResult(uri: string): void {
        const openInNewTabConfig = isOpenQueryResultsInTabByDefaultEnabled();

        if (openInNewTabConfig) {
            this._queryResultWebviewController.revealPanel(uri);
            return;
        }

        const isContainedInWebviewView =
            this._queryResultWebviewController.getQueryResultState(uri);
        if (isContainedInWebviewView && !this._queryResultWebviewController.hasPanel(uri)) {
            vscode.commands.executeCommand("queryResult.focus", {
                preserveFocus: true,
            });
        } else {
            this._queryResultWebviewController.revealPanel(uri);
        }
    }

    /**
     * Switches SQLCMD Mode to on/off
     * @param queryUri Uri of the query
     */
    public toggleSqlCmd(uri: string): Thenable<boolean> {
        const queryRunner = this.getQueryRunner(uri);
        if (queryRunner) {
            return queryRunner.toggleSqlCmd().then((result) => {
                return result;
            });
        }
        return Promise.resolve(false);
    }

    // PRIVATE HELPERS /////////////////////////////////////////////////////

    /**
     * Returns which column should be used for a new result pane
     * @return ViewColumn to be used
     * public for testing purposes
     */
    public newResultPaneViewColumn(queryUri: string): vscode.ViewColumn {
        // Find configuration options
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            queryUri,
        );
        let splitPaneSelection = config[Constants.configSplitPaneSelection];
        let viewColumn: vscode.ViewColumn;

        switch (splitPaneSelection) {
            case "current":
                viewColumn = this._vscodeWrapper.activeTextEditor.viewColumn;
                break;
            case "end":
                viewColumn = vscode.ViewColumn.Three;
                break;
            // default case where splitPaneSelection is next or anything else
            default:
                if (this._vscodeWrapper.activeTextEditor.viewColumn === vscode.ViewColumn.One) {
                    viewColumn = vscode.ViewColumn.Two;
                } else {
                    viewColumn = vscode.ViewColumn.Three;
                }
        }

        return viewColumn;
    }

    set setVscodeWrapper(wrapper: VscodeWrapper) {
        this._vscodeWrapper = wrapper;
    }

    get getResultsMap(): Map<string, QueryRunnerState> {
        return this._queryResultsMap;
    }

    set setResultsMap(setMap: Map<string, QueryRunnerState>) {
        this._queryResultsMap = setMap;
    }

    private updateWebviewState(uri: string, state: qr.QueryResultWebviewState): void {
        const activeEditorUri: string = vscode.window.activeTextEditor?.document.uri.toString(true);
        // Update the state in cache first.
        this._queryResultWebviewController.setQueryResultState(uri, state);
        // Set the state to the right webview.
        if (this._queryResultWebviewController.hasPanel(uri)) {
            this._queryResultWebviewController.updatePanelState(uri);
        } else {
            /**
             * If the user is working on some other editor, do not display the results
             * in the webview view.
             */
            if (activeEditorUri === uri) {
                this._queryResultWebviewController.state = state;
            }
        }

        /**
         * Only reveal the panel if user is working on the same editor
         */
        if (activeEditorUri === uri) {
            this.revealQueryResult(uri);
        }
    }
}
