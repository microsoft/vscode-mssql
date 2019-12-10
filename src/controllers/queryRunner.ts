/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import { EventEmitter } from 'events';

import * as vscode from 'vscode';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import {QueryNotificationHandler} from './queryNotificationHandler';
import VscodeWrapper from './vscodeWrapper';
import { BatchSummary, QueryExecuteParams, QueryExecuteRequest,
    QueryExecuteStatementParams, QueryExecuteStatementRequest,
    QueryExecuteCompleteNotificationResult, QueryExecuteSubsetResult,
    QueryExecuteResultSetCompleteNotificationParams,
    QueryExecuteSubsetParams, QueryExecuteSubsetRequest,
    QueryExecuteMessageParams,
    QueryExecuteBatchNotificationParams,
    QueryExecuteOptionsRequest,
    QueryExecutionOptionsParams,
    QueryExecutionOptions,
    DbCellValue} from '../models/contracts/queryExecute';
import { QueryDisposeParams, QueryDisposeRequest } from '../models/contracts/queryDispose';
import { QueryCancelParams, QueryCancelResult, QueryCancelRequest } from '../models/contracts/queryCancel';
import { ISlickRange, ISelectionData, IResultMessage } from '../models/interfaces';
import Constants = require('../constants/constants');
import LocalizedConstants = require('../constants/localizedConstants');
import * as Utils from './../models/utils';
import * as os from 'os';
import { Deferred } from '../protocol';

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
    private _isExecuting: boolean;
    private _resultLineOffset: number;
    private _totalElapsedMilliseconds: number;
    private _hasCompleted: boolean;
    private _isSqlCmd: boolean = false;
    public eventEmitter: EventEmitter = new EventEmitter();
    private _uriToQueryPromiseMap = new Map<string, Deferred<boolean>>();

    // CONSTRUCTOR /////////////////////////////////////////////////////////

    constructor(private _ownerUri: string,
                private _editorTitle: string,
                private _statusView: StatusView,
                private _client?: SqlToolsServerClient,
                private _notificationHandler?: QueryNotificationHandler,
                private _vscodeWrapper?: VscodeWrapper) {

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

    get isExecutingQuery(): boolean {
        return this._isExecuting;
    }

    get hasCompleted(): boolean {
        return this._hasCompleted;
    }

    get isSqlCmd(): boolean {
        return this._isSqlCmd;
    }

    set isSqlCmd(value: boolean) {
        this._isSqlCmd = value;
    }

    set hasCompleted(value: boolean) {
        this._hasCompleted = value;
    }

    // PUBLIC METHODS ======================================================

    public async cancel(): Promise<QueryCancelResult> {
        // Make the request to cancel the query
        let cancelParams: QueryCancelParams = { ownerUri: this._ownerUri };
        let queryCancelResult = await this._client.sendRequest(QueryCancelRequest.type, cancelParams);
        return queryCancelResult;
    }

    // Pulls the query text from the current document/selection and initiates the query
    public async runStatement(line: number, column: number): Promise<void> {
        await this.doRunQuery(
            <ISelectionData>{ startLine: line, startColumn: column, endLine: 0, endColumn: 0 },
            async (onSuccess, onError) => {
                // Put together the request
                let queryDetails: QueryExecuteStatementParams = {
                    ownerUri: this._ownerUri,
                    line: line,
                    column: column
                };

                // Send the request to execute the query
                await this._client.sendRequest(QueryExecuteStatementRequest.type, queryDetails).then(onSuccess, onError);
            });
    }

    // Pulls the query text from the current document/selection and initiates the query
    public async runQuery(selection: ISelectionData, promise?: Deferred<boolean>): Promise<void> {
        await this.doRunQuery(
            selection,
            async (onSuccess, onError) => {
               // Put together the request
                let queryDetails: QueryExecuteParams = {
                    ownerUri: this._ownerUri,
                    querySelection: selection
                };

                // Send the request to execute the query
                if (promise) {
                    this._uriToQueryPromiseMap.set(this._ownerUri, promise);
                }
                await this._client.sendRequest(QueryExecuteRequest.type, queryDetails).then(onSuccess, onError);
            });
    }

    // Pulls the query text from the current document/selection and initiates the query
    private async doRunQuery(selection: ISelectionData, queryCallback: any): Promise<void> {
        this._vscodeWrapper.logToOutputChannel(Utils.formatString(LocalizedConstants.msgStartedExecute, this._ownerUri));

        // Update internal state to show that we're executing the query
        this._resultLineOffset = selection ? selection.startLine : 0;
        this._isExecuting = true;
        this._totalElapsedMilliseconds = 0;
        this._statusView.executingQuery(this.uri);

        let onSuccess = (result) => {
            // The query has started, so lets fire up the result pane
            this.eventEmitter.emit('start', this.uri);
            this._notificationHandler.registerRunner(this, this._ownerUri);
        };
        let onError = (error) => {
            this._statusView.executedQuery(this.uri);
            this._isExecuting = false;
            // TODO: localize
            this._vscodeWrapper.showErrorMessage('Execution failed: ' + error.message);
        };

        await queryCallback(onSuccess, onError);
    }

    // handle the result of the notification
    public handleQueryComplete(result: QueryExecuteCompleteNotificationResult): void {
        this._vscodeWrapper.logToOutputChannel(Utils.formatString(LocalizedConstants.msgFinishedExecute, this._ownerUri));

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
        this.eventEmitter.emit('complete', Utils.parseNumAsTimeString(this._totalElapsedMilliseconds));
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

        // Store the batch
        this._batchSets[batch.id] = batch;
        this.eventEmitter.emit('batchStart', batch);
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
        this.eventEmitter.emit('batchComplete', batch);
    }

    /**
     * Refreshes the webview panel with the query results when tabs are changed
     */
    public async refreshQueryTab(uri: string): Promise<boolean> {
        this._isExecuting = true;
        this._hasCompleted = false;
        for (let batchId = 0; batchId < this.batchSets.length; batchId++) {
            const batchSet = this.batchSets[batchId];
            this.eventEmitter.emit('batchStart', batchSet);
            let executionTime = <number>(Utils.parseTimeString(batchSet.executionElapsed) || 0);
            this._totalElapsedMilliseconds += executionTime;
            if (executionTime > 0) {
                // send a time message in the format used for query complete
                this.sendBatchTimeMessage(batchSet.id, Utils.parseNumAsTimeString(executionTime));
            }
            this.eventEmitter.emit('batchComplete', batchSet);
            for (let resultSetId = 0; resultSetId < batchSet.resultSetSummaries.length; resultSetId++) {
                let resultSet = batchSet.resultSetSummaries[resultSetId];
                this.eventEmitter.emit('resultSet', resultSet, true);
            }
        }
        // We're done with this query so shut down any waiting mechanisms
        this._statusView.executedQuery(uri);
        this._isExecuting = false;
        this._hasCompleted = true;
        this.eventEmitter.emit('complete', Utils.parseNumAsTimeString(this._totalElapsedMilliseconds), true);
        return true;
    }

    public handleResultSetComplete(result: QueryExecuteResultSetCompleteNotificationParams): void {
        let resultSet = result.resultSetSummary;
        let batchSet = this._batchSets[resultSet.batchId];

        // Store the result set in the batch and emit that a result set has completed
        batchSet.resultSetSummaries[resultSet.id] = resultSet;
        this.eventEmitter.emit('resultSet', resultSet);
    }

    public handleMessage(obj: QueryExecuteMessageParams): void {
        let message = obj.message;
        message.time = new Date(message.time).toLocaleTimeString();

        // Send the message to the results pane
        this.eventEmitter.emit('message', message);
    }

    /*
     * Get more data rows from the current resultSets from the service layer
     */
    public async getRows(rowStart: number, numberOfRows: number, batchIndex: number, resultSetIndex: number): Promise<QueryExecuteSubsetResult> {
        let queryDetails = new QueryExecuteSubsetParams();
        queryDetails.ownerUri = this.uri;
        queryDetails.resultSetIndex = resultSetIndex;
        queryDetails.rowsCount = numberOfRows;
        queryDetails.rowsStartIndex = rowStart;
        queryDetails.batchIndex = batchIndex;
        try {
            const queryExecuteSubsetResult = await this._client.sendRequest(QueryExecuteSubsetRequest.type, queryDetails);
            if (queryExecuteSubsetResult) {
                return queryExecuteSubsetResult;
            }
        } catch (error) {
            // TODO: Localize
            this._vscodeWrapper.showErrorMessage('Something went wrong getting more rows: ' + error.message);
            Promise.reject(error);
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
            // TODO: Localize
            this._vscodeWrapper.showErrorMessage('Failed disposing query: ' + error.message);
            Promise.reject(error);
        }
    }

    private getColumnHeaders(batchId: number, resultId: number, range: ISlickRange): string[] {
        let headers: string[] = undefined;
        let batchSummary: BatchSummary = this.batchSets[batchId];
        if (batchSummary !== undefined) {
            let resultSetSummary = batchSummary.resultSetSummaries[resultId];
            headers = resultSetSummary.columnInfo.slice(range.fromCell, range.toCell + 1).map((info, i) => {
                return info.columnName;
            });
        }
        return headers;
    }

    /**
     * Copy the result range to the system clip-board
     * @param selection The selection range array to copy
     * @param batchId The id of the batch to copy from
     * @param resultId The id of the result to copy from
     * @param includeHeaders [Optional]: Should column headers be included in the copy selection
     */
    public async copyResults(selection: ISlickRange[], batchId: number, resultId: number, includeHeaders?: boolean): Promise<void> {
        let copyString = '';

        // add the column headers
        if (this.shouldIncludeHeaders(includeHeaders)) {
            let firstCol: number;
            let lastCol: number;
            for (let range of selection) {
                if (firstCol === undefined || (range.fromCell < firstCol)) {
                    firstCol = range.fromCell;
                }
                if (lastCol === undefined || (range.toCell > lastCol)) {
                    lastCol = range.toCell;
                }
            }
            let columnRange: ISlickRange = {
                fromCell: firstCol,
                toCell: lastCol,
                fromRow: undefined,
                toRow: undefined
            };
            let columnHeaders = this.getColumnHeaders(batchId, resultId, columnRange);
            copyString += columnHeaders.join('\t');
            copyString += os.EOL;
        }

        // sort the selections by row to maintain copy order
        selection.sort((a, b) => a.fromRow - b.fromRow);

        // create a mapping of rows to selections
        let rowIdToSelectionMap = new Map<number, ISlickRange[]>();
        let rowIdToRowMap = new Map<number, DbCellValue[]>();

        // create a mapping of the ranges to get promises
        let tasks = selection.map((range) => {
            return async () => {
                const result = await this.getRows(range.fromRow, range.toRow - range.fromRow + 1, batchId, resultId);
                for (let row of result.resultSubset.rows) {
                    let rowNumber = row[0].rowId + range.fromRow;
                    if (rowIdToSelectionMap.has(rowNumber)) {
                        let rowSelection = rowIdToSelectionMap.get(rowNumber);
                        rowSelection.push(range);
                    } else {
                        rowIdToSelectionMap.set(rowNumber, [range]);
                    }
                    rowIdToRowMap.set(rowNumber, row);
                }
            };
        });

        // get all the rows
        let p = tasks[0]();
        for (let i = 1; i < tasks.length; i++) {
            p = p.then(tasks[i]);
        }
        await p;

        // Go through all rows and get selections for them
        let allRowIds = rowIdToRowMap.keys();
        for (let rowId of allRowIds) {
            let row = rowIdToRowMap.get(rowId);
            const rowSelections = rowIdToSelectionMap.get(rowId);
            for (let i = 0; i < rowSelections.length; i++) {
                let rowSelection = rowSelections[i];
                for (let j = 0; j < rowSelection.fromCell; j++) {
                    copyString += ' \t';
                }
                let cellObjects = row.slice(rowSelection.fromCell, (rowSelection.toCell + 1));
                // Remove newlines if requested
                let cells = this.shouldRemoveNewLines()
                ? cellObjects.map(x => this.removeNewLines(x.displayValue))
                : cellObjects.map(x => x.displayValue);
                copyString += cells.join('\t');
            }
            copyString += os.EOL;
        }

        // Remove the last extra new line
        if (copyString.length > 1) {
            copyString = copyString.substring(0, copyString.length - os.EOL.length);
        }

        let oldLang: string;
        if (process.platform === 'darwin') {
            oldLang = process.env['LANG'];
            process.env['LANG'] = 'en_US.UTF-8';
        }
        await this._vscodeWrapper.clipboardWriteText(copyString);
        if (process.platform === 'darwin') {
            process.env['LANG'] = oldLang;
        }
    }


    public async toggleSqlCmd(): Promise<boolean> {
        const queryExecuteOptions: QueryExecutionOptions = { options: {} };
        queryExecuteOptions.options['isSqlCmdMode'] = !this.isSqlCmd;
        const queryExecuteOptionsParams: QueryExecutionOptionsParams = {
            ownerUri: this.uri,
            options: queryExecuteOptions
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
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName, this.uri);
        includeHeaders = config.get(Constants.copyIncludeHeaders);
        return !!includeHeaders;
    }

    private shouldRemoveNewLines(): boolean {
        // get config copyRemoveNewLine option from vscode config
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName, this.uri);
        let removeNewLines: boolean = config.get(Constants.configCopyRemoveNewLine);
        return removeNewLines;
    }

    private removeNewLines(inputString: string): string {
        // This regex removes all newlines in all OS types
        // Windows(CRLF): \r\n
        // Linux(LF)/Modern MacOS: \n
        // Old MacOs: \r
        let outputString: string = inputString.replace(/(\r\n|\n|\r)/gm, '');
        return outputString;
    }

    private sendBatchTimeMessage(batchId: number, executionTime: string): void {
        // get config copyRemoveNewLine option from vscode config
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName, this.uri);
        let showBatchTime: boolean = config.get(Constants.configShowBatchTime);
        if (showBatchTime) {
            let message: IResultMessage = {
                batchId: batchId,
                message: Utils.formatString(LocalizedConstants.elapsedBatchTime, executionTime),
                time: undefined,
                isError: false
            };
            // Send the message to the results pane
            this.eventEmitter.emit('message', message);
        }
    }

    /**
     * Sets a selection range in the editor for this query
     * @param selection The selection range to select
     */
    public async setEditorSelection(selection: ISelectionData): Promise<void> {
        const docExists = this._vscodeWrapper.textDocuments.find(textDoc => textDoc.uri.toString(true) === this.uri);
        if (docExists) {
            let column = vscode.ViewColumn.One;
            const doc = await this._vscodeWrapper.openTextDocument(this._vscodeWrapper.parseUri(this.uri));
            const activeTextEditor = this._vscodeWrapper.activeTextEditor;
            if (activeTextEditor) {
                column = activeTextEditor.viewColumn;
            }
            let editor = await this._vscodeWrapper.showTextDocument(doc,
            {
                viewColumn: column,
                preserveFocus: false,
                preview: false
            });
            let querySelection = new vscode.Selection(
                selection.startLine,
                selection.startColumn,
                selection.endLine,
                selection.endColumn);
            editor.selection = querySelection;
            return;
        }
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
}
