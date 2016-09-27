'use strict';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import ConnectionManager from './connectionManager';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import {QueryNotificationHandler} from './QueryNotificationHandler';
import VscodeWrapper from './vscodeWrapper';
import { BatchSummary, QueryExecuteParams, QueryExecuteRequest,
    QueryExecuteCompleteNotificationResult, QueryExecuteSubsetResult,
    QueryExecuteSubsetParams, QueryDisposeParams, QueryExecuteSubsetRequest,
    QueryDisposeRequest } from '../models/contracts/queryExecute';
import { ISlickRange, ISelectionData } from '../models/interfaces';


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
    private _batchSets: BatchSummary[];
    private _uri: string;
    private _title: string;
    private _resultLineOffset: number;

    constructor(private _connectionMgr: ConnectionManager,
                private _statusView: StatusView,
                private _outputProvider: SqlOutputContentProvider,
                private _client?: SqlToolsServerClient,
                private _notificationHandler?: QueryNotificationHandler,
                private _vscodeWrapper?: VscodeWrapper) {
        if (!_client) {
            this.client = SqlToolsServerClient.instance;
        }

        if (!_notificationHandler) {
            this.notificationHandler = QueryNotificationHandler.instance;
        }

        if (!_vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }
    }

    private get notificationHandler(): QueryNotificationHandler {
        return this._notificationHandler;
    }

    private set notificationHandler(handler: QueryNotificationHandler) {
        this._notificationHandler = handler;
    }

    private get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    private set vscodeWrapper(wrapper: VscodeWrapper) {
        this._vscodeWrapper = wrapper;
    }

    private get statusView(): StatusView {
        return this._statusView;
    }

    get uri(): string {
        return this._uri;
    }

    set uri(uri: string) {
        this._uri = uri;
    }

    private get client(): SqlToolsServerClient {
        return this._client;
    }

    private set client(client: SqlToolsServerClient) {
        this._client = client;
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

    // Pulls the query text from the current document/selection and initiates the query
    public runQuery(uri: string, selection: ISelectionData, title: string): Thenable<void> {
        const self = this;
        let queryDetails = new QueryExecuteParams();
        queryDetails.ownerUri = uri;
        queryDetails.querySelection = selection;
        this.title = title;
        this.uri = uri;
        if (selection) {
            this._resultLineOffset = selection.startLine;
        } else {
            this._resultLineOffset = 0;
        }

        return this.client.sendRequest(QueryExecuteRequest.type, queryDetails).then(result => {
            if (result.messages) {
                self.vscodeWrapper.showErrorMessage('Execution failed: ' + result.messages);
            } else {
                self.statusView.executingQuery(self.uri);
                // register with the Notification Handler
                self.notificationHandler.registerRunner(self, queryDetails.ownerUri);
            }
        }, error => {
            self.vscodeWrapper.showErrorMessage('Execution failed: ' + error);
        });
    }

    // handle the result of the notification
    public handleResult(result: QueryExecuteCompleteNotificationResult): void {
        this.batchSets = result.batchSummaries;
        this.batchSets.map((batch) => {
            batch.selection.startLine = batch.selection.startLine + this._resultLineOffset;
            batch.selection.endLine = batch.selection.endLine + this._resultLineOffset;
        });
        this.statusView.executedQuery(this.uri);
        this._outputProvider.updateContent(this);
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
            self.client.sendRequest(QueryExecuteSubsetRequest.type, queryDetails).then(result => {
                if (result.message) {
                    self.vscodeWrapper.showErrorMessage('Something went wrong getting more rows: ' + result.message);
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
            self.client.sendRequest(QueryDisposeRequest.type, disposeDetails).then(result => {
                if (result.messages) {
                    self.vscodeWrapper.showErrorMessage('Failed disposing query: ' + result.messages);
                    reject();
                } else {
                    resolve();
                }
            }, error => {
                self.vscodeWrapper.showErrorMessage('Execution failed: ' + error);
            });
        });
    }

    /**
     * Copy the result range to the system clip-board
     * @param selection The selection range array to copy
     * @param batchId The id of the batch to copy from
     * @param resultId The id of the result to copy from
     */
    public copyResults(selection: ISlickRange[], batchId: number, resultId: number): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            let copyString = '';
            // create a mapping of the ranges to get promises
            let tasks = selection.map((range, i) => {
                return () => {
                    return self.getRows(range.fromRow, range.toRow - range.fromRow + 1, batchId, resultId).then((result) => {
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

    /**
     * Sets a selection range in the editor for this query
     * @param selection The selection range to select
     */
    public setEditorSelection(selection: ISelectionData): Thenable<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            self.vscodeWrapper.openTextDocument(self.vscodeWrapper.parseUri(self.uri)).then((doc) => {
                let docEditors = self.vscodeWrapper.visibleEditors.filter((editor) => {
                    return editor.document === doc;
                });
                if (docEditors.length !== 0) {
                    docEditors[0].selection = self.vscodeWrapper.selection(
                                              self.vscodeWrapper.position(selection.startLine, selection.startColumn),
                                              self.vscodeWrapper.position(selection.endLine, selection.endColumn));
                    resolve();
                } else {
                    self.vscodeWrapper.showTextDocument(doc).then((editor) => {
                        editor.selection = self.vscodeWrapper.selection(
                                        self.vscodeWrapper.position(selection.startLine, selection.startColumn),
                                        self.vscodeWrapper.position(selection.endLine, selection.endColumn));
                        resolve();
                    });
                }
            });
        });
    }
}
