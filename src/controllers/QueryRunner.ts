'use strict';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import {QueryNotificationHandler} from './QueryNotificationHandler';
import VscodeWrapper from './vscodeWrapper';
import { BatchSummary, QueryExecuteParams, QueryExecuteRequest,
    QueryExecuteCompleteNotificationResult, QueryExecuteSubsetResult,
    QueryExecuteSubsetParams, QueryDisposeParams, QueryExecuteSubsetRequest,
    QueryDisposeRequest } from '../models/contracts/queryExecute';
import { QueryCancelParams, QueryCancelResult, QueryCancelRequest } from '../models/contracts/QueryCancel';
import { ISlickRange } from '../models/interfaces';


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
    private _isExecuting: boolean;
    private _uri: string;
    private _title: string;

    constructor(private _ownerUri: string,
                private _editorTitle: string,
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

        // Store the state
        this._uri = _ownerUri;
        this._title = _editorTitle;
        this._isExecuting = false;
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

    // PUBLIC METHODS ======================================================

    public cancel(): Thenable<QueryCancelResult> {
        // Make the request to cancel the query
        let cancelParams: QueryCancelParams = { ownerUri: this._uri };
        return this.client.sendRequest(QueryCancelRequest.type, cancelParams);
    }

    // Pulls the query text from the current document/selection and initiates the query
    public runQuery(text: string): Thenable<void> {
        const self = this;
        let queryDetails: QueryExecuteParams = {
            ownerUri: this._uri,
            queryText: text
        };

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
}
