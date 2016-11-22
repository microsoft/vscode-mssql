'use strict';
import { EventEmitter } from 'events';

import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import {QueryNotificationHandler} from './QueryNotificationHandler';
import VscodeWrapper from './vscodeWrapper';
import { BatchSummary, QueryExecuteParams, QueryExecuteRequest,
    QueryExecuteCompleteNotificationResult, QueryExecuteSubsetResult,
    QueryExecuteSubsetParams, QueryDisposeParams, QueryExecuteSubsetRequest,
    QueryDisposeRequest, QueryExecuteBatchCompleteNotificationResult } from '../models/contracts/queryExecute';
import { QueryCancelParams, QueryCancelResult, QueryCancelRequest } from '../models/contracts/QueryCancel';
import { ISlickRange, ISelectionData } from '../models/interfaces';
import Constants = require('../models/constants');
import * as Utils from './../models/utils';

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
    private _batchSetsPromise: Promise<BatchSummary[]>;
    public batchResult: EventEmitter = new EventEmitter();
    public dataResolveReject;

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

    getBatchSets(): Promise<BatchSummary[]> {
        return this._batchSetsPromise;
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

    // PUBLIC METHODS ======================================================

    public cancel(): Thenable<QueryCancelResult> {
        // Make the request to cancel the query
        let cancelParams: QueryCancelParams = { ownerUri: this._uri };
        return this._client.sendRequest(QueryCancelRequest.type, cancelParams);
    }

    // Pulls the query text from the current document/selection and initiates the query
    public runQuery(selection: ISelectionData): Thenable<void> {
        this._vscodeWrapper.logToOutputChannel(Utils.formatString(Constants.msgStartedExecute, this._uri));
        const self = this;
        this.batchSets = [];
        let queryDetails: QueryExecuteParams = {
            ownerUri: this._uri,
            querySelection: selection
        };
        this._resultLineOffset = selection ? selection.startLine : 0;
        this._isExecuting = true;
        this._statusView.executingQuery(this.uri);

        self._batchSetsPromise = new Promise<BatchSummary[]>((resolve, reject) => {
            self.dataResolveReject = {resolve: resolve, reject: reject};
        });

        return this._client.sendRequest(QueryExecuteRequest.type, queryDetails).then(result => {
            if (result.messages) {
                self._statusView.executedQuery(self.uri);
                self._isExecuting = false;
                self._vscodeWrapper.showErrorMessage('Execution failed: ' + result.messages);
                self.batchSets = [{
                        hasError: true,
                        id: 0,
                        selection: undefined,
                        messages: [{message: result.messages, time: undefined}],
                        resultSetSummaries: undefined,
                        executionElapsed: undefined,
                        executionEnd: undefined,
                        executionStart: undefined
                    }];
                self.dataResolveReject.resolve();
            } else {
                // register with the Notification Handler
                self._notificationHandler.registerRunner(self, queryDetails.ownerUri);
            }
        }, error => {
            self._statusView.executedQuery(self.uri);
            self._isExecuting = false;
            self._vscodeWrapper.showErrorMessage('Execution failed: ' + error);
        });
    }

    // handle the result of the notification
    public handleResult(result: QueryExecuteCompleteNotificationResult): void {
        this._vscodeWrapper.logToOutputChannel(Utils.formatString(Constants.msgFinishedExecute, this._uri));
        this._isExecuting = false;
        if (result.message) {
            // Error occured during execution
            this._statusView.executedQuery(this.uri);
            this.batchSets = [{
                hasError: true,
                id: 0,
                selection: undefined,
                messages: [{ time: undefined, message: result.message }],
                resultSetSummaries: [],
                executionElapsed: undefined,
                executionEnd: undefined,
                executionStart: undefined
            }];
            this.dataResolveReject.resolve(this.batchSets);
            return;
        }
        this.batchSets = result.batchSummaries;

        this.batchSets.map((batch) => {
            if (batch.selection) {
                batch.selection.startLine = batch.selection.startLine + this._resultLineOffset;
                batch.selection.endLine = batch.selection.endLine + this._resultLineOffset;
            }
        });
        this._statusView.executedQuery(this.uri);
        this.dataResolveReject.resolve(this.batchSets);
        this.batchResult.emit('complete');
    }

    public handleBatchResult(result: QueryExecuteBatchCompleteNotificationResult): void {
        let batch = result.batchSummary;
        if (batch.selection) {
            batch.selection.startLine = batch.selection.startLine + this._resultLineOffset;
            batch.selection.endLine = batch.selection.endLine + this._resultLineOffset;
        }
        this._batchSets.push(batch);
        this.batchResult.emit('batch', batch);
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
                if (result.messages) {
                    self._vscodeWrapper.showErrorMessage('Failed disposing query: ' + result.messages);
                    reject();
                } else {
                    resolve();
                }
            }, error => {
                self._vscodeWrapper.showErrorMessage('Execution failed: ' + error);
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
                                for (let header of columnHeaders) {
                                    copyString += header + '\t';
                                }
                                copyString += '\r\n';
                            }
                        }

                        // iterate over the rows to paste into the copy string
                        for (let row of result.resultSubset.rows) {
                            // iterate over the cells we want from that row
                            for (let cell = range.fromCell; cell <= range.toCell; cell++) {
                                copyString += row[cell] + '\t';
                            }
                            copyString += '\r\n';
                        }
                    });
                };
            });

            let p = tasks[0]();
            for (let i = 1; 1 < tasks.length; i++) {
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

    /**
     * Sets a selection range in the editor for this query
     * @param selection The selection range to select
     */
    public setEditorSelection(selection: ISelectionData): Thenable<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            self._vscodeWrapper.openTextDocument(self._vscodeWrapper.parseUri(self.uri)).then((doc) => {
                let docEditors = self._vscodeWrapper.visibleEditors.filter((editor) => {
                    return editor.document === doc;
                });
                if (docEditors.length !== 0) {
                    docEditors[0].selection = self._vscodeWrapper.selection(
                                              self._vscodeWrapper.position(selection.startLine, selection.startColumn),
                                              self._vscodeWrapper.position(selection.endLine, selection.endColumn));
                    resolve();
                } else {
                    self._vscodeWrapper.showTextDocument(doc).then((editor) => {
                        editor.selection = self._vscodeWrapper.selection(
                                        self._vscodeWrapper.position(selection.startLine, selection.startColumn),
                                        self._vscodeWrapper.position(selection.endLine, selection.endColumn));
                        resolve();
                    });
                }
            });
        });
    }
}
