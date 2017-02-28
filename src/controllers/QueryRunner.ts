'use strict';
import { EventEmitter } from 'events';

import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import {QueryNotificationHandler} from './QueryNotificationHandler';
import VscodeWrapper from './vscodeWrapper';
import { BatchSummary, QueryExecuteParams, QueryExecuteRequest,
    QueryExecuteCompleteNotificationResult, QueryExecuteSubsetResult,
    QueryExecuteResultSetCompleteNotificationParams,
    QueryExecuteSubsetParams, QueryExecuteSubsetRequest,
    QueryExecuteMessageParams,
    QueryExecuteBatchNotificationParams } from '../models/contracts/queryExecute';
import { QueryDisposeParams, QueryDisposeRequest } from '../models/contracts/QueryDispose';
import { QueryCancelParams, QueryCancelResult, QueryCancelRequest } from '../models/contracts/QueryCancel';
import { ISlickRange, ISelectionData } from '../models/interfaces';
import Constants = require('../constants/constants');
import LocalizedConstants = require('../constants/localizedConstants');
import * as Utils from './../models/utils';
import * as os from 'os';

const ncp = require('copy-paste');

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
    private _uri: string;
    private _title: string;
    private _resultLineOffset: number;
    private _totalElapsedMilliseconds: number;
    private _hasCompleted: boolean;
    public eventEmitter: EventEmitter = new EventEmitter();

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
        this._uri = _ownerUri;
        this._title = _editorTitle;
        this._isExecuting = false;
        this._totalElapsedMilliseconds = 0;
        this._hasCompleted = false;
    }

    // PROPERTIES //////////////////////////////////////////////////////////

    get uri(): string {
        return this._uri;
    }

    set uri(uri: string) {
        this._uri = uri;
    }

    get title(): string {
        return this._title;
    }

    set title(title: string) {
        this._title = title;
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

    // PUBLIC METHODS ======================================================

    public cancel(): Thenable<QueryCancelResult> {
        // Make the request to cancel the query
        let cancelParams: QueryCancelParams = { ownerUri: this._uri };
        return this._client.sendRequest(QueryCancelRequest.type, cancelParams);
    }

    // Pulls the query text from the current document/selection and initiates the query
    public runQuery(selection: ISelectionData): Thenable<void> {
        const self = this;
        this._vscodeWrapper.logToOutputChannel(Utils.formatString(LocalizedConstants.msgStartedExecute, this._uri));

        // Put together the request
        let queryDetails: QueryExecuteParams = {
            ownerUri: this._uri,
            querySelection: selection
        };

        // Update internal state to show that we're executing the query
        this._resultLineOffset = selection ? selection.startLine : 0;
        this._isExecuting = true;
        this._totalElapsedMilliseconds = 0;
        this._statusView.executingQuery(this.uri);

        // Send the request to execute the query
        return this._client.sendRequest(QueryExecuteRequest.type, queryDetails).then(result => {
            // The query has started, so lets fire up the result pane
            self.eventEmitter.emit('start');
            self._notificationHandler.registerRunner(self, queryDetails.ownerUri);
        }, error => {
            // Attempting to launch the query failed, show the error message
            self._statusView.executedQuery(self.uri);
            self._isExecuting = false;
            self._vscodeWrapper.showErrorMessage('Execution failed: ' + error);
        });
    }

    // handle the result of the notification
    public handleQueryComplete(result: QueryExecuteCompleteNotificationResult): void {
        this._vscodeWrapper.logToOutputChannel(Utils.formatString(LocalizedConstants.msgFinishedExecute, this._uri));

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
        this._statusView.executedQuery(this.uri);
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
        this._totalElapsedMilliseconds += <number>(Utils.parseTimeString(batch.executionElapsed) || 0);
        this.eventEmitter.emit('batchComplete', batch);
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

    // get more data rows from the current resultSets from the service layer
    public getRows(rowStart: number, numberOfRows: number, batchIndex: number, resultSetIndex: number): Thenable<QueryExecuteSubsetResult> {
        const self = this;
        let queryDetails = new QueryExecuteSubsetParams();
        queryDetails.ownerUri = this.uri;
        queryDetails.resultSetIndex = resultSetIndex;
        queryDetails.rowsCount = numberOfRows;
        queryDetails.rowsStartIndex = rowStart;
        queryDetails.batchIndex = batchIndex;
        return new Promise<QueryExecuteSubsetResult>((resolve, reject) => {
            self._client.sendRequest(QueryExecuteSubsetRequest.type, queryDetails).then(result => {
                if (result.message) {
                    self._vscodeWrapper.showErrorMessage('Something went wrong getting more rows: ' + result.message);
                    reject();
                } else {
                    resolve(result);
                }
            });
        });
    }

    /**
     * Disposes the Query from the service client
     * @returns A promise that will be rejected if a problem occured
     */
    public dispose(): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            let disposeDetails = new QueryDisposeParams();
            disposeDetails.ownerUri = self.uri;
            self._client.sendRequest(QueryDisposeRequest.type, disposeDetails).then(result => {
                resolve();
            }, error => {
                self._vscodeWrapper.showErrorMessage('Failed disposing query: ' + error);
                reject();
            });
        });
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
    public copyResults(selection: ISlickRange[], batchId: number, resultId: number, includeHeaders?: boolean): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            let copyString = '';

            // create a mapping of the ranges to get promises
            let tasks = selection.map((range, i) => {
                return () => {
                    return self.getRows(range.fromRow, range.toRow - range.fromRow + 1, batchId, resultId).then((result) => {
                        if (self.shouldIncludeHeaders(includeHeaders)) {
                            let columnHeaders = self.getColumnHeaders(batchId, resultId, range);
                            if (columnHeaders !== undefined) {
                                copyString += columnHeaders.join('\t') + os.EOL;
                            }
                        }

                        // Iterate over the rows to paste into the copy string
                        for (let rowIndex: number = 0; rowIndex < result.resultSubset.rows.length; rowIndex++) {
                            let row = result.resultSubset.rows[rowIndex];
                            let cells = row.slice(range.fromCell, (range.toCell + 1));
                            if (self.shouldRemoveNewLines()) {
                                // Remove all new lines from cells
                                cells = cells.map(x => self.removeNewLines(x));
                            }
                            copyString += cells.join('\t');
                            if (rowIndex < result.resultSubset.rows.length - 1) {
                                copyString += os.EOL;
                            }
                        }
                    });
                };
            });

            let p = tasks[0]();
            for (let i = 1; i < tasks.length; i++) {
                p = p.then(tasks[i]);
            }
            p.then(() => {
                ncp.copy(copyString, () => {
                    resolve();
                });
            });
        });
    }

    private shouldIncludeHeaders(includeHeaders: boolean): boolean {
        if (includeHeaders !== undefined) {
            // Respect the value explicity passed into the method
            return includeHeaders;
        }
        // else get config option from vscode config
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
        includeHeaders = config[Constants.copyIncludeHeaders];
        return !!includeHeaders;
    }

    private shouldRemoveNewLines(): boolean {
        // get config copyRemoveNewLine option from vscode config
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
        let removeNewLines: boolean = config[Constants.configCopyRemoveNewLine];
        return removeNewLines;
    }

    private removeNewLines(inputString: string): string {
        // This regex removes all newlines in all OS types
        // Windows(CRLF): \r\n
        // Linux(LF)/Modern MacOS: \n
        // Old MacOs: \r
        if (!inputString) {
            return 'null';
        }

        let outputString: string = inputString.replace(/(\r\n|\n|\r)/gm, '');
        return outputString;
    }

    /**
     * Sets a selection range in the editor for this query
     * @param selection The selection range to select
     */
    public setEditorSelection(selection: ISelectionData): Thenable<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            self._vscodeWrapper.openTextDocument(self._vscodeWrapper.parseUri(self.uri)).then((doc) => {
                self._vscodeWrapper.showTextDocument(doc).then((editor) => {
                    editor.selection = self._vscodeWrapper.selection(
                                    self._vscodeWrapper.position(selection.startLine, selection.startColumn),
                                    self._vscodeWrapper.position(selection.endLine, selection.endColumn));
                    resolve();
                });
            });
        });
    }

    public resetHasCompleted(): void {
        this._hasCompleted = false;
    }

    // public for testing only - used to mock handleQueryComplete
    public _setHasCompleted(): void {
        this._hasCompleted = true;
    }

    get totalElapsedMilliseconds(): number {
        return this._totalElapsedMilliseconds;
    }
}
