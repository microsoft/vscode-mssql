'use strict';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import ConnectionManager from './connectionManager';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclie';
import {QueryNotificationHandler} from './QueryNotificationHandler';
import VscodeWrapper from './vscodeWrapper';
import { BatchSummary, QueryExecuteParams, QueryExecuteRequest,
    QueryExecuteCompleteNotificationResult, QueryExecuteSubsetResult,
    QueryExecuteSubsetParams, QueryDisposeParams, QueryExecuteSubsetRequest,
    QueryDisposeRequest } from '../models/contracts/queryExecute';

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
    public runQuery(uri: string, text: string, title: string): Thenable<void> {
        const self = this;
        let queryDetails = new QueryExecuteParams();
        queryDetails.ownerUri = uri;
        queryDetails.queryText = text;
        this.title = title;
        this.uri = uri;

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
}
