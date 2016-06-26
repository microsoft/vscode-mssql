'use strict';
import vscode = require('vscode');
import path = require('path');
import Constants = require('./constants');
import LocalWebService from '../controllers/localWebService';
import Utils = require('./utils');
import Interfaces = require('./interfaces');

export class SqlOutputContentProvider implements vscode.TextDocumentContentProvider
{
    public static providerName = 'tsqloutput';
    public static providerUri = vscode.Uri.parse('tsqloutput://');
    private _service: LocalWebService;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _messages: string[] = [];
    private _resultsets: Interfaces.ISqlResultset[] = [];

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public onContentUpdated() {
        Utils.logDebug(Constants.gMsgContentProviderOnContentUpdated);
        this._onDidChange.fire(SqlOutputContentProvider.providerUri);
    }

    constructor(context: vscode.ExtensionContext)
    {
        const self = this;

        // create local express server
        this._service = new LocalWebService(context.extensionPath);

        // add http handler for '/'
        this._service.addHandler(Interfaces.ContentType.Root, function(req, res) {
            Utils.logDebug(Constants.gMsgContentProviderOnRootEndpoint);
            res.sendFile(path.join(LocalWebService.staticContentPath, Constants.gMsgContentProviderSqlOutputHtml));
        });

        // add http handler for '/resultsetsMeta' - return metadata about columns & rows in multiple resultsets
        this._service.addHandler(Interfaces.ContentType.ResultsetsMeta, function(req, res) {

            Utils.logDebug(Constants.gMsgContentProviderOnResultsEndpoint);
            let resultsetsMeta: Interfaces.ISqlResultsetMeta[] = [];
            for (var index = 0; index < self._resultsets.length; index ++)
            {
                resultsetsMeta.push( <Interfaces.ISqlResultsetMeta> {
                    columnsUri: "/" + Constants.gOutputContentTypeColumns + "?id=" + index.toString(),
                    rowsUri: "/" + Constants.gOutputContentTypeRows + "?id=" + index.toString()
                });
            }
            let json = JSON.stringify(resultsetsMeta);
            //Utils.logDebug(json);
            res.send(json);
        });

        // add http handler for '/messages' - return all messages as a JSON string
        this._service.addHandler(Interfaces.ContentType.Messages, function(req, res) {
            Utils.logDebug(Constants.gMsgContentProviderOnMessagesEndpoint);
            let json = JSON.stringify(self._messages)
            //Utils.logDebug(json);
            res.send(json);
        });

        // add http handler for '/columns' - return column metadata as a JSON string
        this._service.addHandler(Interfaces.ContentType.Columns, function(req, res) {
            var id = req.query.id;
            Utils.logDebug(Constants.gMsgContentProviderOnColumnsEndpoint + id);
            let columnMetadata = self._resultsets[id].columns;
            let json = JSON.stringify(columnMetadata);
            //Utils.logDebug(json);
            res.send(json);
        });

        // add http handler for '/rows' - return rows end-point for a specific resultset
        this._service.addHandler(Interfaces.ContentType.Rows, function(req, res) {
            var id = req.query.id;
            Utils.logDebug(Constants.gMsgContentProviderOnRowsEndpoint + id);
            let json = JSON.stringify(self._resultsets[id].rows);
            //Utils.logDebug(json);
            res.send(json);
        });

        // start express server on localhost and listen on a random port
        try
        {
            this._service.start();
        }
        catch (error)
        {
            Utils.showErrorMsg(error);
            throw(error);
        }
    }

    private clear()
    {
        Utils.logDebug(Constants.gMsgContentProviderOnClear);
        this._messages = [];
        this._resultsets = [];
    }

    public show()
    {
        vscode.commands.executeCommand('vscode.previewHtml', SqlOutputContentProvider.providerUri, vscode.ViewColumn.Two);
    }

    public updateContent(messages, resultsets)
    {
        Utils.logDebug(Constants.gMsgContentProviderOnUpdateContent);
        this.clear();
        this.show();
        this._messages = messages;
        this._resultsets = resultsets;
        this.onContentUpdated();
    }

    // Called by VS Code exactly once to load html content in the preview window
    public provideTextDocumentContent(uri: vscode.Uri): string
    {
        Utils.logDebug(Constants.gMsgContentProviderProvideContent + uri.toString());

        // return dummy html content that redirects to 'http://localhost:<port>' after the page loads
        return `
                <html>
                    <head>
                        <script type="text/javascript">
                            window.onload = function(event) {
                                event.stopPropagation(true);
                                window.location.href="${LocalWebService.getEndpointUri(Interfaces.ContentType.Root)}";
                            };
                        </script>
                    </head>
                    <body></body>
                </html>`;
    }
}