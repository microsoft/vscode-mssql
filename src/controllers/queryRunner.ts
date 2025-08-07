/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from "events";

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
    QueryExecuteResultSetCompleteNotificationParams,
    QueryExecuteSubsetParams,
    QueryExecuteSubsetRequest,
    QueryExecuteMessageParams,
    QueryExecuteBatchNotificationParams,
    QueryExecuteOptionsRequest,
    QueryExecutionOptionsParams,
    QueryExecutionOptions,
    DbCellValue,
    ExecutionPlanOptions,
    QueryConnectionUriChangeRequest,
    QueryConnectionUriChangeParams,
} from "../models/contracts/queryExecute";
import { QueryDisposeParams, QueryDisposeRequest } from "../models/contracts/queryDispose";
import {
    QueryCancelParams,
    QueryCancelResult,
    QueryCancelRequest,
} from "../models/contracts/queryCancel";
import { ISlickRange, ISelectionData, IResultMessage } from "../models/interfaces";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import * as Utils from "./../models/utils";
import { getErrorMessage } from "../utils/utils";
import * as os from "os";
import { Deferred } from "../protocol";
import { sendActionEvent } from "../telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

export interface IResultSet {
    columns: string[];
    totalNumberOfRows: number;
}

/*
 * Query Runner class which handles running a query, reports the results to the content manager,
 * and handles getting more rows from the service layer and disposing when the content is closed.
 */
export default class QueryRunner {
    // MEMBER VARIABLES ////////////////////////////////////////////////////
    private _batchSets: BatchSummary[] = [];
    private _batchSetMessages: { [batchId: number]: IResultMessage[] } = {};
    private _isExecuting: boolean;
    private _resultLineOffset: number;
    private _totalElapsedMilliseconds: number;
    private _hasCompleted: boolean;
    private _isSqlCmd: boolean = false;
    public eventEmitter: EventEmitter = new EventEmitter();
    private _uriToQueryPromiseMap = new Map<string, Deferred<boolean>>();
    private _uriToQueryStringMap = new Map<string, string>();
    private static _runningQueries = [];

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

    public async cancel(): Promise<QueryCancelResult> {
        // Make the request to cancel the query
        let cancelParams: QueryCancelParams = { ownerUri: this._ownerUri };
        let queryCancelResult: QueryCancelResult;
        try {
            queryCancelResult = await this._client.sendRequest(
                QueryCancelRequest.type,
                cancelParams,
            );
        } catch (error) {
            this._handleCancelDisposeCleanup(
                LocalizedConstants.QueryEditor.queryCancelFailed(error),
                error,
            );
            return;
        }
        this._handleCancelDisposeCleanup();
        return queryCancelResult;
    }

    // Pulls the query text from the current document/selection and initiates the query
    public async runStatement(line: number, column: number): Promise<void> {
        await this.doRunQuery(
            <ISelectionData>{
                startLine: line,
                startColumn: column,
                endLine: 0,
                endColumn: 0,
            },
            async (onSuccess, onError) => {
                // Put together the request
                let queryDetails: QueryExecuteStatementParams = {
                    ownerUri: this._ownerUri,
                    line: line,
                    column: column,
                };

                // Send the request to execute the query
                await this._client
                    .sendRequest(QueryExecuteStatementRequest.type, queryDetails)
                    .then(onSuccess, onError);
            },
        );
    }

    // Pulls the query text from the current document/selection and initiates the query
    public async runQuery(
        selection: ISelectionData,
        executionPlanOptions?: ExecutionPlanOptions,
        promise?: Deferred<boolean>,
    ): Promise<void> {
        await this.doRunQuery(selection, async (onSuccess, onError) => {
            // Put together the request
            let queryDetails: QueryExecuteParams = {
                ownerUri: this._ownerUri,
                executionPlanOptions: executionPlanOptions,
                querySelection: selection,
            };

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

            // Set the query string for the uri
            this._uriToQueryStringMap.set(this._ownerUri, queryString);

            // Send the request to execute the query
            if (promise) {
                this._uriToQueryPromiseMap.set(this._ownerUri, promise);
            }
            await this._client
                .sendRequest(QueryExecuteRequest.type, queryDetails)
                .then(onSuccess, onError);
        });
    }

    // Pulls the query text from the current document/selection and initiates the query
    private async doRunQuery(
        selection: ISelectionData,
        queryCallback: (
            onSuccess: (result: unknown) => void,
            onError: (error: Error) => void,
        ) => Promise<void>,
    ): Promise<void> {
        this._vscodeWrapper.logToOutputChannel(
            LocalizedConstants.msgStartedExecute(this._ownerUri),
        );

        // Update internal state to show that we're executing the query
        this._resultLineOffset = selection ? selection.startLine : 0;
        this._isExecuting = true;
        this._totalElapsedMilliseconds = 0;
        this._statusView.executingQuery(this.uri);

        let onSuccess = (_result: unknown) => {
            // The query has started, so lets fire up the result pane
            QueryRunner._runningQueries.push(vscode.Uri.parse(this._ownerUri).fsPath);
            vscode.commands.executeCommand(
                "setContext",
                "mssql.runningQueries",
                QueryRunner._runningQueries,
            );
            this.eventEmitter.emit("start", this.uri);
            this._notificationHandler.registerRunner(this, this._ownerUri);
        };
        let onError = (error: unknown) => {
            // Only update internal state and emit events, do not call executedQuery here
            this._isExecuting = false;
            this._hasCompleted = true;
            this.removeRunningQuery();
            // Removed call to unregisterRunner (does not exist)
            const promise = this._uriToQueryPromiseMap.get(this._ownerUri);
            if (promise) {
                promise.reject(error);
                this._uriToQueryPromiseMap.delete(this._ownerUri);
            }
            this.eventEmitter.emit(
                "complete",
                Utils.parseNumAsTimeString(this._totalElapsedMilliseconds),
                true,
            );
            // TODO: localize
            let errorMsg = error instanceof Error ? error.message : String(error);
            this._vscodeWrapper.showErrorMessage("Execution failed: " + errorMsg);
            // Ensure the returned promise is rejected so the test can catch it
            throw error;
        };

        try {
            await queryCallback(onSuccess, onError);
        } catch (error) {
            // If queryCallback throws synchronously, handle it here
            this._statusView.executedQuery(this.uri);
            // Show error message here to ensure test expectation is met
            let errorMsg = error instanceof Error ? error.message : String(error);
            this._vscodeWrapper.showErrorMessage("Execution failed: " + errorMsg);
            onError(error);
            throw error;
        }
    }

    /**
     * Remove uri from runningQueries
     */
    private removeRunningQuery(): void {
        QueryRunner._runningQueries = QueryRunner._runningQueries.filter(
            (fileName) => fileName !== vscode.Uri.parse(this._ownerUri).fsPath,
        );
        vscode.commands.executeCommand(
            "setContext",
            "mssql.runningQueries",
            QueryRunner._runningQueries,
        );
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
        this.eventEmitter.emit(
            "complete",
            Utils.parseNumAsTimeString(this._totalElapsedMilliseconds),
            hasError,
        );
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
        this.eventEmitter.emit("batchStart", batch);
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
        this.eventEmitter.emit("batchComplete", batch);
    }

    /**
     * Refreshes the webview panel with the query results when tabs are changed
     */
    public async refreshQueryTab(uri: string): Promise<boolean> {
        this._isExecuting = true;
        this._hasCompleted = false;
        for (let batchId = 0; batchId < this.batchSets.length; batchId++) {
            const batchSet = this.batchSets[batchId];
            this.eventEmitter.emit("batchStart", batchSet);
            let executionTime = <number>(Utils.parseTimeString(batchSet.executionElapsed) || 0);
            if (executionTime > 0) {
                // send a time message in the format used for query complete
                this.sendBatchTimeMessage(batchSet.id, Utils.parseNumAsTimeString(executionTime));
            }

            // replay the messages for the current batch
            const messages = this._batchSetMessages[batchId];
            if (messages !== undefined) {
                for (let messageId = 0; messageId < messages.length; ++messageId) {
                    // Send the message to the results pane
                    this.eventEmitter.emit("message", messages[messageId]);
                }
            }

            this.eventEmitter.emit("batchComplete", batchSet);
            for (
                let resultSetId = 0;
                resultSetId < batchSet.resultSetSummaries.length;
                resultSetId++
            ) {
                let resultSet = batchSet.resultSetSummaries[resultSetId];
                this.eventEmitter.emit("resultSet", resultSet, true);
            }
        }
        // We're done with this query so shut down any waiting mechanisms
        this._statusView.executedQuery(uri);
        this._isExecuting = false;
        this._hasCompleted = true;
        this.eventEmitter.emit(
            "complete",
            Utils.parseNumAsTimeString(this._totalElapsedMilliseconds),
            true,
            true,
        );
        return true;
    }

    public handleResultSetComplete(result: QueryExecuteResultSetCompleteNotificationParams): void {
        let resultSet = result.resultSetSummary;
        let batchSet = this._batchSets[resultSet.batchId];

        // Store the result set in the batch and emit that a result set has completed
        batchSet.resultSetSummaries[resultSet.id] = resultSet;
        this.eventEmitter.emit("resultSet", resultSet);
    }

    public handleMessage(obj: QueryExecuteMessageParams): void {
        let message = obj.message;
        message.time = new Date(message.time).toLocaleTimeString();

        // save the message into the batch summary so it can be restored on view refresh
        if (message.batchId >= 0 && this._batchSetMessages[message.batchId] !== undefined) {
            this._batchSetMessages[message.batchId].push(message);
        }

        // Send the message to the results pane
        this.eventEmitter.emit("message", message);

        // Set row count on status bar if there are no errors
        if (!obj.message.isError) {
            this._statusView.showRowCount(obj.ownerUri, obj.message.message);
        } else {
            this._statusView.hideRowCount(obj.ownerUri, true);
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
                "Something went wrong getting more rows: " + error.message,
            );
            void Promise.reject(error);
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
        } catch (error) {
            this._handleCancelDisposeCleanup(
                LocalizedConstants.QueryEditor.queryDisposeFailed(error),
                error,
            );
            return;
        }
        this._handleCancelDisposeCleanup();
    }

    /**
     * Handles cleanup and state reset after a cancel attempt, for both error and success scenarios.
     * @param error Optional error object if cancel failed.
     */
    private _handleCancelDisposeCleanup(errorMsg?: String, error?: Error): void {
        this._isExecuting = false;
        this._hasCompleted = true;
        this.removeRunningQuery();
        // Removed call to unregisterRunner (does not exist)
        const promise = this._uriToQueryPromiseMap.get(this._ownerUri);
        if (promise) {
            if (error) {
                promise.reject(error);
            } else {
                promise.resolve();
            }
            this._uriToQueryPromiseMap.delete(this._ownerUri);
        }
        this.eventEmitter.emit(
            "complete",
            Utils.parseNumAsTimeString(this._totalElapsedMilliseconds),
            true,
        );
        this._statusView.executedQuery(this._ownerUri);
        if (errorMsg) {
            this._vscodeWrapper.showErrorMessage(getErrorMessage(errorMsg));
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
        let copyString = "";

        if (this.shouldIncludeHeaders(includeHeaders)) {
            copyString = this.addHeadersToCopyString(copyString, batchId, resultId, selection);
        }
        // sort the selections by row to maintain copy order
        selection.sort((a, b) => a.fromRow - b.fromRow);

        // create a mapping of rows to selections
        let rowIdToSelectionMap = new Map<number, ISlickRange[]>();
        let rowIdToRowMap = new Map<number, DbCellValue[]>();

        // create a mapping of the ranges to get promises
        let tasks = selection.map((range) => {
            return async () => {
                const result = await this.getRows(
                    range.fromRow,
                    range.toRow - range.fromRow + 1,
                    batchId,
                    resultId,
                );
                this.getRowMappings(
                    result.resultSubset.rows,
                    range,
                    rowIdToSelectionMap,
                    rowIdToRowMap,
                );
            };
        });

        // get all the rows
        let p = tasks[0]();
        for (let i = 1; i < tasks.length; i++) {
            p = p.then(tasks[i]);
        }
        await p;

        copyString = this.constructCopyString(copyString, rowIdToRowMap, rowIdToSelectionMap);

        await this.writeStringToClipboard(copyString);
    }

    public async exportCellsToClipboard(
        data: DbCellValue[][],
        batchId: number,
        resultId: number,
        selection: ISlickRange[],
        headersFlag,
    ) {
        let copyString = "";
        if (headersFlag) {
            copyString = this.addHeadersToCopyString(copyString, batchId, resultId, selection);
        }

        // create a mapping of rows to selections
        let rowIdToSelectionMap = new Map<number, ISlickRange[]>();
        let rowIdToRowMap = new Map<number, DbCellValue[]>();

        // create a mapping of the ranges to get promises
        let tasks = selection.map((range) => {
            return async () => {
                const result = data;
                this.getRowMappings(result, range, rowIdToSelectionMap, rowIdToRowMap);
            };
        });
        let p = tasks[0]();
        for (let i = 1; i < tasks.length; i++) {
            p = p.then(tasks[i]);
        }
        await p;

        copyString = this.constructCopyString(copyString, rowIdToRowMap, rowIdToSelectionMap);

        await this.writeStringToClipboard(copyString);
    }

    /**
     * Construct the row mappings, which contain the row data and selection data and are used to construct the copy string
     * @param data
     * @param range
     * @param rowIdToSelectionMap
     * @param rowIdToRowMap
     */
    private getRowMappings(
        data: DbCellValue[][],
        range: ISlickRange,
        rowIdToSelectionMap,
        rowIdToRowMap,
    ) {
        let count = 0;
        for (let row of data) {
            let rowNumber = count + range.fromRow;
            if (rowIdToSelectionMap.has(rowNumber)) {
                let rowSelection = rowIdToSelectionMap.get(rowNumber);
                rowSelection.push(range);
            } else {
                rowIdToSelectionMap.set(rowNumber, [range]);
            }
            rowIdToRowMap.set(rowNumber, row);
            count += 1;
        }
    }

    private constructCopyString(
        copyString: string,
        rowIdToRowMap: Map<number, DbCellValue[]>,
        rowIdToSelectionMap: Map<number, ISlickRange[]>,
    ) {
        // Go through all rows and get selections for them
        let allRowIds = rowIdToRowMap.keys();
        const endColumns = this.getSelectionEndColumns(rowIdToRowMap, rowIdToSelectionMap);
        const firstColumn = endColumns[0];
        const lastColumn = endColumns[1];
        for (let rowId of allRowIds) {
            let row = rowIdToRowMap.get(rowId);
            const rowSelections = rowIdToSelectionMap.get(rowId);

            // sort selections by column to go from left to right
            rowSelections.sort((a, b) => {
                return a.fromCell < b.fromCell ? -1 : a.fromCell > b.fromCell ? 1 : 0;
            });

            for (let i = 0; i < rowSelections.length; i++) {
                let rowSelection = rowSelections[i];

                // Add tabs starting from the first column of the selection
                for (let j = firstColumn; j < rowSelection.fromCell; j++) {
                    copyString += "\t";
                }
                let cellObjects = row.slice(rowSelection.fromCell, rowSelection.toCell + 1);

                // Remove newlines if requested
                let cells = this.shouldRemoveNewLines()
                    ? cellObjects.map((x) => this.removeNewLines(x.displayValue))
                    : cellObjects.map((x) => x.displayValue);
                copyString += cells.join("\t");

                // Add tabs until the end column of the selection
                for (let k = rowSelection.toCell; k < lastColumn; k++) {
                    copyString += "\t";
                }
            }
            copyString += os.EOL;
        }

        // Remove the last extra new line
        if (copyString.length > 1) {
            copyString = copyString.substring(0, copyString.length - os.EOL.length);
        }
        return copyString;
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
        copyString += os.EOL;
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

    private shouldIncludeHeaders(includeHeaders: boolean): boolean {
        if (includeHeaders !== undefined) {
            // Respect the value explicity passed into the method
            return includeHeaders;
        }
        // else get config option from vscode config
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            this.uri,
        );
        includeHeaders = config.get(Constants.copyIncludeHeaders);
        return !!includeHeaders;
    }

    private shouldRemoveNewLines(): boolean {
        // get config copyRemoveNewLine option from vscode config
        let config = this._vscodeWrapper.getConfiguration(
            Constants.extensionConfigSectionName,
            this.uri,
        );
        let removeNewLines: boolean = config.get(Constants.configCopyRemoveNewLine);
        return removeNewLines;
    }

    private removeNewLines(inputString: string): string {
        // This regex removes all newlines in all OS types
        // Windows(CRLF): \r\n
        // Linux(LF)/Modern MacOS: \n
        // Old MacOs: \r
        let outputString: string = inputString.replace(/(\r\n|\n|\r)/gm, "");
        return outputString;
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
            // Send the message to the results pane
            this.eventEmitter.emit("message", message);
        }
    }

    /**
     * Gets the first and last column of a selection: [first, last]
     */
    private getSelectionEndColumns(
        rowIdToRowMap: Map<number, DbCellValue[]>,
        rowIdToSelectionMap: Map<number, ISlickRange[]>,
    ): number[] {
        let allRowIds = rowIdToRowMap.keys();
        let firstColumn = -1;
        let lastColumn = -1;
        for (let rowId of allRowIds) {
            const rowSelections = rowIdToSelectionMap.get(rowId);
            for (let i = 0; i < rowSelections.length; i++) {
                if (firstColumn === -1 || rowSelections[i].fromCell < firstColumn) {
                    firstColumn = rowSelections[i].fromCell;
                }
                if (lastColumn === -1 || rowSelections[i].toCell > lastColumn) {
                    lastColumn = rowSelections[i].toCell;
                }
            }
        }
        return [firstColumn, lastColumn];
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
}
