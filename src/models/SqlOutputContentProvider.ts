'use strict';
import vscode = require('vscode');
import path = require('path');
import os = require('os');
import Constants = require('./constants');
import LocalWebService from '../controllers/localWebService';
import Utils = require('./utils');
import Interfaces = require('./interfaces');
import QueryRunner from '../controllers/QueryRunner';
import ResultsSerializer from  '../models/resultsSerializer';
import StatusView from '../views/statusView';
import VscodeWrapper from './../controllers/vscodeWrapper';
import { ISelectionData } from './interfaces';
const pd = require('pretty-data').pd;

export class SqlOutputContentProvider implements vscode.TextDocumentContentProvider {
    // CONSTANTS ///////////////////////////////////////////////////////////
    public static providerName = 'tsqloutput';
    public static providerUri = vscode.Uri.parse('tsqloutput://');
    public static tempFileCount: number = 1;

    // MEMBER VARIABLES ////////////////////////////////////////////////////
    private _queryResultsMap: Map<string, QueryRunner> = new Map<string, QueryRunner>();
    private _service: LocalWebService;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _vscodeWrapper: VscodeWrapper;

    // CONSTRUCTOR /////////////////////////////////////////////////////////
    constructor(context: vscode.ExtensionContext, private _statusView: StatusView) {
        const self = this;

        this._vscodeWrapper = new VscodeWrapper();

        // create local express server
        this._service = new LocalWebService(context.extensionPath);

        // add http handler for '/root'
        this._service.addHandler(Interfaces.ContentType.Root, function(req, res): void {
            let uri: string = decodeURIComponent(req.query.uri);
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
            let tempBatchSets: Interfaces.IGridBatchMetaData[] = [];
            let uri: string = decodeURIComponent(req.query.uri);
            self._queryResultsMap.get(uri).getBatchSets().then((batchSets) => {
                for (let [batchIndex, batch] of batchSets.entries()) {
                    let tempBatch: Interfaces.IGridBatchMetaData = {
                        resultSets: [],
                        messages: batch.messages,
                        hasError: batch.hasError,
                        selection: batch.selection
                    };
                    for (let [resultIndex, result] of batch.resultSetSummaries.entries()) {
                        let uriFormat = '/{0}?batchId={1}&resultId={2}&uri={3}';
                        let encodedUri = encodeURIComponent(uri);

                        tempBatch.resultSets.push( <Interfaces.IGridResultSet> {
                            columnsUri: Utils.formatString(uriFormat, Constants.outputContentTypeColumns, batchIndex, resultIndex, encodedUri),
                            rowsUri: Utils.formatString(uriFormat, Constants.outputContentTypeRows, batchIndex, resultIndex, encodedUri),
                            numberOfRows: result.rowCount
                        });
                    }
                    tempBatchSets.push(tempBatch);
                }
                let json = JSON.stringify(tempBatchSets);
                res.send(json);
            });
        });

        // add http handler for '/columns' - return column metadata as a JSON string
        this._service.addHandler(Interfaces.ContentType.Columns, function(req, res): void {
            let resultId = req.query.resultId;
            let batchId = req.query.batchId;
            let uri: string = decodeURIComponent(req.query.uri);
            self._queryResultsMap.get(uri).getBatchSets().then((data) => {
                let columnMetadata = data[batchId].resultSetSummaries[resultId].columnInfo;
                let json = JSON.stringify(columnMetadata);
                res.send(json);
            });
        });

        // add http handler for '/rows' - return rows end-point for a specific resultset
        this._service.addHandler(Interfaces.ContentType.Rows, function(req, res): void {
            let resultId = req.query.resultId;
            let batchId = req.query.batchId;
            let rowStart = req.query.rowStart;
            let numberOfRows = req.query.numberOfRows;
            let uri: string = decodeURIComponent(req.query.uri);
            self._queryResultsMap.get(uri).getRows(rowStart, numberOfRows, batchId, resultId).then(results => {
                let json = JSON.stringify(results.resultSubset);
                res.send(json);
            });
        });

        // add http handler for '/saveResults' - return success message as JSON
        this._service.addPostHandler(Interfaces.ContentType.SaveResults, function(req, res): void {
            let uri: string = decodeURI(req.query.uri);
            let queryUri = self._queryResultsMap.get(uri).uri;
            let selectedResultSetNo: number = Number(req.query.resultSetNo);
            let batchIndex: number = Number(req.query.batchIndex);
            let format: string = req.query.format;
            let selection: Interfaces.ISlickRange[] = req.body;
            let saveResults = new ResultsSerializer();
            saveResults.onSaveResults(queryUri, batchIndex, selectedResultSetNo, format, selection);
            res.status = 200;
            res.send();
        });

        // add http handler for '/openLink' - open content in a new vscode editor pane
        this._service.addPostHandler(Interfaces.ContentType.OpenLink, function(req, res): void {
            let content: string = req.body.content;
            let columnName: string = req.body.columnName;
            let linkType: string = req.body.type;
            self.openLink(content, columnName, linkType);
            res.status = 200;
            res.send();
        });

        // add http post handler for copying results
        this._service.addPostHandler(Interfaces.ContentType.Copy, function(req, res): void {
            let uri = req.query.uri.toString();
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
            let uri = req.query.uri.toString();
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

    // PROPERTIES //////////////////////////////////////////////////////////

    public get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public onContentUpdated(): void {
        this._onDidChange.fire(SqlOutputContentProvider.providerUri);
    }

    // PUBLIC METHODS //////////////////////////////////////////////////////

    public isRunningQuery(uri: string): boolean {
        return !this._queryResultsMap.has(uri)
            ? false
            : this._queryResultsMap.get(uri).isExecutingQuery;
    }

    public runQuery(statusView, uri: string, selection: ISelectionData, title: string): void {
        // Reuse existing query runner if it exists
        let resultsUri = decodeURIComponent(this.getResultsUri(uri));
        let queryRunner: QueryRunner;
        if (this._queryResultsMap.has(resultsUri)) {
            queryRunner = this._queryResultsMap.get(resultsUri);
        } else {
            queryRunner = new QueryRunner(uri, title, statusView);
            this._queryResultsMap.set(resultsUri, queryRunner);
        }

        // Execute the query
        let paneTitle = Utils.formatString(Constants.titleResultsPane, queryRunner.title);
        vscode.commands.executeCommand('vscode.previewHtml', resultsUri, vscode.ViewColumn.Two, paneTitle);
        queryRunner.runQuery(selection);
    }

    public cancelQuery(uri: string): void {
        let self = this;

        // Cancel the query
        let resultsUri = this.getResultsUri(uri).toString();
        this._queryResultsMap.get(resultsUri).cancel().then(success => {
            // On success, dispose of the query runner
            self._queryResultsMap.delete(resultsUri);
        }, error => {
            // On error, show error message
            self._vscodeWrapper.showErrorMessage(Utils.formatString(Constants.msgCancelQueryFailed, error));
        });
    }

    /**
     * Executed from the MainController when an untitled text document was saved to the disk. If
     * any queries were executed from the untitled document, the queryrunner will be remapped to
     * a new resuls uri based on the uri of the newly saved file.
     * @param untitledUri   The URI of the untitled file
     * @param savedUri  The URI of the file after it was saved
     */
    public onUntitledFileSaved(untitledUri: string, savedUri: string): void {
        // If we don't have any query runners mapped to this uri, don't do anything
        let untitledResultsUri = decodeURIComponent(this.getResultsUri(untitledUri));
        if (!this._queryResultsMap.has(untitledResultsUri)) {
            return;
        }

        // NOTE: We don't need to remap the query in the service because the queryrunner still has
        // the old uri. As long as we make requests to the service against that uri, we'll be good.

        // Remap the query runner in the map
        let savedResultUri = decodeURIComponent(this.getResultsUri(savedUri));
        this._queryResultsMap.set(savedResultUri, this._queryResultsMap.get(untitledResultsUri));
        this._queryResultsMap.delete(untitledResultsUri);
    }

    /**
     * Executed from the MainController when a text document (that already exists on disk) was
     * closed. If the query is in progress, it will be cancelled. If there is a query at all,
     * the query will be disposed.
     * @param doc   The document that was closed
     */
    public onDidCloseTextDocument(doc: vscode.TextDocument): void {
        // If there isn't a query runner for this uri, then nothing to do
        let uri = doc.uri.toString();
        if (!this._queryResultsMap.has(uri)) {
            return;
        }

        // Is the query in progress
        let queryRunner: QueryRunner = this._queryResultsMap.get(uri);
        if (queryRunner.isExecutingQuery) {
            // We need to cancel it, which will dispose it
            this.cancelQuery(uri);
        } else {
            // We need to explicitly dispose the query
            queryRunner.dispose();
        }

        // Unmap the uri to the queryrunner
        this._queryResultsMap.delete(uri);
    }

    // Called by VS Code exactly once to load html content in the preview window
    public provideTextDocumentContent(uri: vscode.Uri): string {
        // URI needs to be encoded as a component for proper inclusion in a url
        let encodedUri = encodeURIComponent(uri.toString());

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
                var url = "${LocalWebService.getEndpointUri(Interfaces.ContentType.Root)}?" +
                          "uri=${encodedUri}" +
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

    /**
     * Open a xml/json link - Opens the content in a new editor pane
     */
    public openLink(content: string, columnName: string, linkType: string): void {
        const self = this;
        let tempFileName = self.getXmlTempFileName(columnName, linkType);
        let tempFilePath = path.join(os.tmpdir(), tempFileName);
        let uri = vscode.Uri.parse('untitled:' + tempFilePath);
        if (linkType === 'xml') {
            try {
                content = pd.xml(content);
            } catch (e) {
                // If Xml fails to parse, fall back on original Xml content
            }
        } else if (linkType === 'json') {
            let jsonContent: string = undefined;
            try {
                jsonContent = JSON.parse(content);
            } catch (e) {
                // If Json fails to parse, fall back on original Json content
            }
            if (jsonContent) {
                // If Json content was valid and parsed, pretty print content to a string
                content = JSON.stringify(jsonContent, undefined, 4);
            }
        }

        vscode.workspace.openTextDocument(uri).then((doc: vscode.TextDocument) => {
            vscode.window.showTextDocument(doc, 1, false).then(editor => {
                editor.edit(edit => {
                    edit.insert(new vscode.Position(0, 0), content);
                });
            });
        }, (error: any) => {
            self._vscodeWrapper.showErrorMessage(error);
        });
    }

    // PRIVATE HELPERS /////////////////////////////////////////////////////

    /**
     * Generates a URI for the results pane. NOTE: this MUST be encoded using encodeURIComponent()
     * before outputting as part of a URI (ie, as a query param in an href)
     * @param srcUri    The URI for the source file where the SQL was executed from
     * @returns The URI for the results pane
     */
    private getResultsUri(srcUri: string): string {
        // NOTE: The results uri will be encoded when we parse it to a uri
        return SqlOutputContentProvider.providerUri + srcUri;
    }

    /**
     * Return temp file name for opening a link
     */
    private getXmlTempFileName(columnName: string, linkType: string): string {
        let baseFileName = columnName + '_';
        let retryCount: number = 200;
        for (let i = 0; i < retryCount; i++) {
            let tempFileName = path.join(os.tmpdir(), baseFileName + SqlOutputContentProvider.tempFileCount + '.' + linkType);
            SqlOutputContentProvider.tempFileCount++;
            if (!Utils.isFileExisting(tempFileName)) {
                return tempFileName;
            }
        }
        return columnName + '_' + String(Math.floor( Date.now() / 1000)) + String(process.pid) + '.' + linkType;
    }
}
