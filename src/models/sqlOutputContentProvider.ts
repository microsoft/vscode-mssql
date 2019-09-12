/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import vscode = require('vscode');
import Constants = require('../constants/constants');
import LocalizedConstants = require('../constants/localizedConstants');
import Utils = require('./utils');
import Interfaces = require('./interfaces');
import QueryRunner from '../controllers/queryRunner';
import ResultsSerializer from  '../models/resultsSerializer';
import StatusView from '../views/statusView';
import VscodeWrapper from './../controllers/vscodeWrapper';
import { ISelectionData, ISlickRange } from './interfaces';
import { WebviewPanelController } from '../controllers/webviewController';
import { IServerProxy } from '../protocol';
import { ResultSetSubset } from './contracts/queryExecute';
const pd = require('pretty-data').pd;

const deletionTimeoutTime = 1.8e6; // in ms, currently 30 minutes

// holds information about the state of a query runner
export class QueryRunnerState {
    timeout: NodeJS.Timer;
    flaggedForDeletion: boolean;
    constructor (public queryRunner: QueryRunner) {
        this.flaggedForDeletion = false;
    }
}

class ResultsConfig implements Interfaces.IResultsConfig {
    shortcuts: { [key: string]: string };
    messagesDefaultOpen: boolean;
}

export class SqlOutputContentProvider {

    // MEMBER VARIABLES ////////////////////////////////////////////////////
    private _queryResultsMap: Map<string, QueryRunnerState> = new Map<string, QueryRunnerState>();
    private _vscodeWrapper: VscodeWrapper;
    private _panels = new Map<string, WebviewPanelController>();

    // CONSTRUCTOR /////////////////////////////////////////////////////////
    constructor(private context: vscode.ExtensionContext, private _statusView: StatusView) {
        this._vscodeWrapper = new VscodeWrapper();
    }

    public rowRequestHandler(uri: string, batchId: number, resultId: number, rowStart: number, numberOfRows: number): Promise<ResultSetSubset> {
       return this._queryResultsMap.get(uri).queryRunner.getRows(rowStart, numberOfRows, batchId, resultId).then((r => r.resultSubset));
    }

    public configRequestHandler(uri: string): Promise<Interfaces.IResultsConfig> {
        let queryUri = this._queryResultsMap.get(uri).queryRunner.uri;
        let extConfig = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName, queryUri);
        let config = new ResultsConfig();
        for (let key of Constants.extConfigResultKeys) {
            config[key] = extConfig[key];
        }
        return Promise.resolve(config);
    }

    public saveResultsRequestHandler(uri: string, batchId: number, resultId: number, format: string, selection: Interfaces.ISlickRange[]): void {
        let saveResults = new ResultsSerializer();
        saveResults.onSaveResults(uri, batchId, resultId, format, selection);
    }

    public openLinkRequestHandler(content: string, columnName: string, linkType: string): void {
        this.openLink(content, columnName, linkType);
    }

    public copyRequestHandler(uri: string, batchId: number, resultId: number, selection: Interfaces.ISlickRange[], includeHeaders?: boolean): void {
        this._queryResultsMap.get(uri).queryRunner.copyResults(selection, batchId, resultId, includeHeaders);
    }

    public editorSelectionRequestHandler(uri: string, selection: ISelectionData): void {
        this._queryResultsMap.get(uri).queryRunner.setEditorSelection(selection);
    }

    public showErrorRequestHandler(message: string): void {
        this._vscodeWrapper.showErrorMessage(message);
    }

    public showWarningRequestHandler(message: string): void {
        this._vscodeWrapper.showWarningMessage(message);
    }

    // PUBLIC METHODS //////////////////////////////////////////////////////

    public isRunningQuery(uri: string): boolean {
        return !this._queryResultsMap.has(uri)
            ? false
            : this._queryResultsMap.get(uri).queryRunner.isExecutingQuery;
    }

    public async runQuery(
            statusView: any, uri: string,
            selection: ISelectionData, title: string): Promise<void> {
        // execute the query with a query runner
        await this.runQueryCallback(statusView ? statusView : this._statusView, uri, title,
            (queryRunner) => {
                if (queryRunner) {
                    queryRunner.runQuery(selection);
                }
            });
    }

    public async runCurrentStatement(
            statusView: any, uri: string,
            selection: ISelectionData, title: string): Promise<void> {
        // execute the statement with a query runner
        await this.runQueryCallback(statusView ? statusView : this._statusView, uri, title,
            (queryRunner) => {
                if (queryRunner) {
                    queryRunner.runStatement(selection.startLine, selection.startColumn);
                }
            });
    }

    private async runQueryCallback(
            statusView: any, uri: string, title: string,
            queryCallback: any): Promise<void> {
        let queryRunner = await this.createQueryRunner(statusView ? statusView : this._statusView, uri, title);
        if (this._panels.has(uri)) {
            let panelController = this._panels.get(uri);
            if (panelController.isDisposed) {
                this._panels.delete(uri);
                await this.createWebviewController(uri, title, queryRunner);
            } else {
                queryCallback(queryRunner);
                return;
            }
        } else {
            await this.createWebviewController(uri, title, queryRunner);
        }
        if (queryRunner) {
            queryCallback(queryRunner);
        }
    }

    private async createWebviewController(uri: string, title: string, queryRunner: QueryRunner): Promise<void> {
        const proxy: IServerProxy = {
            getRows: (batchId: number, resultId: number, rowStart: number, numberOfRows: number) =>
                this.rowRequestHandler(uri, batchId, resultId, rowStart, numberOfRows),
            copyResults: (batchId: number, resultsId: number, selection: ISlickRange[], includeHeaders?: boolean) =>
                this.copyRequestHandler(uri, batchId, resultsId, selection, includeHeaders),
            getConfig: () => this.configRequestHandler(uri),
            getLocalizedTexts: () => Promise.resolve(LocalizedConstants),
            openLink: (content: string, columnName: string, linkType: string) =>
                this.openLinkRequestHandler(content, columnName, linkType),
            saveResults: (batchId: number, resultId: number, format: string, selection: ISlickRange[]) =>
                this.saveResultsRequestHandler(uri, batchId, resultId, format, selection),
            setEditorSelection: (selection: ISelectionData) => this.editorSelectionRequestHandler(uri, selection),
            showError: (message: string) => this.showErrorRequestHandler(message),
            showWarning: (message: string) => this.showWarningRequestHandler(message)
        };
        const controller = new WebviewPanelController(uri, title, proxy, this.context.extensionPath, queryRunner);
        this._panels.set(uri, controller);
        await controller.init();
    }

    private createQueryRunner(statusView: any, uri: string, title: string): QueryRunner {
        // Reuse existing query runner if it exists
        let queryRunner: QueryRunner;

        if (this._queryResultsMap.has(uri)) {
            let existingRunner: QueryRunner = this._queryResultsMap.get(uri).queryRunner;

            // If the query is already in progress, don't attempt to send it
            if (existingRunner.isExecutingQuery) {
                this._vscodeWrapper.showInformationMessage(LocalizedConstants.msgRunQueryInProgress);
                return;
            }

            // If the query is not in progress, we can reuse the query runner
            queryRunner = existingRunner;
            queryRunner.resetHasCompleted();
        } else {
            // We do not have a query runner for this editor, so create a new one
            // and map it to the results uri
            queryRunner = new QueryRunner(uri, title, statusView ? statusView : this._statusView);
            queryRunner.eventEmitter.on('start', (panelUri) => {
                this._panels.get(uri).proxy.sendEvent('start', panelUri);
            });
            queryRunner.eventEmitter.on('resultSet', (resultSet) => {
                this._panels.get(uri).proxy.sendEvent('resultSet', resultSet);
            });
            queryRunner.eventEmitter.on('batchStart', (batch) => {
                // Build a message for the selection and send the message
                // from the webview
                let message = {
                    message: LocalizedConstants.runQueryBatchStartMessage,
                    selection: batch.selection,
                    isError: false,
                    time: new Date().toLocaleTimeString(),
                    link: {
                        text: Utils.formatString(LocalizedConstants.runQueryBatchStartLine, batch.selection.startLine + 1)
                    }
                };
                this._panels.get(uri).proxy.sendEvent('message', message);
            });
            queryRunner.eventEmitter.on('message', (message) => {
                this._panels.get(uri).proxy.sendEvent('message', message);
            });
            queryRunner.eventEmitter.on('complete', (totalMilliseconds) => {
                this._panels.get(uri).proxy.sendEvent('complete', totalMilliseconds);
            });
            this._queryResultsMap.set(uri, new QueryRunnerState(queryRunner));
        }

        return queryRunner;
    }

    public cancelQuery(input: QueryRunner | string): void {
        let self = this;
        let queryRunner: QueryRunner;

        if (typeof input === 'string') {
            if (this._queryResultsMap.has(input)) {
                // Option 1: The string is a results URI (the results tab has focus)
                queryRunner = this._queryResultsMap.get(input).queryRunner;
            }
        } else {
            queryRunner = input;
        }

        if (queryRunner === undefined || !queryRunner.isExecutingQuery) {
            self._vscodeWrapper.showInformationMessage(LocalizedConstants.msgCancelQueryNotRunning);
            return;
        }

        // Switch the spinner to canceling, which will be reset when the query execute sends back its completed event
        this._statusView.cancelingQuery(queryRunner.uri);

        // Cancel the query
        queryRunner.cancel().then(success => undefined, error => {
            // On error, show error message
            self._vscodeWrapper.showErrorMessage(Utils.formatString(LocalizedConstants.msgCancelQueryFailed, error.message));
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
        let untitledResultsUri = decodeURIComponent(untitledUri);
        if (!this._queryResultsMap.has(untitledResultsUri)) {
            return;
        }

        // NOTE: We don't need to remap the query in the service because the queryrunner still has
        // the old uri. As long as we make requests to the service against that uri, we'll be good.

        // Remap the query runner in the map
        let savedResultUri = decodeURIComponent(savedUri);
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

    private setRunnerDeletionTimeout(uri: string): NodeJS.Timer {
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

    /**
     * Open a xml/json link - Opens the content in a new editor pane
     */
    public openLink(content: string, columnName: string, linkType: string): void {
        const self = this;
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

        vscode.workspace.openTextDocument({ language: linkType }).then((doc: vscode.TextDocument) => {
            vscode.window.showTextDocument(doc, 1, false).then(editor => {
                editor.edit(edit => {
                    edit.insert(new vscode.Position(0, 0), content);
                }).then(result => {
                    if (!result) {
                        self._vscodeWrapper.showErrorMessage(LocalizedConstants.msgCannotOpenContent);
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
        if (this._queryResultsMap.has(uri)) {
            return  this._queryResultsMap.get(uri).queryRunner;
        } else {
            return undefined;
        }
    }

    // PRIVATE HELPERS /////////////////////////////////////////////////////

    /**
     * Returns which column should be used for a new result pane
     * @return ViewColumn to be used
     * public for testing purposes
     */
    public newResultPaneViewColumn(queryUri: string): vscode.ViewColumn {
        // Find configuration options
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName, queryUri);
        let splitPaneSelection = config[Constants.configSplitPaneSelection];
        let viewColumn: vscode.ViewColumn;


        switch (splitPaneSelection) {
        case 'current' :
            viewColumn = this._vscodeWrapper.activeTextEditor.viewColumn;
            break;
        case 'end' :
            viewColumn = vscode.ViewColumn.Three;
            break;
        // default case where splitPaneSelection is next or anything else
        default :
            if (this._vscodeWrapper.activeTextEditor.viewColumn === vscode.ViewColumn.One) {
                viewColumn = vscode.ViewColumn.Two;
            } else {
                viewColumn = vscode.ViewColumn.Three;
            }
        }

        return viewColumn;
    }

    set setVscodeWrapper(wrapper: VscodeWrapper) {
        this._vscodeWrapper = wrapper;
    }

    get getResultsMap(): Map<string, QueryRunnerState> {
        return this._queryResultsMap;
    }

    set setResultsMap(setMap: Map<string, QueryRunnerState>) {
        this._queryResultsMap = setMap;
    }
}
