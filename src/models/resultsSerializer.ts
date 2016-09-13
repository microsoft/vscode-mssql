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
    public saveResultsParams: Contracts.SaveResultsRequest.SaveResultsRequestParams;

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
        this.saveResultsParams = new Contracts.SaveResultsRequest.SaveResultsRequestParams();
        this.saveResultsParams.valueInQuotes = false;
        this.saveResultsParams.includeHeaders = true;
        this.saveResultsParams.fileEncoding = 'utf-8';
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
        return this._prompter.prompt(questions).then(answers => { return answers[Constants.filepathPrompt]; });
    }

    private getConfig(): void {
        // get save results config from vscode config
        let config = vscode.workspace.getConfiguration(Constants.extensionName);
        let saveConfig = config[Constants.configSaveAsCsv];
        if ( saveConfig) {
            if (saveConfig.encoding) {
                this.saveResultsParams.fileEncoding  = saveConfig.encoding;
            }
            if (saveConfig.includeHeaders) {
                this.saveResultsParams.includeHeaders = saveConfig.includeHeaders;
            }
            if (saveConfig.valueInQuotes) {
                this.saveResultsParams.valueInQuotes = saveConfig.valueInQuotes;
            }
        }
    }

    public sendRequestToService(uri: string, filePath: string, batchIndex: number, resultSetNo: number): Thenable<void> {
        const self = this;
        // set params to values from config and send request to service
        let sqlUri = vscode.Uri.parse(uri);
        let currentDirectory: string;

        if ( !path.isAbsolute(filePath)) {
            // user entered only the file name. Save file in current directory
            if ( sqlUri.scheme === 'file') {
                currentDirectory = path.dirname(sqlUri.fsPath);
            } else {
                currentDirectory = path.dirname(sqlUri.path);
            }
            filePath = path.normalize(path.join(currentDirectory, filePath));
        }
        // set params for save results as csv
        self.getConfig();
        self.saveResultsParams.filePath = filePath;
        self.saveResultsParams.ownerUri = vscode.Uri.file(sqlUri.fsPath).toString();
        self.saveResultsParams.resultSetIndex = resultSetNo;
        self.saveResultsParams.batchIndex = batchIndex;

        // send message to the sqlserverclient for converting resuts to csv and saving to filepath
        return self._client.sendRequest(Contracts.SaveResultsRequest.type, this.saveResultsParams).then(result => {
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
            self.sendRequestToService(uri, filePath, batchIndex, resultSetNo);
        });
    }

    private validateFilePath(property: string, value: string): string {
        if (Utils.isEmpty(value)) {
            return property + Constants.msgIsRequired;
        }
        return undefined;
    }
}
