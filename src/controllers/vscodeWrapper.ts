import vscode = require('vscode');
import * as Constants from './../models/constants';

export default class VscodeWrapper {
    public get activeTextEditor(): vscode.TextEditor {
        return vscode.window.activeTextEditor;
    }

    public get activeTextEditorUri(): string {
        if (typeof vscode.window.activeTextEditor !== 'undefined' &&
            typeof vscode.window.activeTextEditor.document !== 'undefined') {
            return vscode.window.activeTextEditor.document.uri.toString();
        }
        return '';
    }

    public createOutputChannel(channelName: string): vscode.OutputChannel {
        return undefined;
    }

    public getConfiguration(extensionName: string): vscode.WorkspaceConfiguration {
        return undefined;
    }

    public range(start: vscode.Position, end: vscode.Position): vscode.Range {
        return new vscode.Range(start, end);
    }

    public showErrorMessage(msg: string): Thenable<string> {
        return vscode.window.showErrorMessage(Constants.extensionName + ': ' + msg );
    }

    public showInformationMessage(msg: string): Thenable<string> {
        return vscode.window.showInformationMessage(Constants.extensionName + ': ' + msg );
    }

    public showWarningMessage(msg: string): Thenable<string> {
        return vscode.window.showWarningMessage(Constants.extensionName + ': ' + msg );
    }
}
