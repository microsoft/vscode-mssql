'use strict';
import path = require('path');
import vscode = require('vscode');
import Constants = require('./constants');
import SqlToolsServerClient from '../languageservice/serviceclient';
import * as Contracts from '../models/contracts';
import * as Utils from '../models/utils';
import { QuestionTypes, IQuestion, IPrompter } from '../prompts/question';
import CodeAdapter from '../prompts/adapter';

export default class SaveResults {
    private _client: SqlToolsServerClient;
    private _fileEncoding: string = 'utf-8';
    private _includeHeaders: boolean = true;
    private _valueInquotes: boolean = false;
    private _filePath: string;
    private _uri: string;
    private _prompter: IPrompter;

    constructor() {
        this._client = SqlToolsServerClient.instance;
        this._prompter = new CodeAdapter();
    }


    public promptForFilepath(): Promise<void> {
        let questions: IQuestion[] = [
            // prompt user to enter file path
            {
                type: QuestionTypes.input,
                name: Constants.filepathPrompt,
                message: Constants.filepathPrompt,
                placeHolder: Constants.filepathPlaceholder,
                onAnswered: (value) => this._filePath = value
            }];
        return this._prompter.prompt(questions).then(() => { return; });
    }
    public promptForResultSetNo(): Promise<number> {
        let resultSetNo: number;
        let questions: IQuestion[] = [
            // prompt user to enter file path
            {
                type: QuestionTypes.input,
                name: Constants.resultSetNoPrompt,
                message: Constants.resultSetNoPrompt,
                placeHolder: Constants.resultSetNoPlaceholder,
                onAnswered: (value) => resultSetNo = value
            }];
        return this._prompter.prompt(questions).then(() => { return Number(resultSetNo); });
    }

    public getConfig(): void {
        // get save results config from vscode config
        let config = vscode.workspace.getConfiguration(Constants.extensionName);
        let saveConfig = config[Constants.configSaveAsCsv];
        if (saveConfig.encoding) {
            this._fileEncoding = saveConfig.encoding;
        }
        if (saveConfig.includeHeaders) {
            this._includeHeaders = saveConfig.includeHeaders;
        }
        if (saveConfig.valueInQuotes) {
            this._valueInquotes = saveConfig.valueInQuotes;
        }
    }

    public sendRequestToService(uri: string, resultSetNo: number): void {
        // set params to values from config and send request to service
        // let editor = vscode.window.activeTextEditor;
        // this._uri = editor.document.uri.toString();

        let sqlUri = vscode.Uri.parse(uri);
        let currentDirectory: string;
        this._uri =  vscode.Uri.file(sqlUri.fsPath).toString();

        if ( !path.isAbsolute(this._filePath)) {
            // user entered only the file name. Save file in current directory
            if ( sqlUri.scheme === 'file') {
                currentDirectory = path.dirname(sqlUri.fsPath);
            } else {
                currentDirectory = path.dirname(sqlUri.path);
            }
            console.log('current directory ' + currentDirectory);
            this._filePath = path.normalize(path.join(currentDirectory, this._filePath));
        }
        // set params for save results as csv
        this.getConfig();
        let saveResultsParams = new Contracts.SaveResultsRequest.SaveResultsRequestParams();
        saveResultsParams.filePath = this._filePath;
        saveResultsParams.fileEncoding = this._fileEncoding;
        saveResultsParams.includeHeaders = this._includeHeaders;
        saveResultsParams.ValueInQuotes = this._valueInquotes;
        saveResultsParams.ownerUri = this._uri;
        saveResultsParams.ResultSetNo = resultSetNo;

        // send message to the sqlserverclient for converting resuts to csv and saving to filepath
        this._client.sendRequest(Contracts.SaveResultsRequest.type, saveResultsParams).then(result => {
                if (result.messages === 'Success') {
                    Utils.showInfoMsg('Results saved to ' + this._filePath);
                } else {
                    Utils.showErrorMsg(result.messages);
                }
            }, error => {
                Utils.showErrorMsg('Saving results failed: ' + error);
            });

    }
    public onSaveResultsAsCsv(uri: string, resultSetNo: number ): void {
        const self = this;
        // prompt for filepath
        self.promptForFilepath().then(function(): void { self.sendRequestToService(uri, resultSetNo); } );
    }
    public onSaveResultsAsCsvCommand(): void {
        const self = this;
        // get file uri from editor
        let editor = vscode.window.activeTextEditor;
        // prompt for resultSetNo
        self.promptForResultSetNo().then(function(resultSetNo): void { self.onSaveResultsAsCsv(editor.document.uri.toString(), resultSetNo); } );
    }
}
