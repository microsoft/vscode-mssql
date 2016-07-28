'use strict';
import vscode = require('vscode');

import Constants = require('../models/constants');
import Utils = require('../models/utils');
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import Interfaces = require('../models/interfaces');
import ConnectionManager from './connectionManager';
import StatusView from '../views/statusView';

const async = require('async');
const mssql = require('mssql');

export default class QueryRunner {
    private _connectionMgr: ConnectionManager;
    private _outputProvider: SqlOutputContentProvider;
    private _errorEncountered = false;
    private _messages: Interfaces.ISqlMessage[] = [];
    private _resultsets: Interfaces.ISqlResultset[] = [];
    private _statusView: StatusView;

    constructor(connectionMgr: ConnectionManager, statusView: StatusView, outputProvider: SqlOutputContentProvider) {
        this._connectionMgr = connectionMgr;
        this._statusView = statusView;
        this._outputProvider = outputProvider;
    }

    get messages(): Interfaces.ISqlMessage[] {
        return this._messages;
    }

    get resultSets(): Interfaces.ISqlResultset[] {
        return this._resultsets;
    }

    private get connectionManager(): ConnectionManager {
        return this._connectionMgr;
    }

    private get statusView(): any {
        return this._statusView;
    }

    private get outputProvider(): any {
        return this._outputProvider;
    }

    // get T-SQL text from the editor window, run it and show output
    public onRunQuery(): void {
        const self = this;
        if (self.connectionManager.isConnected) {
            // already connected - run query
            Utils.logDebug(Constants.msgRunQueryConnectionActive);
            self.runQuery();
        } else if (self.connectionManager.connectionCredentials) {
            // connected previously but not connected now - reconnect with saved connection info
            Utils.logDebug(Constants.msgRunQueryConnectionDisconnected);
            self.connectionManager.connect(self.connectionManager.connectionCredentials)
            .then(function(): void {
                self.runQuery();
            });
        } else {
            // not connected - prompt for a new connection
            Utils.logDebug(Constants.msgRunQueryNoConnection);
            self.connectionManager.onNewConnection()
            .then(function(): void {
                self.runQuery();
            });
        }
    }

    // Helper to execute selected T-SQL text in the editor or the entire contents if no selection
    // Executes queries in batches separated by "GO;"
    private runQuery(): void {
        const self = this;

        // Good info on sync vs. async in node: http://book.mixu.net/node/ch7.html
        // http://www.sebastianseilund.com/nodejs-async-in-practice
        let sqlBatches = self.getSqlBatches();
        if (sqlBatches && sqlBatches.length > 0) {
            // called by async.js when all batches have finished executing
            let done = function(err): void {
                // all batches executed
                Utils.logDebug(Constants.msgRunQueryAllBatchesExecuted);
                self.statusView.executedQuery();

                if (err) {
                    Utils.logDebug(Constants.msgRunQueryError + err.toString());
                    return;
                }

                self.outputProvider.updateContent(self.messages, self.resultSets);
            };

            // called by async.js for each sqlBatch
            let iterator = function(sqlBatch, callback): void {
                self.executeBatch(sqlBatch, self.connectionManager.connection)
                .then(function(resolution): void {
                    Utils.logDebug(Constants.msgRunQueryAddBatchResultsets + sqlBatch);
                    let recordsets = resolution.recordsets;
                    let requestRowsAffected = resolution.requestRowsAffected;
                    self.addResultsets(recordsets, requestRowsAffected);

                    callback(); // call 'callback' to indicate this iteration is done and to proceed to the next one
                })
                .catch(function(err): void {
                    self._errorEncountered = true;
                    Utils.logDebug(Constants.msgRunQueryAddBatchError + sqlBatch);
                    self.addError(err);

                    callback(); // call 'callback' to indicate this iteration is done and to proceed to the next one
                });
            };

            self._errorEncountered = false;
            self._messages = [];
            self._resultsets = [];
            self.statusView.executingQuery(self.connectionManager.connectionCredentials);

            // Use async.js to execute each SQL batch in the order they appear in the text editor and process output
            async.forEachSeries(sqlBatches, iterator, done);
        }
    }

    // Helper to execute T-SQL (selected text or the entire contents of the editor)
    private executeBatch(sqlText, connection): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            Utils.logDebug(Constants.msgRunQueryExecutingBatch + sqlText);
            const request = new mssql.Request(connection);
            request.multiple = true;    // enable multiple recordsets
            request.batch(sqlText, function(err, recordsets, rowsAffected): void {
                if (err) {
                    reject (err);
                }

                // Return an object with recordsets + rowsAffected
                resolve( { recordsets: recordsets, requestRowsAffected: rowsAffected } );
            });
        });
    }

    // Simple "GO" parser
    // Looks at text in the active document and produces batches of T-SQL statements delimited by 'GO'
    // GO needs to be on a separate line by itself and may have an optional ';' after it
    private getSqlBatches(): string[] {
        let editor = vscode.window.activeTextEditor;
        let textInEditor = '';
        if (editor.selection.isEmpty) {
            textInEditor = editor.document.getText();
        } else {
            textInEditor = editor.document.getText(editor.selection);
        }

        // Very helpful regex info: http://regexr.com and http://www.rexegg.com/regex-best-trick.html
        //
        // Regex to find all "GO" in the SQL text: (/^\s*GO;*\s*$/igm)
        // ^   = beginning of line
        // \s* = match  0 or more whitespace
        // GO  = match "GO
        // ;*  = match 0 or more ';' after the GO
        // \s*$ = match 0 or more whitespace at the end of the line
        // /igm = ignore case, global, multi0line

        // start by assuming no "GO"s exist
        let sqlBatches: string[] = [];
        textInEditor = textInEditor.trim();
        if (textInEditor) {
            sqlBatches.push(textInEditor);
        }

        // Select all lines not containing "GO" on a line by itself
        let matches = textInEditor.split(/^\s*GO;*\s*$/igm);
        if (matches && matches.length > 0) {
            // Found some "GO"s
            sqlBatches = matches.filter( (element) => {
                element.trim;
                return element !== '';
            });
        }

        Utils.logDebug(sqlBatches);
        return sqlBatches;
    }

    private addError(error: any): void {
        const self = this;
        if (!error) {
            return;
        }

        let errMsg = '';
        errMsg += error.number ? 'Msg ' + error.number + ', ' : '';
        errMsg += error.class ? 'Level ' + error.class + ', ' : '';
        errMsg += error.state ? 'State ' + error.state + ', ' : '';
        errMsg += error.lineNumber ? 'Line ' + error.lineNumber : '';
        errMsg += ' : ' + error.message;
        self.addMessage(errMsg);
    }

    public addMessage(message: string): void {
        const self = this;
        self._messages.push( { messageText: message.toString() });
    }

    private addResultsets(recordsets, requestRowsAffected): void {
        const self = this;
        if (!recordsets || recordsets.length === 0) {
            if (requestRowsAffected) {
                self.addMessage( '(' + requestRowsAffected + Constants.executeQueryRowsAffected + ')' );
            } else {
                self.addMessage(Constants.executeQueryCommandCompleted);
            }
            return;
        }

        // process recordsets
        for (let i = 0; i < recordsets.length; i++) {
            let currentRecordset = recordsets[i];

            let rowsAffected = self.getRowsAffected(currentRecordset);
            self.addMessage( '(' + rowsAffected + Constants.executeQueryRowsAffected + ')' );

            let columnMetadata = self.getColumnMetadata(currentRecordset);
            let rowsInResultset = self.getRowsInResultset(currentRecordset);
            self._resultsets.push( { columns: columnMetadata, rows: rowsInResultset, executionPlanXml: '' } );
        }
    }

    // return rowsAffected for recordset
    private getRowsAffected(recordset: any): any {
        let rowsAffected = 0;
        if (recordset.rowsAffected) {
            rowsAffected = recordset.rowsAffected;
        }

        if (!rowsAffected) {
            rowsAffected = recordset.length;
        }
        return rowsAffected;
    }

    // return column metadata for recordset
    private getColumnMetadata(recordset: any): any[] {
        let columnMetadata = [];
        for (let key in recordset.columns) {
            if (recordset.columns.hasOwnProperty(key)) {
                let columnName = recordset.columns[key].name;
                if (!columnName) {
                    columnName = '';
                }

                let columnMetadataRender = <Interfaces.IBackgridColumnMetadata> {
                    name: columnName,
                    label: columnName,
                    cell: 'string' // format all columns as string for display in backgrid
                };
                columnMetadata.push(columnMetadataRender);
            }
        }
        return columnMetadata;
    }

    // return column metadata for recordset
    private getRowsInResultset(recordset: any): any[] {
        const self = this;
        let rowsInResultset = [];
        for (let row of recordset) {
            self.formatRowData(row);
            rowsInResultset.push(row);
        }
        return rowsInResultset;
    }

    // convert data in row to string values that can be displayed
    private formatRowData(row: any): void {
        for (let i = 0; i < row.length; i++) {
            let value = row[i];
            if (value instanceof Date) {
                row[i] = value.toISOString();
            } else if ((value instanceof Buffer) || (value instanceof Object)) {
                let formattedValue = '0x' + value.toString('hex');
                if (formattedValue.length > 128) {
                    formattedValue = formattedValue.slice(0, 128);
                }
                row[i] = formattedValue;
            } else if (value === undefined) {
                row[i] = 'NULL';
            }
        }
    }
}
