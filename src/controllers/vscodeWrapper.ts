import vscode = require('vscode');
import * as Constants from './../models/constants';

export import TextEditor = vscode.TextEditor;

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
     * Parse uri
     */
    public parseUri(uri: string): vscode.Uri {
        return vscode.Uri.parse(uri);
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
     * Opens the denoted document from disk. Will return early if the
     * document is already open, otherwise the document is loaded and the
     * [open document](#workspace.onDidOpenTextDocument)-event fires.
     * The document to open is denoted by the [uri](#Uri). Two schemes are supported:
     *
     * file: A file on disk, will be rejected if the file does not exist or cannot be loaded, e.g. `file:///Users/frodo/r.ini`.
     * untitled: A new file that should be saved on disk, e.g. `untitled:c:\frodo\new.js`. The language will be derived from the file name.
     *
     * Uris with other schemes will make this method return a rejected promise.
     *
     * @param uri Identifies the resource to open.
     * @return A promise that resolves to a [document](#TextDocument).
     * @see vscode.workspace.openTextDocument
     */
    public openTextDocument(uri: vscode.Uri): Thenable<vscode.TextDocument> {
        return vscode.workspace.openTextDocument(uri);
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
     * Create a vscode.Position object
     * @param line The line for the position
     * @param column The column for the position
     */
    public position(line: number, column: number): vscode.Position {
        return new vscode.Position(line, column);
    }

    /**
     * Create a vscode.Selection object
     * @param start The start postion of the selection
     * @param end The end position of the selection
     */
    public selection(start: vscode.Position, end: vscode.Position): vscode.Selection {
        return new vscode.Selection(start, end);
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
     * Show the given document in a text editor. A [column](#ViewColumn) can be provided
     * to control where the editor is being shown. Might change the [active editor](#window.activeTextEditor).
     *
     * @param document A text document to be shown.
     * @param column A view column in which the editor should be shown. The default is the [one](#ViewColumn.One), other values
     * are adjusted to be __Min(column, columnCount + 1)__.
     * @param preserveFocus When `true` the editor will not take focus.
     * @return A promise that resolves to an [editor](#TextEditor).
     */
    public showTextDocument(document: vscode.TextDocument, column?: vscode.ViewColumn, preserveFocus?: boolean): Thenable<vscode.TextEditor> {
        return vscode.window.showTextDocument(document, column, preserveFocus);
    }

    /**
     * Formats and shows a vscode warning message
     */
    public showWarningMessage(msg: string): Thenable<string> {
        return vscode.window.showWarningMessage(Constants.extensionName + ': ' + msg );
    }

    /**
     * Returns a array of the text editors currently visible in the window
     */
    public get visibleEditors(): vscode.TextEditor[] {
        return vscode.window.visibleTextEditors;
    }

    /**
     * Create an URI from a file system path. The [scheme](#Uri.scheme)
     * will be `file`.
     *
     * @param path A file system or UNC path.
     * @return A new Uri instance.
     * @see vscode.Uri.file
     */
    public uriFile(path: string): vscode.Uri {
        return vscode.Uri.file(path);
    }

    /**
     * Create an URI from a string. Will throw if the given value is not
     * valid.
     *
     * @param value The string value of an Uri.
     * @return A new Uri instance.
     * @see vscode.Uri.parse
     */
    public uriParse(value: string): vscode.Uri {
        return vscode.Uri.parse(value);
    }
}
