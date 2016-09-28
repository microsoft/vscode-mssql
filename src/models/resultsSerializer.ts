import path = require('path');
import vscode = require('vscode');
import Constants = require('./constants');
import os = require('os');
import Interfaces = require('./interfaces');
import SqlToolsServerClient from '../languageservice/serviceclient';
import * as Contracts from '../models/contracts';
import * as Utils from '../models/utils';
import { QuestionTypes, IQuestion, IPrompter } from '../prompts/question';
import CodeAdapter from '../prompts/adapter';
import VscodeWrapper from '../controllers/vscodeWrapper';

/**
 *  Handles save results request from the context menu of slickGrid
 */
export default class ResultsSerializer {
    private _client: SqlToolsServerClient;
    private _prompter: IPrompter;
    private _vscodeWrapper: VscodeWrapper;
    private _filePath: string;

    constructor(client?: SqlToolsServerClient, prompter?: IPrompter, vscodeWrapper?: VscodeWrapper) {
        if (client) {
            this._client = client;
        } else {
            this._client = SqlToolsServerClient.instance;
        }
        if (prompter) {
            this._prompter = prompter;
        } else {
            this._prompter = new CodeAdapter();
        }
        if (vscodeWrapper) {
            this._vscodeWrapper = vscodeWrapper;
        } else {
            this._vscodeWrapper = new VscodeWrapper();
        }
    }

    private promptForFilepath(): Promise<string> {
        let questions: IQuestion[] = [
            // prompt user to enter file path
            {
                type: QuestionTypes.input,
                name: Constants.filepathPrompt,
                message: Constants.filepathPrompt,
                placeHolder: Constants.filepathPlaceholder,
                validate: (value) => this.validateFilePath(Constants.filepathPrompt, value)
            }];
        return this._prompter.prompt(questions).then(answers => {
                    if (answers) {
                        return answers[Constants.filepathPrompt];
                    }
                });
    }

    private getConfigForCsv(): Contracts.SaveResultsAsCsvRequestParams {
        // get save results config from vscode config
        let config = vscode.workspace.getConfiguration(Constants.extensionName);
        let saveConfig = config[Constants.configSaveAsCsv];
        let saveResultsParams = new Contracts.SaveResultsAsCsvRequestParams();

        if (saveConfig) {
            if (saveConfig.encoding) {
                saveResultsParams.fileEncoding  = saveConfig.encoding;
            }
            if (saveConfig.includeHeaders) {
                saveResultsParams.includeHeaders = saveConfig.includeHeaders;
            }
            if (saveConfig.valueInQuotes) {
                saveResultsParams.valueInQuotes = saveConfig.valueInQuotes;
            }
        }
        return saveResultsParams;
    }

    private getConfigForJson(): Contracts.SaveResultsAsJsonRequestParams {
        // get save results config from vscode config
        let config = vscode.workspace.getConfiguration(Constants.extensionName);
        let saveConfig = config[Constants.configSaveAsJson];
        let saveResultsParams = new Contracts.SaveResultsAsJsonRequestParams();

        if (saveConfig) {
            // TODO: assign config
        }
        return saveResultsParams;
    }

    private resolveFilePath(uri: string, filePath: string): string {
        // set params to values from config and send request to service
        let sqlUri = vscode.Uri.parse(uri);
        let currentDirectory: string;
        // user entered only the file name. Save file in current directory
        if (sqlUri.scheme === 'file') {
            currentDirectory = path.dirname(sqlUri.fsPath);
        } else if (sqlUri.scheme === 'untitled') {
            if (vscode.workspace.rootPath) {
                currentDirectory = vscode.workspace.rootPath;
            } else {
                currentDirectory = os.tmpdir();
            }
        } else {
            currentDirectory = path.dirname(sqlUri.path);
        }
        return path.normalize(path.join(currentDirectory, filePath));

    }

    /**
     * Send request to sql tools service to save a result set in CSV format
     */
    public sendCsvRequestToService(uri: string, filePath: string, batchIndex: number, resultSetNo: number, selection: Interfaces.ISlickRange): Thenable<void> {
        const self = this;
        if (!path.isAbsolute(filePath)) {
            this._filePath = self.resolveFilePath(uri, filePath);
        } else {
            this._filePath = filePath;
        }
        let saveResultsParams =  self.getConfigForCsv();
        saveResultsParams.filePath = this._filePath;
        saveResultsParams.ownerUri = uri;
        saveResultsParams.resultSetIndex = resultSetNo;
        saveResultsParams.batchIndex = batchIndex;
        if (this.isSelected(selection)) {
            saveResultsParams.rowStartIndex = selection.fromRow;
            saveResultsParams.rowEndIndex =  selection.toRow;
            saveResultsParams.columnStartIndex = selection.fromCell;
            saveResultsParams.columnEndIndex = selection.toCell;
        }

        // send message to the sqlserverclient for converting resuts to CSV and saving to filepath
        return self._client.sendRequest( Contracts.SaveResultsAsCsvRequest.type, saveResultsParams).then(result => {
                if (result.messages) {
                    self._vscodeWrapper.showErrorMessage(result.messages);
                } else {
                    self._vscodeWrapper.showInformationMessage('Results saved to ' + this._filePath);
                    self.openSavedFile(self._filePath);
                }
            }, error => {
                self._vscodeWrapper.showErrorMessage('Saving results failed: ' + error);
            });
    }

    /**
     * Check if a range of cells were selected.
     */
    public isSelected(selection:  Interfaces.ISlickRange): boolean {
        return (selection && !((selection.fromCell === selection.toCell) && (selection.fromRow === selection.toRow)));
    }

    /**
     * Send request to sql tools service to save a result set in JSON format
     */
    public sendJsonRequestToService(uri: string, filePath: string, batchIndex: number, resultSetNo: number, selection: Interfaces.ISlickRange): Thenable<void> {
        const self = this;
        if (!path.isAbsolute(filePath)) {
            this._filePath = self.resolveFilePath(uri, filePath);
        } else {
            this._filePath = filePath;
        }
        let saveResultsParams =  self.getConfigForJson();
        saveResultsParams.filePath = this._filePath;
        saveResultsParams.ownerUri = uri;
        saveResultsParams.resultSetIndex = resultSetNo;
        saveResultsParams.batchIndex = batchIndex;
        if (this.isSelected(selection)) {
            saveResultsParams.rowStartIndex = selection.fromRow;
            saveResultsParams.rowEndIndex =  selection.toRow;
            saveResultsParams.columnStartIndex = selection.fromCell;
            saveResultsParams.columnEndIndex = selection.toCell;
        }

        // send message to the sqlserverclient for converting resuts to JSON and saving to filepath
        return self._client.sendRequest( Contracts.SaveResultsAsJsonRequest.type, saveResultsParams).then(result => {
                if (result.messages) {
                    self._vscodeWrapper.showErrorMessage(result.messages);
                } else {
                    self._vscodeWrapper.showInformationMessage('Results saved to ' + this._filePath);
                    self.openSavedFile(self._filePath);
                }
            }, error => {
                self._vscodeWrapper.showErrorMessage('Saving results failed: ' + error);
            });
    }

    public onSaveResultsAsCsv(uri: string, batchIndex: number, resultSetNo: number, selection: Interfaces.ISlickRange[] ): Thenable<void> {
        const self = this;
        // prompt for filepath
        return self.promptForFilepath().then(function(filePath): void {
            self.sendCsvRequestToService(uri, filePath, batchIndex, resultSetNo, selection ? selection[0] : undefined);
        });
    }

    public onSaveResultsAsJson(uri: string, batchIndex: number, resultSetNo: number, selection: Interfaces.ISlickRange[] ): Thenable<void> {
        const self = this;
        // prompt for filepath
        return self.promptForFilepath().then(function(filePath): void {
            self.sendJsonRequestToService(uri, filePath, batchIndex, resultSetNo, selection ? selection[0] : undefined);
        });
    }

    // Open the saved file in a new vscode editor pane
    public openSavedFile(filePath: string): void {
            const self = this;
            let uri = vscode.Uri.file(filePath);
            self._vscodeWrapper.openTextDocument(uri).then((doc: vscode.TextDocument) => {
                    // Show open document and set focus
                    self._vscodeWrapper.showTextDocument(doc, 1, false).then(editor => {
                        // write message to output tab
                        self._vscodeWrapper.logToOutputChannel('Results saved to ' + filePath);
                    }, (error: any) => {
                        console.error(error);
                        self._vscodeWrapper.showErrorMessage(error);
                    });
             }, (error: any) => {
                 console.error(error);
             });
    }

    private validateFilePath(property: string, value: string): string {
        if (Utils.isEmpty(value.trim())) {
            return property + Constants.msgIsRequired;
        }
        return undefined;
    }
}
