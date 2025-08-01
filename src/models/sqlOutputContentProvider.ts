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
// tslint:disable-next-line:no-require-imports
const pd = require("pretty-data").pd;

const deletionTimeoutTime = 1.8e6; // in ms, currently 30 minutes
const MESSAGE_INTERVAL_IN_MS = 300;

// holds information about the state of a query runner
export class QueryRunnerState {
    timeout: NodeJS.Timer;
    flaggedForDeletion: boolean;
    constructor(public queryRunner: QueryRunner) {
        this.flaggedForDeletion = false;
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
    private _executionPlanOptions: ExecutionPlanOptions = {};
    private _lastSendMessageTime: number;

    constructor(
        private _statusView: StatusView,
        private _vscodeWrapper: VscodeWrapper,
    ) {
        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
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

    public copyAsInsertRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        selection: Interfaces.ISlickRange[],
        tableName?: string,
    ): void {
        void this._queryResultsMap
            .get(uri)
            .queryRunner.copyAsInsert(selection, batchId, resultId, tableName);
    }

    public copyAsUpdateRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        selection: Interfaces.ISlickRange[],
        tableName?: string,
    ): void {
        void this._queryResultsMap
            .get(uri)
            .queryRunner.copyAsUpdate(selection, batchId, resultId, tableName);
    }

    public copyAsDeleteRequestHandler(
        uri: string,
        batchId: number,
        resultId: number,
        selection: Interfaces.ISlickRange[],
        tableName?: string,
    ): void {
        void this._queryResultsMap
            .get(uri)
            .queryRunner.copyAsDelete(selection, batchId, resultId, tableName);
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
                    await queryRunner.runQuery(selection, executionPlanOptions, promise);
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

    private get isOpenQueryResultsInTabByDefaultEnabled(): boolean {
        return this._vscodeWrapper
            .getConfiguration()
            .get(Constants.configOpenQueryResultsInTabByDefault);
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
        if (executionPlanOptions) {
            this._executionPlanOptions = executionPlanOptions;
        } else {
            this._executionPlanOptions = {};
        }
        this._queryResultWebviewController.addQueryResultState(
            uri,
            title,
            this.getIsExecutionPlan(),
            this._executionPlanOptions?.includeActualExecutionPlanXml ?? false,
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
            queryRunner.eventEmitter.on("start", async (_panelUri) => {
                this._lastSendMessageTime = Date.now();
                this._queryResultWebviewController.addQueryResultState(
                    queryRunner.uri,
                    title,
                    this.getIsExecutionPlan(),
                    this._executionPlanOptions?.includeActualExecutionPlanXml ?? false,
                );
                this._queryResultWebviewController.getQueryResultState(
                    queryRunner.uri,
                ).tabStates.resultPaneTab = QueryResultPaneTabs.Messages;
                if (this.isOpenQueryResultsInTabByDefaultEnabled) {
                    await this._queryResultWebviewController.createPanelController(queryRunner.uri);
                }
                this._queryResultWebviewController.updatePanelState(queryRunner.uri);
                if (!this._queryResultWebviewController.hasPanel(queryRunner.uri)) {
                    await this._queryResultWebviewController.revealToForeground();
                }
                sendActionEvent(TelemetryViews.QueryResult, TelemetryActions.OpenQueryResult, {
                    defaultLocation: this.isOpenQueryResultsInTabByDefaultEnabled ? "tab" : "pane",
                });
            });
            queryRunner.eventEmitter.on("resultSet", async (resultSet: ResultSetSummary) => {
                this._queryResultWebviewController.addResultSetSummary(queryRunner.uri, resultSet);
                this._queryResultWebviewController.updatePanelState(queryRunner.uri);
            });
            queryRunner.eventEmitter.on("batchStart", async (batch) => {
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

                this._queryResultWebviewController
                    .getQueryResultState(queryRunner.uri)
                    .messages.push(message);
                this._queryResultWebviewController.getQueryResultState(
                    queryRunner.uri,
                ).tabStates.resultPaneTab = QueryResultPaneTabs.Messages;
                this._queryResultWebviewController.state =
                    this._queryResultWebviewController.getQueryResultState(queryRunner.uri);
                this._queryResultWebviewController.updatePanelState(queryRunner.uri);
                if (!this._queryResultWebviewController.hasPanel(queryRunner.uri)) {
                    await this._queryResultWebviewController.revealToForeground();
                }
            });
            queryRunner.eventEmitter.on("message", async (message) => {
                this._queryResultWebviewController
                    .getQueryResultState(queryRunner.uri)
                    .messages.push(message);

                // Set state for messages at fixed intervals to avoid spamming the webview
                if (this._lastSendMessageTime < Date.now() - MESSAGE_INTERVAL_IN_MS) {
                    this._queryResultWebviewController.getQueryResultState(
                        queryRunner.uri,
                    ).tabStates.resultPaneTab = QueryResultPaneTabs.Messages;
                    this._queryResultWebviewController.state =
                        this._queryResultWebviewController.getQueryResultState(queryRunner.uri);
                    this._queryResultWebviewController.updatePanelState(queryRunner.uri);
                    if (!this._queryResultWebviewController.hasPanel(queryRunner.uri)) {
                        await this._queryResultWebviewController.revealToForeground();
                    }
                    this._lastSendMessageTime = Date.now();
                }
            });
            queryRunner.eventEmitter.on(
                "complete",
                async (totalMilliseconds, hasError, isRefresh?) => {
                    if (!isRefresh) {
                        // only update query history with new queries
                        this._vscodeWrapper.executeCommand(
                            Constants.cmdRefreshQueryHistory,
                            queryRunner.uri,
                            hasError,
                        );
                    }

                    this._queryResultWebviewController
                        .getQueryResultState(queryRunner.uri)
                        .messages.push({
                            message: LocalizedConstants.elapsedTimeLabel(totalMilliseconds),
                            isError: false, // Elapsed time messages are never displayed as errors
                        });
                    // if there is an error, show the error message and set the tab to the messages tab
                    let tabState: QueryResultPaneTabs;
                    if (hasError) {
                        tabState = QueryResultPaneTabs.Messages;
                    } else {
                        tabState =
                            Object.keys(
                                this._queryResultWebviewController.getQueryResultState(
                                    queryRunner.uri,
                                ).resultSetSummaries,
                            ).length > 0
                                ? QueryResultPaneTabs.Results
                                : QueryResultPaneTabs.Messages;
                    }

                    this._queryResultWebviewController.getQueryResultState(
                        queryRunner.uri,
                    ).tabStates.resultPaneTab = tabState;
                    this._queryResultWebviewController.state =
                        this._queryResultWebviewController.getQueryResultState(queryRunner.uri);
                    this._queryResultWebviewController.updatePanelState(queryRunner.uri);
                    if (!this._queryResultWebviewController.hasPanel(queryRunner.uri)) {
                        await this._queryResultWebviewController.revealToForeground();
                    }
                },
            );
            this._queryResultsMap.set(uri, new QueryRunnerState(queryRunner));
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

    public updateQueryRunnerUri(oldUri: string, newUri: string): void {
        let queryRunner = this.getQueryRunner(oldUri);
        if (queryRunner) {
            queryRunner.updateQueryRunnerUri(oldUri, newUri);
        }
    }

    /**
     * Executed from the MainController when a text document (that already exists on disk) was
     * closed. If the query is in progress, it will be canceled. If there is a query at all,
     * the query will be disposed.
     * @param doc   The document that was closed
     */
    public onDidCloseTextDocument(doc: vscode.TextDocument): void {
        for (let [key, value] of this._queryResultsMap.entries()) {
            // closes text document related to a results window we are holding
            if (doc.uri.toString(true) === value.queryRunner.uri) {
                value.flaggedForDeletion = true;
            }

            // "closes" a results window we are holding
            if (doc.uri.toString(true) === key) {
                value.timeout = this.setRunnerDeletionTimeout(key);
            }
        }
    }

    private setRunnerDeletionTimeout(uri: string): NodeJS.Timer {
        const self = this;
        return setTimeout(() => {
            let queryRunnerState = self._queryResultsMap.get(uri);
            if (queryRunnerState.flaggedForDeletion) {
                self._queryResultsMap.delete(uri);

                if (queryRunnerState.queryRunner.isExecutingQuery) {
                    // We need to cancel it, which will dispose it
                    this.cancelQuery(queryRunnerState.queryRunner);
                } else {
                    // We need to explicitly dispose the query
                    void queryRunnerState.queryRunner.dispose();
                }
            } else {
                queryRunnerState.timeout = this.setRunnerDeletionTimeout(uri);
            }
        }, deletionTimeoutTime);
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

    public getIsExecutionPlan(): boolean {
        return (
            (this._executionPlanOptions?.includeEstimatedExecutionPlanXml ?? false) ||
            (this._executionPlanOptions?.includeActualExecutionPlanXml ?? false)
        );
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
}
