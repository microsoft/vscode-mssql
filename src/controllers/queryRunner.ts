'use strict';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import ConnectionManager from './connectionManager';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import {QueryNotificationHandler} from './QueryNotificationHandler';
import * as Contracts from '../models/contracts';
import VscodeWrapper from './vscodeWrapper';

export interface IResultSet {
    columns: string[];
    totalNumberOfRows: number;
}
/*
* Query Runner class which handles running a query, reports the results to the content manager,
* and handles getting more rows from the service layer and disposing when the content is closed.
*/
export default class QueryRunner {
    private _resultSets: Contracts.ResultSetSummary[];
    private _uri: string;
    private _title: string;
    private _messages: string[];

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

    get resultSets(): Contracts.ResultSetSummary[] {
        return this._resultSets;
    }

    get messages(): string[] {
        return this._messages;
    }

    // Pulls the query text from the current document/selection and initiates the query
    public runQuery(uri: string, text: string, title: string): Thenable<void> {
        const self = this;
        let queryDetails = new Contracts.QueryExecuteParams();
        queryDetails.ownerUri = uri;
        queryDetails.queryText = text;
        this.title = title;
        this.uri = uri;

        return this.client.sendRequest(Contracts.QueryExecuteRequest.type, queryDetails).then(result => {
            if (result.messages) {
                self.vscodeWrapper.showErrorMessage('Execution failed: ' + result.messages);
            } else {
                // register with the Notification Handler
                self.notificationHandler.registerRunner(self, queryDetails.ownerUri);
            }
        }, error => {
            self.vscodeWrapper.showErrorMessage('Execution failed: ' + error);
        });
    }

    // handle the result of the notification
    public handleResult(result: Contracts.QueryExecuteCompleteNotificationResult): void {
        if (result.hasError) {
            this.vscodeWrapper.showErrorMessage('Something went wrong during the query: ' + result.messages[0]);
        } else {
            this._resultSets = result.resultSetSummaries;
            this._messages = result.messages;
            this._outputProvider.updateContent(this);
        }
    }

    // get more data rows from the current resultSets from the service layer
    public getRows(rowStart: number, numberOfRows: number, resultSetIndex: number): Promise<Contracts.QueryExecuteSubsetResult> {
        const self = this;
        let queryDetails = new Contracts.QueryExecuteSubsetParams();
        queryDetails.ownerUri = this.uri;
        queryDetails.resultSetIndex = resultSetIndex;
        queryDetails.rowsCount = numberOfRows;
        queryDetails.rowsStartIndex = rowStart;
        return new Promise<Contracts.QueryExecuteSubsetResult>((resolve, reject) => {
            self.client.sendRequest(Contracts.QueryExecuteSubsetRequest.type, queryDetails).then(result => {
                if (result.message) {
                    self.vscodeWrapper.showErrorMessage('Something went wrong getting more rows: ' + result.message);
                    reject();
                } else {
                    resolve(result);
                }
            });
        });
    }

    // dispose the query from front end and and back end
    public dispose(): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            let disposeDetails = new Contracts.QueryDisposeParams();
            disposeDetails.ownerUri = this.uri;
            this.client.sendRequest(Contracts.QueryDisposeRequest.type, disposeDetails).then(result => {
                if (result.messages) {
                    self.vscodeWrapper.showErrorMessage('Failed disposing query: ' + result.messages);
                    resolve(false);
                } else {
                    resolve(true);
                }
            }, error => {
                self.vscodeWrapper.showErrorMessage('Execution failed: ' + error);
            });
        });
    }
}
