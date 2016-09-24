'use strict';
import vscode = require('vscode');
import path = require('path');
import os = require('os');
import Constants = require('./constants');
import LocalWebService from '../controllers/localWebService';
import Utils = require('./utils');
import Interfaces = require('./interfaces');
import QueryRunner from '../controllers/queryRunner';
import ResultsSerializer from  '../models/resultsSerializer';
import StatusView from '../views/statusView';
import VscodeWrapper from './../controllers/vscodeWrapper';
import { ISelectionData } from './interfaces';
const pd  = require('pretty-data').pd;

export class SqlOutputContentProvider implements vscode.TextDocumentContentProvider {
    private _queryResultsMap: Map<string, QueryRunner> = new Map<string, QueryRunner>();
    public static providerName = 'tsqloutput';
    public static providerUri = vscode.Uri.parse('tsqloutput://');
    private _service: LocalWebService;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _vscodeWrapper: VscodeWrapper;

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public onContentUpdated(): void {
        this._onDidChange.fire(SqlOutputContentProvider.providerUri);
    }

    constructor(context: vscode.ExtensionContext,
                private _statusView: StatusView) {
        const self = this;

        this._vscodeWrapper = new VscodeWrapper();

        // create local express server
        this._service = new LocalWebService(context.extensionPath);

        // add http handler for '/root'
        this._service.addHandler(Interfaces.ContentType.Root, function(req, res): void {
            let uri: string = decodeURI(req.query.uri);
            let theme: string = req.query.theme;
            let backgroundcolor: string = req.query.backgroundcolor;
            let color: string = req.query.color;
            let fontfamily: string = decodeURI(req.query.fontfamily);
            let fontsize: string = req.query.fontsize;
            let fontweight: string = req.query.fontweight;
            res.render(path.join(LocalWebService.staticContentPath, Constants.msgContentProviderSqlOutputHtml),
                {
                    uri: uri,
                    theme: theme,
                    backgroundcolor: backgroundcolor,
                    color: color,
                    fontfamily: fontfamily,
                    fontsize: fontsize,
                    fontweight: fontweight
                }
            );
        });

        // add http handler for '/resultsetsMeta' - return metadata about columns & rows in multiple resultsets
        this._service.addHandler(Interfaces.ContentType.ResultsetsMeta, function(req, res): void {
            let batchSets: Interfaces.IGridBatchMetaData[] = [];
            let uri: string = decodeURI(req.query.uri);
            for (let [batchIndex, batch] of self._queryResultsMap.get(uri).batchSets.entries()) {
                let tempBatch: Interfaces.IGridBatchMetaData = {resultSets: [], messages: batch.messages, hasError: batch.hasError, selection: batch.selection};
                for (let [resultIndex, result] of batch.resultSetSummaries.entries()) {
                    tempBatch.resultSets.push( <Interfaces.IGridResultSet> {
                        columnsUri: '/' + Constants.outputContentTypeColumns + '?batchId=' + batchIndex + '&resultId=' + resultIndex + '&uri=' + uri,
                        rowsUri: '/' + Constants.outputContentTypeRows +  '?batchId=' + batchIndex + '&resultId=' + resultIndex + '&uri=' + uri,
                        numberOfRows: result.rowCount
                    });
                }
                batchSets.push(tempBatch);
            }
            let json = JSON.stringify(batchSets);
            res.send(json);
        });

        // add http handler for '/columns' - return column metadata as a JSON string
        this._service.addHandler(Interfaces.ContentType.Columns, function(req, res): void {
            let resultId = req.query.resultId;
            let batchId = req.query.batchId;
            let uri: string = decodeURI(req.query.uri);
            let columnMetadata = self._queryResultsMap.get(uri).batchSets[batchId].resultSetSummaries[resultId].columnInfo;
            let json = JSON.stringify(columnMetadata);
            res.send(json);
        });

        // add http handler for '/rows' - return rows end-point for a specific resultset
        this._service.addHandler(Interfaces.ContentType.Rows, function(req, res): void {
            let resultId = req.query.resultId;
            let batchId = req.query.batchId;
            let rowStart = req.query.rowStart;
            let numberOfRows = req.query.numberOfRows;
            let uri: string = decodeURI(req.query.uri);
            self._queryResultsMap.get(uri).getRows(rowStart, numberOfRows, batchId, resultId).then(results => {
                let json = JSON.stringify(results.resultSubset);
                res.send(json);
            });
        });

        // add http handler for '/saveResults' - return success message as JSON
        this._service.addHandler(Interfaces.ContentType.SaveResults, function(req, res): void {
            let uri: string = decodeURI(req.query.uri);
            let queryUri = self._queryResultsMap.get(uri).uri;
            let selectedResultSetNo: number = Number(req.query.resultSetNo);
            let batchIndex: number = Number(req.query.batchIndex);
            let format: string = req.query.format;
            let saveResults = new ResultsSerializer();
            if (format === 'csv') {
                saveResults.onSaveResultsAsCsv(queryUri, batchIndex, selectedResultSetNo);
            } else if (format === 'json') {
                saveResults.onSaveResultsAsJson(queryUri, batchIndex, selectedResultSetNo);
            }

            res.status = 200;
            res.send();
        });

        // add http handler for '/openLink' - open content in a new vscode editor pane
        this._service.addPostHandler(Interfaces.ContentType.OpenLink, function(req, res): void {
            let content: string = req.body.content;
            let columnName: string = req.body.columnName;
            let tempFileName = columnName + '_' + String(Math.floor( Date.now() / 1000)) + String(process.pid) + '.xml';
            let tempFilePath = path.join(os.tmpdir(), tempFileName );
            let uri = vscode.Uri.parse('untitled:' + tempFilePath);
            let xml = pd.xml(content);
            vscode.workspace.openTextDocument(uri).then((doc: vscode.TextDocument) => {
                    vscode.window.showTextDocument(doc, 1, false).then(editor => {
                        editor.edit( edit => {
                            edit.insert( new vscode.Position(0, 0), xml);
                        });
                    });
             }, (error: any) => {
                 console.error(error);
             });

            res.status = 200;
            res.send();
        });

        // add http post handler for copying results
        this._service.addPostHandler(Interfaces.ContentType.Copy, function(req, res): void {
            let uri = decodeURI(req.query.uri);
            let resultId = req.query.resultId;
            let batchId = req.query.batchId;
            let selection: Interfaces.ISlickRange[] = req.body;
            self._queryResultsMap.get(uri).copyResults(selection, batchId, resultId).then(() => {
                res.status = 200;
                res.send();
            });
        });

        // add http post handler for setting the selection in the editor
        this._service.addPostHandler(Interfaces.ContentType.EditorSelection, function(req, res): void {
            let uri = decodeURI(req.query.uri);
            let selection: ISelectionData = req.body;
            self._queryResultsMap.get(uri).setEditorSelection(selection).then(() => {
                res.status = 200;
                res.send();
            });
        });

        // start express server on localhost and listen on a random port
        try {
            this._service.start();
        } catch (error) {
            Utils.showErrorMsg(error);
            throw(error);
        }
    }

    private clear(uri: string): void {
        this._queryResultsMap.delete(uri);
    }

    public show(uri: string, title: string): void {
        vscode.commands.executeCommand('vscode.previewHtml', uri, vscode.ViewColumn.Two, 'SQL Query Results: ' + title);
    }

    public runQuery(statusView, uri: string, selection: ISelectionData, title: string): void {
        // Reuse existing query runner
        let queryRunner: QueryRunner = this._queryResultsMap.has(uri)
            ? this._queryResultsMap[uri]
            : new QueryRunner(uri, title, statusView, this);

        // Execute the query
        queryRunner.runQuery(selection);
    }

    public cancelQuery(uri: string): boolean {
        let self = this;
        // If we don't have a query runner for this uri, then we can't do anything
        if (!this._queryResultsMap.has(uri)) {
            return false;
        }

        // Cancel the query
        this._queryResultsMap[uri].cancelQuery().then(success => {
            // On success, dispose of the query runner
            this._queryResultsMap.delete(uri);
        }, error => {
            // On error, show error message
            self._vscodeWrapper.showErrorMessage(Utils.formatString(Constants.msgCancelQueryFailed, error));
        });
    }

    public updateContent(queryRunner: QueryRunner): string {
        let title = queryRunner.title;
        let uri = SqlOutputContentProvider.providerUri + title;
        this.clear(uri);
        this._queryResultsMap.set(uri, queryRunner);
        this.show(uri, title);
        this.onContentUpdated();
        return uri;
    }

    // Called by VS Code exactly once to load html content in the preview window
    public provideTextDocumentContent(uri: vscode.Uri): string {

        // return dummy html content that redirects to 'http://localhost:<port>' after the page loads
        return `
        <html>
        <head>
        </head>
        <body></body>
        <script type="text/javascript">
            var doc = document.documentElement;
            var styles = window.getComputedStyle(doc);
            var backgroundcolor = styles.getPropertyValue('--background-color');
            var color = styles.getPropertyValue('--color');
            var fontfamily = styles.getPropertyValue('--font-family');
            var fontweight = styles.getPropertyValue('--font-weight');
            var fontsize = styles.getPropertyValue('--font-size');
            var theme = document.body.className;
            window.onload = function(event) {
                event.stopPropagation(true);
                var url = "${LocalWebService.getEndpointUri(Interfaces.ContentType.Root)}?uri=${uri.toString()}" +
                                                                                                        "&theme=" + theme +
                                                                                                        "&backgroundcolor=" + backgroundcolor +
                                                                                                        "&color=" + color +
                                                                                                        "&fontfamily=" + fontfamily +
                                                                                                        "&fontweight=" + fontweight +
                                                                                                        "&fontsize=" + fontsize;
                window.location.href = url
            };
        </script>
        </html>`;
    }
}
