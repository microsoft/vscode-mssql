'use strict';
import vscode = require('vscode');
// import Constants = require('../models/constants');
// import Utils = require('../models/utils');
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
// import Interfaces = require('../models/interfaces');
import ConnectionManager from './connectionManager';
import StatusView from '../views/statusView';
import SqlToolsServerClient from '../languageservice/serviceclient';
import {QueryNotificationHandler} from './QueryNotificationHandler';
import * as Contracts from '../models/contracts';

// const async = require('async');
// const mssql = require('mssql');

interface IResultSet {
    columns: string[];
    totalNumberOfRows: number;
}

export default class QueryRunner {
    private _client: SqlToolsServerClient;
    private _resultSets: Contracts.ResultSetSummary[];
    private _uri: string;
    private _title: string;
    private _messages: string[];

    constructor(private _connectionMgr: ConnectionManager,
                private _statusView: StatusView,
                private _outputProvider: SqlOutputContentProvider) {
        this._client = SqlToolsServerClient.getInstance();
    }

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

    get resultSets(): Contracts.ResultSetSummary[] {
        return this._resultSets;
    }

    get messages(): string[] {
        return this._messages;
    }

    public runQuery(): Thenable<void> {
        const self = this;
        let editor = vscode.window.activeTextEditor;
        // this.uri = editor.document.uri.toString();
        this.uri = 'vscode-mssql';
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
                vscode.window.showErrorMessage('Execution fails: ' + result.messages);
            } else {
                QueryNotificationHandler.instance.registerRunner(self, queryDetails.ownerUri);
            }
        }, error => {
            vscode.window.showErrorMessage('Execution failed: ' + error);
        });
    }

    public handleResult(result: Contracts.QueryExecuteCompleteNotificationResult): void {
        if (result.hasError) {
            vscode.window.showErrorMessage('Something went wrong during the query: ' + result.messages[0]);
        } else {
            this._resultSets = result.resultSetSummaries;
            this._messages = result.messages;
            this._outputProvider.updateContent(this);
        }
    }

    public getRows(id: number, rowStart: number, numberOfRows: number, resultSetIndex: number): Thenable<Contracts.QueryExecuteSubsetResult> {
        const self = this;
        let queryDetails = new Contracts.QueryExecuteSubsetParams();
        queryDetails.ownerUri = this._uri;
        queryDetails.resultSetIndex = resultSetIndex;
        queryDetails.rowsCount = numberOfRows;
        queryDetails.rowsStartIndex = rowStart;
        return new Promise<Contracts.QueryExecuteSubsetResult>((resolve, reject) => {
            self._client.getClient().sendRequest(Contracts.QueryExecuteSubsetRequest.type, queryDetails).then(result => {
                if (result.message) {
                    vscode.window.showErrorMessage('Something went wrong getting more rows: ' + result.message);
                } else {
                    resolve(result);
                }
            });
        });
    }
}
