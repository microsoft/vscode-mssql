'use strict';
import vscode = require('vscode');
import path = require('path');
import Constants = require('./constants');
import LocalWebService from '../controllers/localWebService';
import Utils = require('./utils');
import Interfaces = require('./interfaces');

class QueryResultSet {
    public messages: string[] = [];
    public resultsets: Interfaces.ISqlResultset[] = [];

    constructor(messages: string[], resultsets: Interfaces.ISqlResultset[]) {
        this.messages = messages;
        this.resultsets = resultsets;
    }
}

export class SqlOutputContentProvider implements vscode.TextDocumentContentProvider {
    private _queryResultsMap: Map<string, QueryResultSet> = new Map<string, QueryResultSet>();
    public static providerName = 'tsqloutput';
    public static providerUri = vscode.Uri.parse('tsqloutput://');
    private _service: LocalWebService;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public onContentUpdated(): void {
        Utils.logDebug(Constants.msgContentProviderOnContentUpdated);
        this._onDidChange.fire(SqlOutputContentProvider.providerUri);
    }

    constructor(context: vscode.ExtensionContext) {
        const self = this;

        // create local express server
        this._service = new LocalWebService(context.extensionPath);

        // add http handler for '/'
        this._service.addHandler(Interfaces.ContentType.Root, function(req, res): void {
            Utils.logDebug(Constants.msgContentProviderOnRootEndpoint);
            let uri: string = req.query.uri;
            res.render(path.join(LocalWebService.staticContentPath, Constants.msgContentProviderSqlOutputHtml), {uri: uri});
        });

        // add http handler for '/resultsetsMeta' - return metadata about columns & rows in multiple resultsets
        this._service.addHandler(Interfaces.ContentType.ResultsetsMeta, function(req, res): void {

            Utils.logDebug(Constants.msgContentProviderOnResultsEndpoint);
            let resultsetsMeta: Interfaces.ISqlResultsetMeta[] = [];
            let uri: string = req.query.uri;
            for (let index = 0; index < self._queryResultsMap.get(uri).resultsets.length; index ++) {
                resultsetsMeta.push( <Interfaces.ISqlResultsetMeta> {
                    columnsUri: '/' + Constants.outputContentTypeColumns + '?id=' + index.toString(),
                    rowsUri: '/' + Constants.outputContentTypeRows + '?id=' + index.toString()
                });
            }
            let json = JSON.stringify(resultsetsMeta);
            // Utils.logDebug(json);
            res.send(json);
        });

        // add http handler for '/messages' - return all messages as a JSON string
        this._service.addHandler(Interfaces.ContentType.Messages, function(req, res): void {
            Utils.logDebug(Constants.msgContentProviderOnMessagesEndpoint);
            let uri: string = req.query.uri;
            let json = JSON.stringify(self._queryResultsMap.get(uri).messages);
            // Utils.logDebug(json);
            res.send(json);
        });

        // add http handler for '/columns' - return column metadata as a JSON string
        this._service.addHandler(Interfaces.ContentType.Columns, function(req, res): void {
            let id = req.query.id;
            Utils.logDebug(Constants.msgContentProviderOnColumnsEndpoint + id);
            let uri: string = req.query.uri;
            let columnMetadata = self._queryResultsMap.get(uri).resultsets[id].columns;
            let json = JSON.stringify(columnMetadata);
            // Utils.logDebug(json);
            res.send(json);
        });

        // add http handler for '/rows' - return rows end-point for a specific resultset
        this._service.addHandler(Interfaces.ContentType.Rows, function(req, res): void {
            let id = req.query.id;
            Utils.logDebug(Constants.msgContentProviderOnRowsEndpoint + id);
            let uri: string = req.query.uri;
            let json = JSON.stringify(self._queryResultsMap.get(uri).resultsets[id].rows);
            // Utils.logDebug(json);
            res.send(json);
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
        Utils.logDebug(Constants.msgContentProviderOnClear);
        this._queryResultsMap.delete(uri);
    }

    public show(uri: string, title: string): void {
        vscode.commands.executeCommand('vscode.previewHtml', uri, vscode.ViewColumn.Two, 'SQL Query Results: ' + title);
    }

    public updateContent(messages, resultsets): string {
        Utils.logDebug(Constants.msgContentProviderOnUpdateContent);
        let title: string = Utils.getActiveTextEditor().document.fileName;
        let uri: string = SqlOutputContentProvider.providerUri + title;
        this.clear(uri);
        this.show(uri, title);
        this._queryResultsMap.set(uri, new QueryResultSet(messages, resultsets));
        this.onContentUpdated();
        return uri;
    }

    // Called by VS Code exactly once to load html content in the preview window
    public provideTextDocumentContent(uri: vscode.Uri): string {
        Utils.logDebug(Constants.msgContentProviderProvideContent + uri.toString());

        // return dummy html content that redirects to 'http://localhost:<port>' after the page loads
        return `
                <html>
                    <head>
                        <script type="text/javascript">
                            window.onload = function(event) {
                                event.stopPropagation(true);
                                window.location.href="${LocalWebService.getEndpointUri(Interfaces.ContentType.Root)}?uri=${uri.toString()}";
                            };
                        </script>
                    </head>
                    <body></body>
                </html>`;
    }
}
