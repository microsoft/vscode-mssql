'use strict';
import vscode = require('vscode');
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import ConnectionManager from './connectionManager';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import {QueryNotificationHandler} from './QueryNotificationHandler';
import * as Contracts from '../models/contracts';
import * as Utils from '../models/utils';

interface IResultSet {
    columns: string[];
    totalNumberOfRows: number;
}
/*
* Query Runner class which handles running a query, reports the results to the content manager,
* and handles getting more rows from the service layer and disposing when the content is closed.
*/
export default class QueryRunner {
    private _client: SqlToolsServerClient;
    private _resultSets: Contracts.ResultSetSummary[];
    private _uri: string;
    private _title: string;
    private _messages: string[];

    constructor(private _connectionMgr: ConnectionManager,
                private _statusView: StatusView,
                private _outputProvider: SqlOutputContentProvider) {
        this.client = SqlToolsServerClient.getInstance();
    }

    private get uri(): string {
        return this._uri;
    }

    private set uri(uri: string) {
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
    public runQuery(): Thenable<void> {
        const self = this;
        let editor = vscode.window.activeTextEditor;
        this.uri = editor.document.uri.toString();
        this.title = editor.document.fileName;
        let queryDetails = new Contracts.QueryExecuteParams();
        queryDetails.ownerUri = this.uri;
        if (editor.selection.isEmpty) {
            queryDetails.queryText = editor.document.getText();
        } else {
            queryDetails.queryText = editor.document.getText(new vscode.Range(editor.selection.start, editor.selection.end));
        }

        return this._client.getClient().sendRequest(Contracts.QueryExecuteRequest.type, queryDetails).then(result => {
            if (result.messages) {
                Utils.showErrorMsg('Execution failed: ' + result.messages);
            } else {
                // register with the Notification Handler
                QueryNotificationHandler.instance.registerRunner(self, queryDetails.ownerUri);
            }
        }, error => {
            Utils.showErrorMsg('Execution failed: ' + error);
        });
    }

    // handle the result of the notification
    public handleResult(result: Contracts.QueryExecuteCompleteNotificationResult): void {
        if (result.hasError) {
            Utils.showErrorMsg('Something went wrong during the query: ' + result.messages[0]);
        } else {
            this._resultSets = result.resultSetSummaries;
            this._messages = result.messages;
            this._outputProvider.updateContent(this);
        }
    }

    // get more data rows from the current resultSets from the service layer
    public getRows(id: number, rowStart: number, numberOfRows: number, resultSetIndex: number): Thenable<Contracts.QueryExecuteSubsetResult> {
        const self = this;
        let queryDetails = new Contracts.QueryExecuteSubsetParams();
        queryDetails.ownerUri = this.uri;
        queryDetails.resultSetIndex = resultSetIndex;
        queryDetails.rowsCount = numberOfRows;
        queryDetails.rowsStartIndex = rowStart;
        return new Promise<Contracts.QueryExecuteSubsetResult>((resolve, reject) => {
            self._client.getClient().sendRequest(Contracts.QueryExecuteSubsetRequest.type, queryDetails).then(result => {
                if (result.message) {
                    Utils.showErrorMsg('Something went wrong getting more rows: ' + result.message);
                } else {
                    resolve(result);
                }
            });
        });
    }

    // dispose the query from front end and and back end
    public dispose(): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            let disposeDetails = new Contracts.QueryDisposeParams();
            disposeDetails.ownerUri = this.uri;
            this.client.getClient().sendRequest(Contracts.QueryDisposeRequest.type, disposeDetails).then(result => {
                if (result.messages) {
                    Utils.showErrorMsg('Failed disposing query: ' + result.messages);
                    resolve(false);
                } else {
                    resolve(true);
                }
            }, error => {
                Utils.showErrorMsg('Execution failed: ' + error);
            });
        });
    }
}
