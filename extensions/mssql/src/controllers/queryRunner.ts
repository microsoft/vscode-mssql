/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import StatusView from "../views/statusView";
import SqlToolsServerClient from "../languageservice/serviceclient";
import { QueryNotificationHandler } from "./queryNotificationHandler";
import VscodeWrapper from "./vscodeWrapper";
import {
    BatchSummary,
    QueryExecuteParams,
    QueryExecuteRequest,
    QueryExecuteStatementParams,
    QueryExecuteStatementRequest,
    QueryExecuteCompleteNotificationResult,
    QueryExecuteSubsetResult,
    QueryExecuteResultSetAvailableNotificationParams,
    QueryExecuteResultSetUpdatedNotificationParams,
    QueryExecuteResultSetCompleteNotificationParams,
    QueryExecuteSubsetParams,
    QueryExecuteSubsetRequest,
    QueryExecuteMessageParams,
    QueryExecuteBatchNotificationParams,
    QueryExecuteOptionsRequest,
    QueryExecutionOptionsParams,
    QueryExecutionOptions,
    ExecutionPlanOptions,
    QueryConnectionUriChangeRequest,
    QueryConnectionUriChangeParams,
    GridSelectionSummaryRequest,
    TableSelectionRange,
    CancelGridSelectionSummaryNotification,
    CopyResults2Request,
    CopyResults2RequestParams,
    CopyType,
    CancelCopy2Notification,
} from "../models/contracts/queryExecute";
import { QueryDisposeParams, QueryDisposeRequest } from "../models/contracts/queryDispose";
import {
    QueryCancelParams,
    QueryCancelResult,
    QueryCancelRequest,
} from "../models/contracts/queryCancel";
import {
    ISlickRange,
    ISelectionData,
    IResultMessage,
    ResultSetSummary,
} from "../models/interfaces";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as Utils from "../models/utils";
import { getErrorMessage } from "../utils/utils";
import * as os from "os";
import { Deferred } from "../protocol";
import { sendActionEvent, startActivity } from "../telemetry/telemetry";
import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { SelectionSummary } from "../sharedInterfaces/queryResult";
import { getInMemoryGridDataProcessingThreshold } from "../queryResult/utils";

export interface IResultSet {
    columns: string[];
    totalNumberOfRows: number;
}

export interface QueryExecutionCompleteEvent {
    totalMilliseconds: string;
    hasError: boolean;
    isRefresh?: boolean;
}

export interface ExecutionPlanEvent {
    uri: string;
    xml: string;
    batchId: number;
    resultId: number;
}

export interface SummaryChanged extends SelectionSummary {
    uri: string;
}

export const editorEol =
    vscode.workspace.getConfiguration("files").get<string>("eol") === "auto"
        ? os.EOL
        : vscode.workspace.getConfiguration("files").get<string>("eol");

/*
 * Query Runner class which handles running a query, reports the results to the content manager,
 * and handles getting more rows from the service layer and disposing when the content is closed.
 */
export default class QueryRunner {
    private _batchSets: BatchSummary[] = [];
    private _batchSetMessages: { [batchId: number]: IResultMessage[] } = {};
    private _isExecuting: boolean;
    private _resultLineOffset: number;
    private _totalElapsedMilliseconds: number;
    private _hasCompleted: boolean;
    private _isSqlCmd: boolean = false;
    private _uriToQueryPromiseMap = new Map<string, Deferred<boolean>>();
    private _uriToQueryStringMap = new Map<string, string>();
    private static _runningQueries = [];

    private _startFailedEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    public onStartFailed: vscode.Event<string> = this._startFailedEmitter.event;

    private _startEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    public onStart: vscode.Event<string> = this._startEmitter.event;

    private _batchStartEmitter: vscode.EventEmitter<BatchSummary> =
        new vscode.EventEmitter<BatchSummary>();
    public onBatchStart: vscode.Event<BatchSummary> = this._batchStartEmitter.event;

    private _batchCompleteEmitter: vscode.EventEmitter<BatchSummary> =
        new vscode.EventEmitter<BatchSummary>();
    public onBatchComplete: vscode.Event<BatchSummary> = this._batchCompleteEmitter.event;

    private _resultSetAvailableEmitter: vscode.EventEmitter<ResultSetSummary> =
        new vscode.EventEmitter<ResultSetSummary>();
    public onResultSetAvailable: vscode.Event<ResultSetSummary> =
        this._resultSetAvailableEmitter.event;

    private _resultSetUpdatedEmitter: vscode.EventEmitter<ResultSetSummary> =
        new vscode.EventEmitter<ResultSetSummary>();
    public onResultSetUpdated: vscode.Event<ResultSetSummary> = this._resultSetUpdatedEmitter.event;

    private _resultSetCompleteEmitter: vscode.EventEmitter<ResultSetSummary> =
        new vscode.EventEmitter<ResultSetSummary>();
    public onResultSetComplete: vscode.Event<ResultSetSummary> =
        this._resultSetCompleteEmitter.event;

    private _executionPlanEmitter: vscode.EventEmitter<ExecutionPlanEvent> =
        new vscode.EventEmitter<ExecutionPlanEvent>();
    public onExecutionPlan: vscode.Event<ExecutionPlanEvent> = this._executionPlanEmitter.event;

    private _messageEmitter: vscode.EventEmitter<IResultMessage> =
        new vscode.EventEmitter<IResultMessage>();
    public onMessage: vscode.Event<IResultMessage> = this._messageEmitter.event;

    private _completeEmitter: vscode.EventEmitter<QueryExecutionCompleteEvent> =
        new vscode.EventEmitter<QueryExecutionCompleteEvent>();
    public onComplete: vscode.Event<QueryExecutionCompleteEvent> = this._completeEmitter.event;

    private _onSummaryChangedEmitter: vscode.EventEmitter<SummaryChanged> =
        new vscode.EventEmitter<SummaryChanged>();
    public onSummaryChanged: vscode.Event<SummaryChanged> = this._onSummaryChangedEmitter.event;

    // CONSTRUCTOR /////////////////////////////////////////////////////////

    constructor(
        private _ownerUri: string,
        private _editorTitle: string,
        private _statusView: StatusView,
        private _client?: SqlToolsServerClient,
        private _notificationHandler?: QueryNotificationHandler,
        private _vscodeWrapper?: VscodeWrapper,
    ) {
        if (!_client) {
            this._client = SqlToolsServerClient.instance;
        }

        if (!_notificationHandler) {
            this._notificationHandler = QueryNotificationHandler.instance;
        }

        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        // Store the state
        this._isExecuting = false;
        this._totalElapsedMilliseconds = 0;
        this._hasCompleted = false;
    }

    // PROPERTIES //////////////////////////////////////////////////////////

    get uri(): string {
        return this._ownerUri;
    }

    set uri(uri: string) {
        this._ownerUri = uri;
    }

    get title(): string {
        return this._editorTitle;
    }

    set title(title: string) {
        this._editorTitle = title;
    }

    get batchSets(): BatchSummary[] {
        return this._batchSets;
    }

    set batchSets(batchSets: BatchSummary[]) {
        this._batchSets = batchSets;
    }

    get batchSetMessages(): { [batchId: number]: IResultMessage[] } {
        return this._batchSetMessages;
    }

    get isExecutingQuery(): boolean {
        return this._isExecuting;
    }

    get isSqlCmd(): boolean {
        return this._isSqlCmd;
    }

    set isSqlCmd(value: boolean) {
        this._isSqlCmd = value;
    }

    get hasCompleted(): boolean {
        return this._hasCompleted;
    }

    set hasCompleted(value: boolean) {
        this._hasCompleted = value;
    }

    // PUBLIC METHODS ======================================================

    /**
     * Cancels the currently running query.
     * @returns A promise that resolves to the result of the cancel operation.
     */
    public async cancel(): Promise<QueryCancelResult> {
        // Make the request to cancel the query
        let cancelParams: QueryCancelParams = { ownerUri: this._ownerUri };
        let queryCancelResult: QueryCancelResult;
        const cancelQueryActivity = startActivity(
            TelemetryViews.QueryEditor,
            TelemetryActions.CancelQuery,
        );
        try {
            queryCancelResult = await this._client.sendRequest(
                QueryCancelRequest.type,
                cancelParams,
            );
            cancelQueryActivity?.end(ActivityStatus.Succeeded)
        } catch (error) {
            this._handleQueryCleanup(
                LocalizedConstants.QueryEditor.queryCancelFailed(error),
                error,
            );
            cancelQueryActivity?.endFailed(error, false);
            return;
        }
        return queryCancelResult;
    }

    /**
     * Resets the query runner to a clean state if we want to run another query on it.
     */
    public async resetQueryRunner(): Promise<void> {
        try {
            await this.cancel();
        } catch {
            // Suppress any errors
        }
        this._isExecuting = false;
        this._hasCompleted = true;
        this.removeRunningQuery();
        const promise = this._uriToQueryPromiseMap.get(this._ownerUri);
        if (promise) {
            promise.reject("Query cancelled");
            this._uriToQueryPromiseMap.delete(this._ownerUri);
        }
    }

    /**
     * Runs a query against the database for the current statement based on the cursor position.
     */
    public async runStatement(line: number, column: number): Promise<void> {
        await this.setupQueryExecution({
            startLine: line,
            startColumn: column,
            endLine: 0,
            endColumn: 0,
        });

        let optionsParams: QueryExecuteStatementParams = {
            ownerUri: this._ownerUri,
            line: line,
            column: column,
        };

        try {
            await this._client.sendRequest(QueryExecuteStatementRequest.type, optionsParams);
            this._startEmitter.fire(this.uri);
        } catch (error) {
            this._handleQueryCleanup(undefined, error);
            this._startFailedEmitter.fire(getErrorMessage(error));
            throw error;
        }
    }

    // Pulls the query text from the current document/selection and initiates the query
    public async runQuery(
        selection: ISelectionData,
        executionPlanOptions?: ExecutionPlanOptions,
        promise?: Deferred<boolean>,
    ): Promise<void> {
        await this.setupQueryExecution(selection);

        // Setting up options
        let executeOptions: QueryExecuteParams = {
            ownerUri: this._ownerUri,
            executionPlanOptions: executionPlanOptions,
            querySelection: selection,
        };

        // Getting query text
        const doc = await this._vscodeWrapper.openTextDocument(
            this._vscodeWrapper.parseUri(this._ownerUri),
        );
        let queryString: string;
        if (selection) {
            let range = this._vscodeWrapper.range(
                this._vscodeWrapper.position(selection.startLine, selection.startColumn),
                this._vscodeWrapper.position(selection.endLine, selection.endColumn),
            );
            queryString = doc.getText(range);
        } else {
            queryString = doc.getText();
        }
        this._uriToQueryStringMap.set(this._ownerUri, queryString);

        // Setting up completion promise.
        if (promise) {
            this._uriToQueryPromiseMap.set(this._ownerUri, promise);
        }

        try {
            await this._client.sendRequest(QueryExecuteRequest.type, executeOptions);
            this._startEmitter.fire(this.uri);
        } catch (error) {
            this._handleQueryCleanup(undefined, error);
            this._startFailedEmitter.fire(getErrorMessage(error));
            throw error;
        }
    }

    public setupQueryExecution(selection: ISelectionData): void {
        this._vscodeWrapper.logToOutputChannel(
            LocalizedConstants.msgStartedExecute(this._ownerUri),
        );
        // Store the line offset for the query text
        this._resultLineOffset = selection ? selection.startLine : 0;
        this._isExecuting = true;
        this._totalElapsedMilliseconds = 0;
        // Update the status view to show that we're executing
        this._statusView.executingQuery(this.uri);

        QueryRunner.addRunningQuery(this._ownerUri);

        this._notificationHandler.registerRunner(this, this._ownerUri);
    }

    // handle the result of the notification
    public handleQueryComplete(result: QueryExecuteCompleteNotificationResult): void {
        this._vscodeWrapper.logToOutputChannel(
            LocalizedConstants.msgFinishedExecute(this._ownerUri),
        );

        // Store the batch sets we got back as a source of "truth"
        this._isExecuting = false;
        this._hasCompleted = true;
        this._batchSets = result.batchSummaries;

        this._batchSets.map((batch) => {
            if (batch.selection) {
                batch.selection.startLine = batch.selection.startLine + this._resultLineOffset;
                batch.selection.endLine = batch.selection.endLine + this._resultLineOffset;
            }
        });

        // We're done with this query so shut down any waiting mechanisms
        const promise = this._uriToQueryPromiseMap.get(result.ownerUri);
        if (promise) {
            promise.resolve();
            this._uriToQueryPromiseMap.delete(result.ownerUri);
        }
        this._statusView.executedQuery(result.ownerUri);
        this._statusView.setExecutionTime(
            result.ownerUri,
            Utils.parseNumAsTimeString(this._totalElapsedMilliseconds),
        );
        let hasError = this._batchSets.some((batch) => batch.hasError === true);
        this.removeRunningQuery();
        this._completeEmitter.fire({
            totalMilliseconds: Utils.parseNumAsTimeString(this._totalElapsedMilliseconds),
            hasError,
        });
        sendActionEvent(
            TelemetryViews.QueryEditor,
            TelemetryActions.QueryExecutionCompleted,
            undefined,
        );
    }

    public handleBatchStart(result: QueryExecuteBatchNotificationParams): void {
        let batch = result.batchSummary;

        // Recalculate the start and end lines, relative to the result line offset
        if (batch.selection) {
            batch.selection.startLine += this._resultLineOffset;
            batch.selection.endLine += this._resultLineOffset;
        }

        // Set the result sets as an empty array so that as result sets complete we can add to the list
        batch.resultSetSummaries = [];

        // Set the batch messages to an empty array
        this._batchSetMessages[batch.id] = [];

        // Store the batch
        this._batchSets[batch.id] = batch;
        this._batchStartEmitter.fire(batch);
    }

    public handleBatchComplete(result: QueryExecuteBatchNotificationParams): void {
        let batch: BatchSummary = result.batchSummary;

        // Store the batch again to get the rest of the data
        this._batchSets[batch.id] = batch;
        let executionTime = <number>(Utils.parseTimeString(batch.executionElapsed) || 0);
        this._totalElapsedMilliseconds += executionTime;
        if (executionTime > 0) {
            // send a time message in the format used for query complete
            this.sendBatchTimeMessage(batch.id, Utils.parseNumAsTimeString(executionTime));
        }
        this._batchCompleteEmitter.fire(batch);
    }

    public handleResultSetAvailable(
        result: QueryExecuteResultSetAvailableNotificationParams,
    ): void {
        let resultSet = result.resultSetSummary;
        let batchSet = this._batchSets[resultSet.batchId];

        // Initialize result set in the batch if it doesn't exist
        if (!batchSet.resultSetSummaries[resultSet.id]) {
            batchSet.resultSetSummaries[resultSet.id] = resultSet;
        }

        this._resultSetAvailableEmitter.fire(resultSet);
    }

    public handleResultSetUpdated(result: QueryExecuteResultSetUpdatedNotificationParams): void {
        let resultSet = result.resultSetSummary;
        let batchSet = this._batchSets[resultSet.batchId];

        // Update the result set in the batch
        batchSet.resultSetSummaries[resultSet.id] = resultSet;

        this._resultSetUpdatedEmitter.fire(resultSet);
    }

    public async handleResultSetComplete(
        result: QueryExecuteResultSetCompleteNotificationParams,
    ): Promise<void> {
        let resultSet = result.resultSetSummary;
        let batchSet = this._batchSets[resultSet.batchId];

        // Store the result set in the batch and emit that a result set has completed
        batchSet.resultSetSummaries[resultSet.id] = resultSet;

        this._resultSetCompleteEmitter.fire(resultSet);

        if (resultSet.columnInfo?.[0]?.columnName === Constants.showPlanXmlColumnName) {
            const result = await this.getRows(0, 1, resultSet.batchId, resultSet.id);
            this._executionPlanEmitter.fire({
                uri: this.uri,
                xml: result.resultSubset.rows[0][0].displayValue,
                batchId: resultSet.batchId,
                resultId: resultSet.id,
            });
        }
    }

    public handleMessage(obj: QueryExecuteMessageParams): void {
        let message = obj.message;
        message.time = new Date(message.time).toLocaleTimeString();

        // save the message into the batch summary so it can be restored on view refresh
        if (message.batchId >= 0 && this._batchSetMessages[message.batchId] !== undefined) {
            this._batchSetMessages[message.batchId].push(message);
        }

        // Send the message to the results pane
        this._messageEmitter.fire(message);

        // Set row count on status bar if there are no errors
        if (!obj.message.isError) {
            this._statusView.showRowCount(obj.ownerUri, obj.message.message);
        } else {
            this._statusView.hideRowCount(obj.ownerUri, true);
        }
    }

    /**
     * Disposes the Query from the service client
     * @returns A promise that will be rejected if a problem occured
     */
    public async dispose(): Promise<void> {
        let disposeDetails = new QueryDisposeParams();
        disposeDetails.ownerUri = this.uri;
        try {
            await this._client.sendRequest(QueryDisposeRequest.type, disposeDetails);
        } catch (_error) {
            // Do not show error message if dispose fails as it normally means the query is already disposed
            this._handleQueryCleanup();
            return;
        }
        this._handleQueryCleanup();
    }

    /**
     * Handles cleanup and state reset after a cancel attempt, for both error and success scenarios.
     * @param errorMsg Optional error message to display
     * @param error Optional error message to send to pending promises of query run. If not provided, the promise will be resolved.
     */
    private _handleQueryCleanup(errorMsg?: String, error?: Error): void {
        this._isExecuting = false;
        this._hasCompleted = true;
        this.removeRunningQuery();

        const promise = this._uriToQueryPromiseMap.get(this._ownerUri);
        if (promise) {
            if (error) {
                promise.reject(error);
            } else {
                promise.resolve();
            }
            this._uriToQueryPromiseMap.delete(this._ownerUri);
        }

        this._completeEmitter.fire({
            totalMilliseconds: Utils.parseNumAsTimeString(this._totalElapsedMilliseconds),
            hasError: !!error,
        });
        this._statusView.executedQuery(this._ownerUri);

        this._notificationHandler.unregisterRunner(this._ownerUri);

        if (errorMsg) {
            this._vscodeWrapper.showErrorMessage(getErrorMessage(errorMsg));
        }
    }

    /*
     * Get more data rows from the current resultSets from the service layer
     */
    public async getRows(
        rowStart: number,
        numberOfRows: number,
        batchIndex: number,
        resultSetIndex: number,
    ): Promise<QueryExecuteSubsetResult> {
        let queryDetails = new QueryExecuteSubsetParams();
        queryDetails.ownerUri = this.uri;
        queryDetails.resultSetIndex = resultSetIndex;
        queryDetails.rowsCount = numberOfRows;
        queryDetails.rowsStartIndex = rowStart;
        queryDetails.batchIndex = batchIndex;
        try {
            const queryExecuteSubsetResult = await this._client.sendRequest(
                QueryExecuteSubsetRequest.type,
                queryDetails,
            );
            if (queryExecuteSubsetResult) {
                return queryExecuteSubsetResult;
            }
        } catch (error) {
            // TODO: Localize
            this._vscodeWrapper.showErrorMessage(
                LocalizedConstants.QueryResult.getRowsError(getErrorMessage(error)),
            );
            void Promise.reject(error);
        }
    }

    private getColumnHeaders(batchId: number, resultId: number, range: ISlickRange): string[] {
        let headers: string[] = undefined;
        let batchSummary: BatchSummary = this.batchSets[batchId];
        if (batchSummary !== undefined) {
            let resultSetSummary = batchSummary.resultSetSummaries[resultId];
            headers = resultSetSummary.columnInfo
                .slice(range.fromCell, range.toCell + 1)
                .map((info) => {
                    return info.columnName;
                });
        }
        return headers;
    }

    public async copyHeaders(
        batchId: number,
        resultId: number,
        selection: ISlickRange[],
    ): Promise<void> {
        let copyString = "";
        let firstCol: number;
        let lastCol: number;
        for (let range of selection) {
            if (firstCol === undefined || range.fromCell < firstCol) {
                firstCol = range.fromCell;
            }
            if (lastCol === undefined || range.toCell > lastCol) {
                lastCol = range.toCell;
            }
        }
        let columnRange: ISlickRange = {
            fromCell: firstCol,
            toCell: lastCol,
            fromRow: undefined,
            toRow: undefined,
        };
        let columnHeaders = this.getColumnHeaders(batchId, resultId, columnRange);
        copyString += columnHeaders.join("\t");

        let oldLang: string;
        if (process.platform === "darwin") {
            oldLang = process.env["LANG"];
            process.env["LANG"] = "en_US.UTF-8";
        }
        await this._vscodeWrapper.clipboardWriteText(copyString);
        if (process.platform === "darwin") {
            process.env["LANG"] = oldLang;
        }
    }

    /**
     * Copy the result range to the system clip-board
     * @param selection The selection range array to copy
     * @param batchId The id of the batch to copy from
     * @param resultId The id of the result to copy from
     * @param includeHeaders [Optional]: Should column headers be included in the copy selection
     */
    public async copyResults(
        selection: ISlickRange[],
        batchId: number,
        resultId: number,
        includeHeaders?: boolean,
    ): Promise<void> {
        await this.copyResults2(selection, batchId, resultId, CopyType.Text, {
            includeHeaders: includeHeaders ?? false,
        });
    }

    /**
     * Copy the result range using the query/copy2 contract
     */
    private async copyResults2(
        selection: ISlickRange[],
        batchId: number,
        resultId: number,
        copyType: CopyType,
        options?: {
            includeHeaders?: boolean;
            delimiter?: string;
            lineSeparator?: string;
            textIdentifier?: string;
            encoding?: string;
        },
    ): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: LocalizedConstants.copyingResults,
                cancellable: true,
            },
            async (_progress, token) => {
                return new Promise<void>(async (resolve, reject) => {
                    try {
                        token.onCancellationRequested(async () => {
                            await this._client.sendNotification(CancelCopy2Notification.type);
                            vscode.window.showInformationMessage("Copying results cancelled");
                            resolve();
                        });

                        const selections: TableSelectionRange[] = selection.map((range) => ({
                            fromRow: range.fromRow,
                            toRow: range.toRow,
                            fromColumn: range.fromCell,
                            toColumn: range.toCell,
                        }));

                        const params: CopyResults2RequestParams = {
                            ownerUri: this.uri,
                            batchIndex: batchId,
                            resultSetIndex: resultId,
                            copyType,
                            includeHeaders: options?.includeHeaders ?? false,
                            selections,
                            delimiter: options?.delimiter,
                            lineSeparator: options?.lineSeparator ?? editorEol,
                            textIdentifier: options?.textIdentifier,
                            encoding: options?.encoding,
                        };

                        await this._client.sendRequest(CopyResults2Request.type, params);
                        vscode.window.showInformationMessage(
                            LocalizedConstants.resultsCopiedToClipboard,
                        );
                        resolve();
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            LocalizedConstants.QueryResult.copyError(getErrorMessage(error)),
                        );
                        reject(error);
                    }
                });
            },
        );
    }

    /**
     * Add the column headers to the copy string
     * @param copyString
     * @param batchId
     * @param resultId
     * @param selection
     * @returns
     */
    public addHeadersToCopyString(
        copyString: string,
        batchId: number,
        resultId: number,
        selection: ISlickRange[],
    ): string {
        // add the column headers
        let firstCol: number;
        let lastCol: number;
        for (let range of selection) {
            if (firstCol === undefined || range.fromCell < firstCol) {
                firstCol = range.fromCell;
            }
            if (lastCol === undefined || range.toCell > lastCol) {
                lastCol = range.toCell;
            }
        }
        let columnRange: ISlickRange = {
            fromCell: firstCol,
            toCell: lastCol,
            fromRow: undefined,
            toRow: undefined,
        };
        let columnHeaders = this.getColumnHeaders(batchId, resultId, columnRange);
        copyString += columnHeaders.join("\t");
        copyString += editorEol;
        return copyString;
    }

    public async writeStringToClipboard(copyString: string): Promise<void> {
        let oldLang: string;
        if (process.platform === "darwin") {
            oldLang = process.env["LANG"];
            process.env["LANG"] = "en_US.UTF-8";
        }
        await this._vscodeWrapper.clipboardWriteText(copyString);
        if (process.platform === "darwin") {
            process.env["LANG"] = oldLang;
        }
    }

    /**
     * Copy the result range to the system clip-board as CSV format
     * @param selection The selection range array to copy
     * @param batchId The id of the batch to copy from
     * @param resultId The id of the result to copy from
     * @param includeHeaders [Optional]: Should column headers be included in the copy selection
     */
    public async copyResultsAsCsv(
        selection: ISlickRange[],
        batchId: number,
        resultId: number,
    ): Promise<void> {
        const config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
        const csvConfig = config[Constants.configSaveAsCsv] || {};

        const delimiter = csvConfig.delimiter || ",";
        const textIdentifier = csvConfig.textIdentifier || '"';
        const lineSeparator = csvConfig.lineSeperator || editorEol;
        const encoding = csvConfig.encoding;
        const includeHeaders = csvConfig.includeHeaders;

        await this.copyResults2(selection, batchId, resultId, CopyType.CSV, {
            includeHeaders: includeHeaders,
            delimiter,
            textIdentifier,
            lineSeparator,
            encoding,
        });
    }

    /**
     * Copy the result range to the system clip-board as JSON format
     * @param selection The selection range array to copy
     * @param batchId The id of the batch to copy from
     * @param resultId The id of the result to copy from
     * @param includeHeaders [Optional]: Should column headers be included in the copy selection
     */
    public async copyResultsAsJson(
        selection: ISlickRange[],
        batchId: number,
        resultId: number,
    ): Promise<void> {
        await this.copyResults2(selection, batchId, resultId, CopyType.JSON, {
            includeHeaders: true,
        });
    }

    public async copyResultsAsInClause(
        selection: ISlickRange[],
        batchId: number,
        resultId: number,
    ): Promise<void> {
        await this.copyResults2(selection, batchId, resultId, CopyType.IN);
    }

    public async copyResultsAsInsertInto(
        selection: ISlickRange[],
        batchId: number,
        resultId: number,
    ): Promise<void> {
        await this.copyResults2(selection, batchId, resultId, CopyType.INSERT, {
            includeHeaders: true,
        });
    }

    private _requestID: string;
    private _cancelConfirmation: Deferred<void>;
    public async generateSelectionSummaryData(
        selections: ISlickRange[],
        batchId: number,
        resultId: number,
        showThresholdWarning: boolean = true,
    ): Promise<void> {
        /** Ask the user to proceed for large selections. */
        const waitForUserToProceed = async (
            requestId: string,
            totalRows: number,
        ): Promise<void> => {
            const proceed = new Deferred<void>();
            this.fireSummaryChangedEvent(requestId, {
                command: {
                    title: Constants.cmdHandleSummaryOperation,
                    command: Constants.cmdHandleSummaryOperation,
                    arguments: [this.uri],
                },
                continue: proceed,
                text: `$(play-circle) ${LocalizedConstants.QueryResult.summaryFetchConfirmation(totalRows)}`,
                tooltip: LocalizedConstants.QueryResult.clickToFetchSummary,
                uri: this.uri,
            });
            await proceed.promise;
        };

        const showProgress = (cancelConfirmation: Deferred<void>) => {
            this.fireSummaryChangedEvent(this._requestID, {
                command: {
                    title: Constants.cmdHandleSummaryOperation,
                    command: Constants.cmdHandleSummaryOperation,
                    arguments: [this.uri],
                },
                continue: cancelConfirmation,
                text: `$(loading~spin) ${LocalizedConstants.QueryResult.summaryLoadingProgress(totalRows)}`,
                tooltip: LocalizedConstants.QueryResult.clickToCancelLoadingSummary,
                uri: this.uri,
            });
        };

        // create a new request and cancel any in-flight run
        this._requestID = Utils.generateGuid();
        const requestId = this._requestID;
        this._cancelConfirmation?.resolve();
        this._cancelConfirmation = undefined;

        const totalRows = this.getTotalSelectedRows(selections);

        const threshold = getInMemoryGridDataProcessingThreshold();

        // optional “are you sure?” for large selections
        if (showThresholdWarning && totalRows > threshold) {
            await waitForUserToProceed(requestId, totalRows);
        }

        const sendCancelSummaryEvent = async () => {
            // Reset and allow user to start a new summary operation
            this._cancelConfirmation = undefined;
            await waitForUserToProceed(requestId, totalRows);
            await this.generateSelectionSummaryData(selections, batchId, resultId, false);
        };

        this._cancelConfirmation = new Deferred<void>();
        const cancel = this._cancelConfirmation;
        let isCanceled = false;
        // Set up cancellation handling
        cancel.promise
            .then(async () => {
                isCanceled = true;
                await this._client.sendNotification(CancelGridSelectionSummaryNotification.type, {
                    ownerUri: this.uri,
                });
                await sendCancelSummaryEvent();
            })
            .catch(() => {
                /* noop */
            });

        showProgress(cancel);

        try {
            // Convert ISlickRange[] to TableSelectionRange[]
            const simpleSelections: TableSelectionRange[] = selections.map((range) => ({
                fromRow: range.fromRow,
                toRow: range.toRow,
                fromColumn: range.fromCell,
                toColumn: range.toCell,
            }));

            const result = await this._client.sendRequest(GridSelectionSummaryRequest.type, {
                ownerUri: this.uri,
                batchIndex: batchId,
                resultSetIndex: resultId,
                rowsStartIndex: 0,
                rowsCount: 0,
                selections: simpleSelections,
            });

            if (isCanceled) {
                await sendCancelSummaryEvent();
                return;
            }

            let text = "";
            let tooltip = "";

            // the selection is numeric
            if (result.average !== undefined && result.average !== null) {
                const average = result.average.toFixed(2);
                text = LocalizedConstants.QueryResult.numericSelectionSummary(
                    average,
                    result.count,
                    result.sum,
                );
                tooltip = LocalizedConstants.QueryResult.numericSelectionSummaryTooltip(
                    average,
                    result.count,
                    result.distinctCount,
                    result.max ?? 0,
                    result.min ?? 0,
                    result.nullCount,
                    result.sum,
                );
            } else {
                text = LocalizedConstants.QueryResult.nonNumericSelectionSummary(
                    result.count,
                    result.distinctCount,
                    result.nullCount,
                );
                tooltip = LocalizedConstants.QueryResult.nonNumericSelectionSummaryTooltip(
                    result.count,
                    result.distinctCount,
                    result.nullCount,
                );
                tooltip = text;
            }

            // Resolve the cancel confirmation to clean up
            if (!isCanceled) {
                cancel.reject();
            }

            this.fireSummaryChangedEvent(requestId, {
                text,
                tooltip,
                uri: this.uri,
                command: undefined,
                continue: undefined,
            });
        } catch (error) {
            // Clean up on error
            if (!isCanceled) {
                cancel.reject(error);
            }

            this.fireSummaryChangedEvent(requestId, {
                text: `$(error) ${LocalizedConstants.QueryResult.errorLoadingSummary}`,
                tooltip: LocalizedConstants.QueryResult.errorLoadingSummaryTooltip(
                    getErrorMessage(error),
                ),
                uri: this.uri,
                command: undefined,
                continue: undefined,
            });
            throw error;
        }
    }

    private fireSummaryChangedEvent(requestId: string, summary: SummaryChanged): void {
        if (this._requestID === requestId) {
            this._onSummaryChangedEmitter.fire(summary);
        }
    }

    public async toggleSqlCmd(): Promise<boolean> {
        const queryExecuteOptions: QueryExecutionOptions = { options: {} };
        queryExecuteOptions.options["isSqlCmdMode"] = !this.isSqlCmd;
        const queryExecuteOptionsParams: QueryExecutionOptionsParams = {
            ownerUri: this.uri,
            options: queryExecuteOptions,
        };
        await this._client.sendRequest(QueryExecuteOptionsRequest.type, queryExecuteOptionsParams);
        this._isSqlCmd = !this._isSqlCmd;
        return true;
    }

    private sendBatchTimeMessage(batchId: number, executionTime: string): void {
        // get config copyRemoveNewLine option from vscode config
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            this.uri,
        );
        let showBatchTime: boolean = config.get(Constants.configShowBatchTime);
        if (showBatchTime) {
            let message: IResultMessage = {
                batchId: batchId,
                message: LocalizedConstants.elapsedBatchTime(executionTime),
                time: undefined,
                isError: false,
            };
            this._messageEmitter.fire(message);
        }
    }

    /**
     * Sets a selection range in the editor for this query
     * @param selection The selection range to select
     */
    public async setEditorSelection(selection: ISelectionData): Promise<void> {
        const docExists = this._vscodeWrapper.textDocuments.find(
            (textDoc) => textDoc.uri.toString(true) === this.uri,
        );
        if (docExists) {
            let column = vscode.ViewColumn.One;
            const doc = await this._vscodeWrapper.openTextDocument(
                this._vscodeWrapper.parseUri(this.uri),
            );
            const activeTextEditor = this._vscodeWrapper.activeTextEditor;
            if (activeTextEditor) {
                column = activeTextEditor.viewColumn;
            }
            let editor = await this._vscodeWrapper.showTextDocument(doc, {
                viewColumn: column,
                preserveFocus: false,
                preview: false,
            });
            let querySelection = new vscode.Selection(
                selection.startLine,
                selection.startColumn,
                selection.endLine,
                selection.endColumn,
            );
            editor.selection = querySelection;
            return;
        }
    }

    public getQueryString(uri: string): string {
        if (this._uriToQueryStringMap.has(uri)) {
            return this._uriToQueryStringMap.get(uri);
        }
        return undefined;
    }

    public resetHasCompleted(): void {
        this._hasCompleted = false;
    }

    // public for testing only - used to mock handleQueryComplete
    public setHasCompleted(): void {
        this._hasCompleted = true;
    }

    get totalElapsedMilliseconds(): number {
        return this._totalElapsedMilliseconds;
    }

    public updateQueryRunnerUri(oldUri: string, newUri: string): void {
        let queryConnectionUriChangeParams: QueryConnectionUriChangeParams = {
            newOwnerUri: newUri,
            originalOwnerUri: oldUri,
        };
        this._client.sendNotification(
            QueryConnectionUriChangeRequest.type,
            queryConnectionUriChangeParams,
        );
        this.uri = newUri;
    }

    /**
     * Add the column headers to the CSV string
     * @param copyString
     * @param batchId
     * @param resultId
     * @param selection
     * @param delimiter
     * @param textIdentifier
     * @returns
     */
    /**
     * Construct CSV string from row data
     * @param copyString
     * @param rowIdToRowMap
     * @param rowIdToSelectionMap
     * @param delimiter
     * @param textIdentifier
     * @param lineSeperator
     * @returns
     */
    /**
     * Construct JSON string from row data
     * @param rowIdToRowMap
     * @param rowIdToSelectionMap
     * @param batchId
     * @param resultId
     * @param includeHeaders
     * @returns
     */
    /**
     * Vscode core expects uri.fsPath for resourcePath context value.
     * https://github.com/microsoft/vscode/blob/bb5a3c607b14787009f8e9fadb720beee596133c/src/vs/workbench/common/contextkeys.ts#L275
     */

    /**
     * Add query to running queries list
     * @param ownerUri The owner URI of the query
     */
    private static addRunningQuery(ownerUri: string): void {
        const key = vscode.Uri.parse(ownerUri).fsPath;
        QueryRunner._runningQueries.push(key);
        QueryRunner.updateRunningQueries();
    }

    /**
     * Remove current query from running queries list
     */
    private removeRunningQuery(): void {
        QueryRunner._runningQueries = QueryRunner._runningQueries.filter(
            (fileName) => fileName !== vscode.Uri.parse(this._ownerUri).fsPath,
        );
        QueryRunner.updateRunningQueries();
    }

    private static updateRunningQueries() {
        vscode.commands.executeCommand(
            "setContext",
            "mssql.runningQueries",
            QueryRunner._runningQueries,
        );
    }

    private getTotalSelectedRows(selections: ISlickRange[]): number {
        // Keep copy order deterministic
        selections.sort((a, b) => a.fromRow - b.fromRow);
        let totalRows = 0;
        for (let range of selections) {
            totalRows += range.toRow - range.fromRow + 1;
        }
        return totalRows;
    }
}
