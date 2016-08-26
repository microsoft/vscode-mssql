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
    private _formatting: string = 'Tab';
    private _missingValueReplacement: boolean = false;
    private _valueInquotes: boolean = false;
    private _filePath: string;
    private _uri: string;
    private _prompter: IPrompter;

    constructor() {
        this._client = SqlToolsServerClient.getInstance();
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

    public getConfig(): void {
        let config = vscode.workspace.getConfiguration(Constants.extensionName);
        let saveConfig = config[Constants.configSaveAsCsv];
        if (saveConfig.encoding) {
            this._fileEncoding = saveConfig.encoding;
        }
        if (saveConfig.formatting) {
            this._formatting = saveConfig.formatting;
        }
        if (saveConfig.valueInQuotes) {
            this._valueInquotes = saveConfig.valueInQuotes;
        }

    }

    public sendRequestToService(uri: string, resultSetNo: number): void {
        // set params to values from config and send request to service
        // let editor = vscode.window.activeTextEditor;
        // this._uri = editor.document.uri.toString();

        this._uri =  vscode.Uri.file(vscode.Uri.parse(uri).fsPath).toString();
        console.log('uri to save ' + vscode.Uri.parse(this._filePath).fsPath);
        let filePathUri = vscode.Uri.parse(this._filePath);
        console.log( filePathUri.fsPath + ' ' + filePathUri.scheme);

        if ( !path.isAbsolute(this._filePath)) {
            // user entered just file name. save file in current directory
            let currentDirectory = path.dirname(this._uri);
            console.log('current directory ' + currentDirectory);
            this._filePath = path.normalize(path.join(currentDirectory, this._filePath));
        }
        // set params for save results as csv
        this.getConfig();
        let saveResultsParams = new Contracts.SaveResultsRequest.SaveResultsRequestParams();
        saveResultsParams.filePath = this._filePath;
        saveResultsParams.fileEncoding = this._fileEncoding;
        saveResultsParams.formatting = this._formatting;
        saveResultsParams.MissingValueReplacement = this._missingValueReplacement;
        saveResultsParams.ValueInQuotes = this._valueInquotes;
        saveResultsParams.ownerUri = this._uri;
        saveResultsParams.ResultSetNo = resultSetNo;

        // send message to the sqlserverclient for converting resuts to csv and saving to filepath
        this._client.getClient().sendRequest(Contracts.SaveResultsRequest.type, saveResultsParams).then(result => {
                if (result.messages) {
                    Utils.showInfoMsg('Saving results messages: ' + result.messages);
                }
            }, error => {
                Utils.showErrorMsg('Saving results failed: ' + error);
            });

    }
    public onSaveResultsAsCsv(uri: string, resultSetNo: number ): void {
        const self = this;
        // prompt for filepath. used to return Thenable<void>
        this.promptForFilepath().then(function(): void { self.sendRequestToService(uri, resultSetNo); } );
    }
}
