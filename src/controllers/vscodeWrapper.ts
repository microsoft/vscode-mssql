import vscode = require('vscode');

export default class VscodeWrapper {
    public get activeTextEditor(): vscode.TextEditor {
        return undefined;
    }

    public createOutputChannel(channelName: string): vscode.OutputChannel {
        return undefined;
    }

    public getConfiguration(extensionName: string): vscode.WorkspaceConfiguration {
        return undefined;
    }

    public showErrorMessage(msg: string): Thenable<string> {
        return undefined;
    }

    public showInformationMessage(msg: string): Thenable<string> {
        return undefined;
    }

    public showWarningMessage(msg: string): Thenable<string> {
        return undefined;
    }

}
