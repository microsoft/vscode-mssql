'use strict';
import vscode = require('vscode');
import path = require('path');
import Constants = require('./constants');
import LocalWebService from '../controllers/localWebService';
import Utils = require('./utils');
import Interfaces = require('./interfaces');
import QueryRunner from '../controllers/queryRunner';
import StatusView from '../views/statusView';
import VscodeWrapper from './../controllers/vscodeWrapper';

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
            res.render(path.join(LocalWebService.staticContentPath, Constants.msgContentProviderSqlOutputHtml), {uri: uri, theme: theme});
        });

        // add http handler for '/resultsetsMeta' - return metadata about columns & rows in multiple resultsets
        this._service.addHandler(Interfaces.ContentType.ResultsetsMeta, function(req, res): void {
            let batchSets: Interfaces.IGridBatchMetaData[] = [];
            let uri: string = decodeURI(req.query.uri);
            for (let [batchIndex, batch] of self._queryResultsMap.get(uri).batchSets.entries()) {
                let tempBatch: Interfaces.IGridBatchMetaData = {resultSets: [], messages: undefined};
                for (let [resultIndex, result] of batch.resultSetSummaries.entries()) {
                    tempBatch.resultSets.push( <Interfaces.IGridResultSet> {
                        columnsUri: '/' + Constants.outputContentTypeColumns + '?batchId=' + batchIndex + '&resultId=' + resultIndex + '&uri=' + uri,
                        rowsUri: '/' + Constants.outputContentTypeRows +  '?batchId=' + batchIndex + '&resultId=' + resultIndex + '&uri=' + uri,
                        numberOfRows: result.rowCount
                    });
                }
                tempBatch.messages = batch.messages;
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

    public runQuery(connectionMgr, statusView, uri: string, text: string, title: string): void {
        let queryRunner = new QueryRunner(connectionMgr, statusView, this);
        queryRunner.runQuery(uri, text, title);
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
                        <script   src="https://code.jquery.com/jquery-3.1.0.min.js"   integrity="sha256-cCueBR6CsyA4/9szpPfrX3s49M9vUU5BgtiJj06wt/s="   crossorigin="anonymous"></script>

                    </head>
                    <body></body>
                    <script type="text/javascript">
                            var markup = document.documentElement.innerHTML;
                            console.log(markup);
                            var classList = document.body.className;
                             window.onload = function(event) {
                                event.stopPropagation(true);
                                window.location.href="${LocalWebService.getEndpointUri(Interfaces.ContentType.Root)}?uri=${uri.toString()}&theme=" + classList;
                            };
                        </script>
                </html>`;
    }
}
