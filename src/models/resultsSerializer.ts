import path = require('path');
import vscode = require('vscode');
import Constants = require('./constants');
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

    private getConfigForCsv(): Contracts.SaveResultsAsCsvRequest.SaveResultsRequestParams {
        // get save results config from vscode config
        let config = vscode.workspace.getConfiguration(Constants.extensionName);
        let saveConfig = config[Constants.configSaveAsCsv];
        let saveResultsParams = new Contracts.SaveResultsAsCsvRequest.SaveResultsRequestParams();

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

    private getConfigForJson(): Contracts.SaveResultsAsJsonRequest.SaveResultsRequestParams {
        // get save results config from vscode config
        let config = vscode.workspace.getConfiguration(Constants.extensionName);
        let saveConfig = config[Constants.configSaveAsJson];
        let saveResultsParams = new Contracts.SaveResultsAsJsonRequest.SaveResultsRequestParams();

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
        } else {
            currentDirectory = path.dirname(sqlUri.path);
        }
        return path.normalize(path.join(currentDirectory, filePath));

    }

    /**
     * Send request to sql tools service to save a result set in CSV format
     */
    public sendCsvRequestToService(uri: string, filePath: string, batchIndex: number, resultSetNo: number): Thenable<void> {
        const self = this;
        let sqlUri = vscode.Uri.parse(uri);
        if (!path.isAbsolute(filePath)) {
            filePath = self.resolveFilePath(uri, filePath);
        }
        let saveResultsParams =  self.getConfigForCsv();
        saveResultsParams.filePath = filePath;
        saveResultsParams.ownerUri = vscode.Uri.file(sqlUri.fsPath).toString();
        saveResultsParams.resultSetIndex = resultSetNo;
        saveResultsParams.batchIndex = batchIndex;

        // send message to the sqlserverclient for converting resuts to CSV and saving to filepath
        return self._client.sendRequest( Contracts.SaveResultsAsCsvRequest.type, saveResultsParams).then(result => {
                if (result.messages === 'Success') {
                    self._vscodeWrapper.showInformationMessage('Results saved to ' + filePath);
                } else {
                    self._vscodeWrapper.showErrorMessage(result.messages);
                }
            }, error => {
                self._vscodeWrapper.showErrorMessage('Saving results failed: ' + error);
            });
    }

    /**
     * Send request to sql tools service to save a result set in JSON format
     */
    public sendJsonRequestToService(uri: string, filePath: string, batchIndex: number, resultSetNo: number): Thenable<void> {
        const self = this;
        let sqlUri = vscode.Uri.parse(uri);
        if (!path.isAbsolute(filePath)) {
            filePath = self.resolveFilePath(uri, filePath);
        }

        let saveResultsParams =  self.getConfigForJson();
        saveResultsParams.filePath = filePath;
        saveResultsParams.ownerUri = vscode.Uri.file(sqlUri.fsPath).toString();
        saveResultsParams.resultSetIndex = resultSetNo;
        saveResultsParams.batchIndex = batchIndex;

        // send message to the sqlserverclient for converting resuts to JSON and saving to filepath
        return self._client.sendRequest( Contracts.SaveResultsAsJsonRequest.type, saveResultsParams).then(result => {
                if (result.messages === 'Success') {
                    self._vscodeWrapper.showInformationMessage('Results saved to ' + filePath);
                } else {
                    self._vscodeWrapper.showErrorMessage(result.messages);
                }
            }, error => {
                self._vscodeWrapper.showErrorMessage('Saving results failed: ' + error);
            });
    }

    public onSaveResultsAsCsv(uri: string, batchIndex: number, resultSetNo: number ): Thenable<void> {
        const self = this;
        // prompt for filepath
        return self.promptForFilepath().then(function(filePath): void {
            self.sendCsvRequestToService(uri, filePath, batchIndex, resultSetNo);
        });
    }

    public onSaveResultsAsJson(uri: string, batchIndex: number, resultSetNo: number ): Thenable<void> {
        const self = this;
        // prompt for filepath
        return self.promptForFilepath().then(function(filePath): void {
            self.sendJsonRequestToService(uri, filePath, batchIndex, resultSetNo);
        });
    }

    private validateFilePath(property: string, value: string): string {
        if (Utils.isEmpty(value.trim())) {
            return property + Constants.msgIsRequired;
        }
        return undefined;
    }
}
