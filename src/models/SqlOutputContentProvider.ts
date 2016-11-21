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
const fs = require('fs');

const deletionTimeoutTime = 1.8e6; // in ms, currently 30 minutes

// holds information about the state of a query runner
class QueryRunnerState {
    timeout: number;
    flaggedForDeletion: boolean;
    constructor (public queryRunner: QueryRunner) {
        this.flaggedForDeletion = false;
    }
}

class ResultsConfig implements Interfaces.IResultsConfig {
    shortcuts: { [key: string]: string };
    messagesDefaultOpen: boolean;
}

export class SqlOutputContentProvider implements vscode.TextDocumentContentProvider {
    // CONSTANTS ///////////////////////////////////////////////////////////
    public static providerName = 'tsqloutput';
    public static providerUri = vscode.Uri.parse('tsqloutput://');
    public static tempFileCount: number = 1;

    // MEMBER VARIABLES ////////////////////////////////////////////////////
    private _queryResultsMap: Map<string, QueryRunnerState> = new Map<string, QueryRunnerState>();
    private _service: LocalWebService;
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private _vscodeWrapper: VscodeWrapper;

    // CONSTRUCTOR /////////////////////////////////////////////////////////
    constructor(context: vscode.ExtensionContext, private _statusView: StatusView) {
        const self = this;

        this._vscodeWrapper = new VscodeWrapper();

        // create local express server
        this._service = new LocalWebService(context.extensionPath);
        this._service.newConnection.on('connection', (uri) => {
            if (self._queryResultsMap.has(uri)) {
                for (let batch of self._queryResultsMap.get(uri).queryRunner.batchSets) {
                    self._service.broadcast(uri, 'batch', batch);
                }

                if (!self._queryResultsMap.get(uri).queryRunner.isExecutingQuery) {
                    self._service.broadcast(uri, 'complete');
                }
            }
        });

        // add http handler for '/root'
        this._service.addHandler(Interfaces.ContentType.Root, (req, res): void => {
            let uri: string = req.query.uri;
            if (self._queryResultsMap.has(uri)) {
                clearTimeout(self._queryResultsMap.get(uri).timeout);
            }
            let theme: string = req.query.theme;
            let backgroundcolor: string = req.query.backgroundcolor;
            let color: string = req.query.color;
            let prod;
            try {
                fs.accessSync(path.join(LocalWebService.staticContentPath, Constants.contentProviderMinFile), fs.F_OK);
                prod = true;
            } catch (e) {
                prod = false;
            }
            let editorConfig = self._vscodeWrapper.getConfiguration('editor');
            let fontfamily = editorConfig.get<string>('fontFamily').split('\'').join('').split('"').join('');
            let fontsize = editorConfig.get<number>('fontSize') + 'px';
            let fontweight = editorConfig.get<string>('fontWeight');
            res.render(path.join(LocalWebService.staticContentPath, Constants.msgContentProviderSqlOutputHtml),
                {
                    uri: uri,
                    theme: theme,
                    backgroundcolor: backgroundcolor,
                    color: color,
                    fontfamily: fontfamily,
                    fontsize: fontsize,
                    fontweight: fontweight,
                    prod: prod
                }
            );
        });

        // add http handler for '/resultsetsMeta' - return metadata about columns & rows in multiple resultsets
        this._service.addHandler(Interfaces.ContentType.ResultsetsMeta, (req, res): void => {
            let tempBatchSets: Interfaces.IGridBatchMetaData[] = [];
            let uri: string = req.query.uri;
            if  (self._queryResultsMap.has(uri)) {
                self._queryResultsMap.get(uri).queryRunner.getBatchSets().then((batchSets) => {
                    for (let [batchIndex, batch] of batchSets.entries()) {
                        let tempBatch: Interfaces.IGridBatchMetaData = {
                            resultSets: [],
                            messages: batch.messages,
                            hasError: batch.hasError,
                            selection: batch.selection,
                            startTime: batch.executionStart,
                            endTime: batch.executionEnd,
                            totalTime: batch.executionElapsed
                        };
                        for (let [resultIndex, result] of batch.resultSetSummaries.entries()) {
                            let uriFormat = '/{0}?batchId={1}&resultId={2}&uri={3}';
                            let encodedUri = encodeURIComponent(uri);

                            tempBatch.resultSets.push( <Interfaces.IGridResultSet> {
                                columns: result.columnInfo,
                                rowsUri: Utils.formatString(uriFormat, Constants.outputContentTypeRows, batchIndex, resultIndex, encodedUri),
                                numberOfRows: result.rowCount
                            });
                        }
                        tempBatchSets.push(tempBatch);
                    }
                    let json = JSON.stringify(tempBatchSets);
                    res.send(json);
                });
            } else {
                // did not find query (most likely expired)
                let tempBatch: Interfaces.IGridBatchMetaData = {
                    resultSets: undefined,
                    messages: [{
                        time: undefined,
                        message: Constants.unfoundResult
                    }],
                    hasError: undefined,
                    selection: undefined,
                    startTime: undefined,
                    endTime: undefined,
                    totalTime: undefined
                };
                tempBatchSets.push(tempBatch);
                let json = JSON.stringify(tempBatchSets);
                res.send(json);
            }
        });

        // add http handler for '/columns' - return column metadata as a JSON string
        this._service.addHandler(Interfaces.ContentType.Columns, (req, res): void => {
            let resultId = req.query.resultId;
            let batchId = req.query.batchId;
            let uri: string = req.query.uri;
            self._queryResultsMap.get(uri).queryRunner.getBatchSets().then((data) => {
                let columnMetadata = data[batchId].resultSetSummaries[resultId].columnInfo;
                let json = JSON.stringify(columnMetadata);
                res.send(json);
            });
        });

        // add http handler for '/rows' - return rows end-point for a specific resultset
        this._service.addHandler(Interfaces.ContentType.Rows, (req, res): void => {
            let resultId = req.query.resultId;
            let batchId = req.query.batchId;
            let rowStart = req.query.rowStart;
            let numberOfRows = req.query.numberOfRows;
            let uri: string = req.query.uri;
            self._queryResultsMap.get(uri).queryRunner.getRows(rowStart, numberOfRows, batchId, resultId).then(results => {
                let json = JSON.stringify(results.resultSubset);
                res.send(json);
            });
        });

        this._service.addHandler(Interfaces.ContentType.Config, (req, res): void => {
            let extConfig = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
            let config = new ResultsConfig();
            for (let key of Constants.extConfigResultKeys) {
                config[key] = extConfig[key];
            }
            let json = JSON.stringify(config);
            res.send(json);
        });

        // add http handler for '/saveResults' - return success message as JSON
        this._service.addPostHandler(Interfaces.ContentType.SaveResults, (req, res): void => {
            let uri: string = req.query.uri;
            let queryUri = self._queryResultsMap.get(uri).queryRunner.uri;
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
        this._service.addPostHandler(Interfaces.ContentType.OpenLink, (req, res): void => {
            let content: string = req.body.content;
            let columnName: string = req.body.columnName;
            let linkType: string = req.body.type;
            self.openLink(content, columnName, linkType);
            res.status = 200;
            res.send();
        });

        // add http post handler for copying results
        this._service.addPostHandler(Interfaces.ContentType.Copy, (req, res): void => {
            let uri = req.query.uri;
            let resultId = req.query.resultId;
            let batchId = req.query.batchId;
            let includeHeaders = req.query.includeHeaders;
            let selection: Interfaces.ISlickRange[] = req.body;
            self._queryResultsMap.get(uri).queryRunner.copyResults(selection, batchId, resultId, includeHeaders).then(() => {
                res.status = 200;
                res.send();
            });
        });

        // add http post handler for setting the selection in the editor
        this._service.addPostHandler(Interfaces.ContentType.EditorSelection, (req, res): void => {
            let uri = req.query.uri;
            let selection: ISelectionData = req.body;
            self._queryResultsMap.get(uri).queryRunner.setEditorSelection(selection).then(() => {
                res.status = 200;
                res.send();
            });
        });

        // add http post handler for showing errors to user
        this._service.addPostHandler(Interfaces.ContentType.ShowError, (req, res): void => {
            let message: string = req.body.message;
            self._vscodeWrapper.showErrorMessage(message);
            // not attached to show function callback, since callback returns only after user closes message
            res.status = 200;
            res.send();
        });

        // add http post handler for showing warning to user
        this._service.addPostHandler(Interfaces.ContentType.ShowWarning, (req, res): void => {
            let message: string = req.body.message;
            self._vscodeWrapper.showWarningMessage(message);
            // not attached to show function callback, since callback returns only after user closes message
            res.status = 200;
            res.send();
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

    public update(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    // PUBLIC METHODS //////////////////////////////////////////////////////

    public isRunningQuery(uri: string): boolean {
        return !this._queryResultsMap.has(uri)
            ? false
            : this._queryResultsMap.get(uri).queryRunner.isExecutingQuery;
    }

    public runQuery(statusView, uri: string, selection: ISelectionData, title: string): void {
        // Reuse existing query runner if it exists
        let resultsUri = this.getResultsUri(uri);
        let queryRunner: QueryRunner;

        if (this._queryResultsMap.has(resultsUri)) {
            let existingRunner: QueryRunner = this._queryResultsMap.get(resultsUri).queryRunner;

            // If the query is already in progress, don't attempt to send it
            if (existingRunner.isExecutingQuery) {
                this._vscodeWrapper.showInformationMessage(Constants.msgRunQueryInProgress);
                return;
            }

            // If the query is not in progress, we can reuse the query runner
            queryRunner = existingRunner;

            // update the open pane assuming its open (if its not its a bug covered by the previewhtml command later)
            this.update(vscode.Uri.parse(resultsUri));
        } else {
            // We do not have a query runner for this editor, so create a new one
            // and map it to the results uri
            queryRunner = new QueryRunner(uri, title, statusView);
            queryRunner.batchResult.on('batch', (batch) => {
                this._service.broadcast(resultsUri, 'batch', batch);
            });
            queryRunner.batchResult.on('complete', () => {
                this._service.broadcast(resultsUri, 'complete');
            });
            this._queryResultsMap.set(resultsUri, new QueryRunnerState(queryRunner));
        }

        queryRunner.runQuery(selection);
        let paneTitle = Utils.formatString(Constants.titleResultsPane, queryRunner.title);
        // Always run this command even if just updating to avoid a bug - tfs 8686842
        vscode.commands.executeCommand('vscode.previewHtml', resultsUri, vscode.ViewColumn.Two, paneTitle);
    }

    public cancelQuery(input: QueryRunner | string): void {
        let self = this;
        let queryRunner: QueryRunner;

        if (typeof input === 'string') {
            let resultsUri = this.getResultsUri(input).toString();
            if (this._queryResultsMap.has(resultsUri)) {
                queryRunner = this._queryResultsMap.get(resultsUri).queryRunner;
            }
        } else {
            queryRunner = input;
        }

        if (queryRunner === undefined || !queryRunner.isExecutingQuery) {
            self._vscodeWrapper.showInformationMessage(Constants.msgCancelQueryNotRunning);
            return;
        }

        // Switch the spinner to canceling, which will be reset when the query execute sends back its completed event
        this._statusView.cancelingQuery(queryRunner.uri);

        // Cancel the query
        queryRunner.cancel().then(success => undefined, error => {
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
     * closed. If the query is in progress, it will be canceled. If there is a query at all,
     * the query will be disposed.
     * @param doc   The document that was closed
     */
    public onDidCloseTextDocument(doc: vscode.TextDocument): void {
        for (let [key, value] of this._queryResultsMap.entries()) {
            // closed text document related to a results window we are holding
            if (doc.uri.toString() === value.queryRunner.uri) {
                value.flaggedForDeletion = true;
            }

            // "closed" a results window we are holding
            if (doc.uri.toString() === key) {
                value.timeout = this.setRunnerDeletionTimeout(key);
            }
        }
    }

    private setRunnerDeletionTimeout(uri: string): number {
        const self = this;
        return setTimeout(() => {
            let queryRunnerState = self._queryResultsMap.get(uri);
            if (queryRunnerState.flaggedForDeletion) {
                self._queryResultsMap.delete(uri);

                if (queryRunnerState.queryRunner.isExecutingQuery) {
                    // We need to cancel it, which will dispose it
                    this.cancelQuery(queryRunnerState.queryRunner);
                } else {
                    // We need to explicitly dispose the query
                    queryRunnerState.queryRunner.dispose();
                }
            } else {
                queryRunnerState.timeout = this.setRunnerDeletionTimeout(uri);
            }

        }, deletionTimeoutTime);
    }

    // Called by VS Code exactly once to load html content in the preview window
    public provideTextDocumentContent(uri: vscode.Uri): string {
        // URI needs to be encoded as a component for proper inclusion in a url
        let encodedUri = encodeURIComponent(uri.toString());

        // return dummy html content that redirects to 'http://localhost:<port>' after the page loads
        return `
        <html>
        <head>
            <script type="text/javascript">
                window.onload = function(event) {
                    var doc = document.documentElement;
                    var styles = window.getComputedStyle(doc);
                    var backgroundcolor = styles.getPropertyValue('--background-color');
                    var color = styles.getPropertyValue('--color');
                    var theme = document.body.className;
                    var url = "${LocalWebService.getEndpointUri(Interfaces.ContentType.Root)}?" +
                            "uri=${encodedUri}" +
                            "&theme=" + theme +
                            "&backgroundcolor=" + backgroundcolor +
                            "&color=" + color;
                    document.getElementById('frame').src = url;
                };
            </script>
        </head>
        <body style="margin: 0; padding: 0; height: 100%; overflow: hidden;">
            <iframe id="frame" width="100%" height="100%" frameborder="0" style="position:absolute; left: 0; right: 0; bottom: 0; top: 0px;"/>
        </body>
        </html>`;
    }

    /**
     * Open a xml/json link - Opens the content in a new editor pane
     */
    public openLink(content: string, columnName: string, linkType: string): void {
        const self = this;
        let tempFileName = self.getXmlTempFileName(columnName, linkType);
        let uri = vscode.Uri.parse('untitled:' + tempFileName);
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
                }).then(result => {
                    if (!result) {
                        self._vscodeWrapper.showErrorMessage(Constants.msgCannotOpenContent);
                    }
                });
            }, (error: any) => {
                self._vscodeWrapper.showErrorMessage(error);
            });
        }, (error: any) => {
            self._vscodeWrapper.showErrorMessage(error);
        });
    }

    /**
     * Return the query for a file uri
     */
    public getQueryRunner(uri: string): QueryRunner {
        let resultsUri = this.getResultsUri(uri).toString();
        if (this._queryResultsMap.has(resultsUri)) {
            return  this._queryResultsMap.get(resultsUri).queryRunner;
        } else {
            return undefined;
        }
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
        return vscode.Uri.parse(SqlOutputContentProvider.providerUri + srcUri).toString();
    }

    /**
     * Return temp file name for opening a link
     */
    private getXmlTempFileName(columnName: string, linkType: string): string {
        if (columnName === 'XML Showplan') {
            columnName = 'Showplan';
        }
        let baseFileName = columnName + '-';
        let retryCount: number = 200;
        for (let i = 0; i < retryCount; i++) {
            let tempFileName = path.join(os.tmpdir(), baseFileName + SqlOutputContentProvider.tempFileCount + '.' + linkType);
            SqlOutputContentProvider.tempFileCount++;
            if (!Utils.isFileExisting(tempFileName)) {
                return tempFileName;
            }
        }
        return path.join(os.tmpdir(), columnName + '_' + String(Math.floor( Date.now() / 1000)) + String(process.pid) + '.' + linkType);
    }
}
