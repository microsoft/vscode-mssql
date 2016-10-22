import path = require('path');
import vscode = require('vscode');
import Constants = require('./constants');
import os = require('os');
import fs = require('fs');
import Interfaces = require('./interfaces');
import SqlToolsServerClient from '../languageservice/serviceclient';
import * as Contracts from '../models/contracts';
import {RequestType} from 'vscode-languageclient';
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
    private _uri: string;
    private _filePath: string;
    private _isTempFile: boolean;


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
        const self = this;
        let prompted: boolean = false;
        let filepathPlaceHolder = self.resolveCurrentDirectory(self._uri);
        let questions: IQuestion[] = [
            // prompt user to enter file path
            {
                type: QuestionTypes.input,
                name: Constants.filepathPrompt,
                message: Constants.filepathMessage,
                placeHolder: filepathPlaceHolder,
                validate: (value) => this.validateFilePath(Constants.filepathPrompt, value)
            },
            // prompt to overwrite file if file already exists
            {
                type: QuestionTypes.confirm,
                name: Constants.overwritePrompt,
                message: Constants.overwritePrompt,
                placeHolder: Constants.overwritePlaceholder,
                shouldPrompt: (answers) => this.fileExists(answers[Constants.filepathPrompt]),
                onAnswered: (value) => prompted = true
            }
        ];
        return this._prompter.prompt(questions).then(answers => {
            if (answers && answers[Constants.filepathPrompt] ) {
                // return filename if file does not exist or if user opted to overwrite file
                if (!prompted || (prompted && answers[Constants.overwritePrompt])) {
                     return answers[Constants.filepathPrompt];
                }
                // call prompt again if user did not opt to overwrite
                if (prompted && !answers[Constants.overwritePrompt]) {
                    return self.promptForFilepath();
                }
            }
        });
    }

    private fileExists(filePath: string): boolean {
        const self = this;
        // resolve filepath
        if (!path.isAbsolute(filePath)) {
            filePath = self.resolveFilePath(this._uri, filePath);
        }
        if (self._isTempFile) {
            return false;
        }
        // check if file already exists on disk
        try {
            fs.statSync(filePath);
            return true;
        } catch (err) {
            return false;
        }

    }

    private getConfigForCsv(): Contracts.SaveResultsAsCsvRequestParams {
        // get save results config from vscode config
        let config = vscode.workspace.getConfiguration(Constants.extensionName);
        let saveConfig = config[Constants.configSaveAsCsv];
        let saveResultsParams = new Contracts.SaveResultsAsCsvRequestParams();

        // if user entered config, set options
        if (saveConfig) {
            if (saveConfig.includeHeaders) {
                saveResultsParams.includeHeaders = saveConfig.includeHeaders;
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

    private resolveCurrentDirectory(uri: string): string {
        const self = this;
        self._isTempFile = false;
        let sqlUri = vscode.Uri.parse(uri);
        let currentDirectory: string;

        // use current directory of the sql file if sql file is saved
        if (sqlUri.scheme === 'file') {
            currentDirectory = path.dirname(sqlUri.fsPath);
        } else if (sqlUri.scheme === 'untitled') {
            // if sql file is unsaved/untitled but a workspace is open
            if (vscode.workspace.rootPath) {
                currentDirectory = vscode.workspace.rootPath;
            } else {
                currentDirectory = os.tmpdir();
                self._isTempFile = true;
            }
        } else {
            currentDirectory = path.dirname(sqlUri.path);
        }
        return currentDirectory;
    }

    private resolveFilePath(uri: string, filePath: string): string {
        const self = this;
        let currentDirectory = self.resolveCurrentDirectory(uri);
        return path.normalize(path.join(currentDirectory, filePath));
    }

    private validateFilePath(property: string, value: string): string {
        if (Utils.isEmpty(value.trim())) {
            return property + Constants.msgIsRequired;
        }
        return undefined;
    }

    private getParameters(filePath: string, batchIndex: number, resultSetNo: number, format: string, selection: Interfaces.ISlickRange):
                                                        Contracts.SaveResultsAsCsvRequestParams | Contracts.SaveResultsAsJsonRequestParams {
        const self = this;
        let saveResultsParams: Contracts.SaveResultsAsCsvRequestParams | Contracts.SaveResultsAsJsonRequestParams;
        if (!path.isAbsolute(filePath)) {
            this._filePath = self.resolveFilePath(this._uri, filePath);
        } else {
            this._filePath = filePath;
        }

        if (format === 'csv') {
            saveResultsParams =  self.getConfigForCsv();
        } else if (format === 'json') {
            saveResultsParams =  self.getConfigForJson();
        }

        saveResultsParams.filePath = this._filePath;
        saveResultsParams.ownerUri = this._uri;
        saveResultsParams.resultSetIndex = resultSetNo;
        saveResultsParams.batchIndex = batchIndex;
        if (this.isSelected(selection)) {
            saveResultsParams.rowStartIndex = selection.fromRow;
            saveResultsParams.rowEndIndex =  selection.toRow;
            saveResultsParams.columnStartIndex = selection.fromCell;
            saveResultsParams.columnEndIndex = selection.toCell;
        }
        return saveResultsParams;
    }


    /**
     * Check if a range of cells were selected.
     */
    public isSelected(selection:  Interfaces.ISlickRange): boolean {
        return (selection && !((selection.fromCell === selection.toCell) && (selection.fromRow === selection.toRow)));
    }


    /**
     * Send request to sql tools service to save a result set
     */
    public sendRequestToService( filePath: string, batchIndex: number, resultSetNo: number, format: string, selection: Interfaces.ISlickRange):
                                                                                                                                        Thenable<void> {
        const self = this;
        let saveResultsParams =  self.getParameters( filePath, batchIndex, resultSetNo, format, selection);
        let type: RequestType<Contracts.SaveResultsRequestParams, Contracts.SaveResultRequestResult, void>;
        if (format === 'csv') {
            type = Contracts.SaveResultsAsCsvRequest.type;
        } else if (format === 'json') {
            type = Contracts.SaveResultsAsJsonRequest.type;
        }

        self._vscodeWrapper.logToOutputChannel(Constants.msgSaveStarted + this._filePath);

        // send message to the sqlserverclient for converting resuts to the requested format and saving to filepath
        return self._client.sendRequest( type, saveResultsParams).then(result => {
                if (result.messages) {
                    self._vscodeWrapper.showErrorMessage(Constants.msgSaveFailed + result.messages);
                    self._vscodeWrapper.logToOutputChannel(Constants.msgSaveFailed + result.messages);
                } else {
                    self._vscodeWrapper.showInformationMessage(Constants.msgSaveSucceeded + this._filePath);
                    self._vscodeWrapper.logToOutputChannel(Constants.msgSaveSucceeded + filePath);
                    self.openSavedFile(self._filePath);
                }
            }, error => {
                self._vscodeWrapper.showErrorMessage(Constants.msgSaveFailed + error);
                self._vscodeWrapper.logToOutputChannel(Constants.msgSaveFailed + error);
        });
    }

    /**
     * Handle save request by getting filename from user and sending request to service
     */
    public onSaveResults(uri: string, batchIndex: number, resultSetNo: number, format: string, selection: Interfaces.ISlickRange[] ): Thenable<void> {
        const self = this;
        this._uri = uri;

        // prompt for filepath
        return self.promptForFilepath().then(function(filePath): void {
            if (!Utils.isEmpty(filePath)) {
                self.sendRequestToService(filePath, batchIndex, resultSetNo, format, selection ? selection[0] : undefined);
            }
        });
    }

    /**
     * Open the saved file in a new vscode editor pane
     */
    public openSavedFile(filePath: string): void {
        const self = this;
        let uri = vscode.Uri.file(filePath);
        self._vscodeWrapper.openTextDocument(uri).then((doc: vscode.TextDocument) => {
            // Show open document and set focus
            self._vscodeWrapper.showTextDocument(doc, 1, false).then(undefined, (error: any) => {
                self._vscodeWrapper.showErrorMessage(error);
            });
        }, (error: any) => {
            self._vscodeWrapper.showErrorMessage(error);
        });
    }
}
