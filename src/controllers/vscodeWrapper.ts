import vscode = require('vscode');
import * as Constants from './../models/constants';

export default class VscodeWrapper {

    /**
     * Output channel for logging. Shared among all instances.
     */
    private static _outputChannel: vscode.OutputChannel;

    /**
     * Default constructor.
     */
    public constructor() {
        if (typeof VscodeWrapper._outputChannel === 'undefined') {
            VscodeWrapper._outputChannel = this.createOutputChannel(Constants.outputChannelName);
        }
    }

    /**
     * Get the current active text editor
     */
    public get activeTextEditor(): vscode.TextEditor {
        return vscode.window.activeTextEditor;
    }

    /**
     * Get the URI string for the current active text editor
     */
    public get activeTextEditorUri(): string {
        if (typeof vscode.window.activeTextEditor !== 'undefined' &&
            typeof vscode.window.activeTextEditor.document !== 'undefined') {
            return vscode.window.activeTextEditor.document.uri.toString();
        }
        return undefined;
    }

    /**
     * Create an output channel in vscode.
     */
    public createOutputChannel(channelName: string): vscode.OutputChannel {
        return vscode.window.createOutputChannel(channelName);
    }

    /**
     * Get the configuration for a extensionName; NOT YET IMPLEMENTED
     * @param extensionName The string name of the extension to get the configuration for
     */
    public getConfiguration(extensionName: string): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration(extensionName);
    }

    /**
     * @return 'true' if the active editor window has a .sql file, false otherwise
     */
    public get isEditingSqlFile(): boolean {
        let sqlFile = false;
        let editor = this.activeTextEditor;
        if (editor) {
            if (editor.document.languageId === Constants.languageId) {
                sqlFile = true;
            }
        }
        return sqlFile;
    }

    /**
     * An event that is emitted when a [text document](#TextDocument) is disposed.
     */
    public get onDidCloseTextDocument(): vscode.Event<vscode.TextDocument> {
        return vscode.workspace.onDidCloseTextDocument;
    }

    /**
     * An event that is emitted when a [text document](#TextDocument) is saved to disk.
     */
    public get onDidSaveTextDocument(): vscode.Event<vscode.TextDocument> {
        return vscode.workspace.onDidSaveTextDocument;
    }

    /**
     * Helper to log messages to "MSSQL" output channel.
     */
    public logToOutputChannel(msg: any): void {
        if (msg instanceof Array) {
            msg.forEach(element => {
                VscodeWrapper._outputChannel.appendLine(element.toString());
            });
        } else {
            VscodeWrapper._outputChannel.appendLine(msg.toString());
        }
    }

    /**
     * Create a vscode.Range object
     * @param start The start position for the range
     * @param end The end position for the range
     */
    public range(start: vscode.Position, end: vscode.Position): vscode.Range {
        return new vscode.Range(start, end);
    }

    /**
     * Formats and shows a vscode error message
     */
    public showErrorMessage(msg: string): Thenable<string> {
        return vscode.window.showErrorMessage(Constants.extensionName + ': ' + msg );
    }

    /**
     * Formats and shows a vscode information message
     */
    public showInformationMessage(msg: string): Thenable<string> {
        return vscode.window.showInformationMessage(Constants.extensionName + ': ' + msg );
    }

    /**
     * Shows a selection list.
     *
     * @param items An array of items, or a promise that resolves to an array of items.
     * @param options Configures the behavior of the selection list.
     * @return A promise that resolves to the selected item or undefined.
     */
    public showQuickPick<T extends vscode.QuickPickItem>(items: T[] | Thenable<T[]>, options?: vscode.QuickPickOptions): Thenable<T> {
        return vscode.window.showQuickPick<T>(items, options);
    }

    /**
     * Formats and shows a vscode warning message
     */
    public showWarningMessage(msg: string): Thenable<string> {
        return vscode.window.showWarningMessage(Constants.extensionName + ': ' + msg );
    }
}
