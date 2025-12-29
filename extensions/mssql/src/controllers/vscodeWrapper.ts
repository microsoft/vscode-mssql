/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { TextDocumentShowOptions } from "vscode";
import { AzureLoginStatus } from "../models/interfaces";
import * as Constants from "../constants/constants";

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
        if (typeof VscodeWrapper._outputChannel === "undefined") {
            VscodeWrapper._outputChannel = this.createOutputChannel(Constants.outputChannelName);
        }
    }

    /**
     * Get the current active text editor
     */
    public get activeTextEditor(): vscode.TextEditor {
        return vscode.window.activeTextEditor!;
    }

    /**
     * An [event](#Event) which fires when the [active editor](#window.activeTextEditor)
     * has changed. *Note* that the event also fires when the active editor changes
     * to `undefined`.
     */
    public get onDidChangeActiveTextEditor(): vscode.Event<vscode.TextEditor | undefined> {
        return vscode.window.onDidChangeActiveTextEditor;
    }

    /**
     * get the current textDocument; any that are open?
     */
    public get textDocuments(): ReadonlyArray<vscode.TextDocument> {
        return vscode.workspace.textDocuments;
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
    public get activeTextEditorUri(): string | undefined {
        if (
            typeof vscode.window.activeTextEditor !== "undefined" &&
            typeof vscode.window.activeTextEditor.document !== "undefined"
        ) {
            return vscode.window.activeTextEditor.document.uri.toString(true);
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
     * Executes the command denoted by the given command identifier.
     *
     * When executing an editor command not all types are allowed to
     * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
     * `number`, `undefined`, and `null`, as well as classes defined in this API.
     * There are no restrictions when executing commands that have been contributed
     * by extensions.
     *
     * @param command Identifier of the command to execute.
     * @param rest Parameters passed to the command function.
     * @return A thenable that resolves to the returned value of the given command. `undefined` when
     * the command handler function doesn't return anything.
     * @see vscode.commands.executeCommand
     */
    public executeCommand<T>(command: string, ...rest: any[]): Thenable<T | undefined> {
        return vscode.commands.executeCommand<T>(command, ...rest);
    }

    /**
     * Get the configuration for a extensionName
     * @param extensionName The string name of the extension to get the configuration for
     * @param resource The optional URI, as a URI object or a string, to use to get resource-scoped configurations
     */
    public getConfiguration(
        extensionName?: string,
        resource?: vscode.Uri | string,
    ): vscode.WorkspaceConfiguration {
        if (typeof resource === "string") {
            try {
                resource = this.parseUri(resource);
            } catch (e) {
                resource = undefined;
            }
        }
        return vscode.workspace.getConfiguration(extensionName, resource as vscode.Uri);
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
     * An event that is emitted when a [text document](#TextDocument) is opened.
     */
    public get onDidOpenTextDocument(): vscode.Event<vscode.TextDocument> {
        return vscode.workspace.onDidOpenTextDocument;
    }

    /**
     * An event that is emitted when a [text document](#TextDocument) is saved to disk.
     */
    public get onDidSaveTextDocument(): vscode.Event<vscode.TextDocument> {
        return vscode.workspace.onDidSaveTextDocument;
    }

    /**
     * An event that is emitted when a [text document change](#TextDocumentChange) is detected.
     */
    public get onDidChangeTextDocument(): vscode.Event<vscode.TextDocumentChangeEvent> {
        return vscode.workspace.onDidChangeTextDocument;
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
    public async openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
        const doc = await vscode.workspace.openTextDocument(uri);
        return doc;
    }

    /**
     * Helper to log messages to "MSSQL" output channel.
     */
    public logToOutputChannel(msg: any): void {
        let date: Date = new Date();
        if (msg instanceof Array) {
            msg.forEach((element) => {
                VscodeWrapper._outputChannel.appendLine(
                    "[" + date.toLocaleTimeString() + "] " + element.toString(),
                );
            });
        } else {
            VscodeWrapper._outputChannel.appendLine(
                "[" + date.toLocaleTimeString() + "] " + msg.toString(),
            );
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
    public showErrorMessage(msg: string, ...items: string[]): Thenable<string | undefined> {
        return vscode.window.showErrorMessage(Constants.extensionName + ": " + msg, ...items);
    }

    /**
     * Shows an input box with given options
     */
    public showInputBox(options?: vscode.InputBoxOptions): Thenable<string | undefined> {
        return vscode.window.showInputBox(options);
    }

    /**
     * Formats and shows a vscode information message
     */
    public showInformationMessage(msg: string, ...items: string[]): Thenable<string | undefined> {
        return vscode.window.showInformationMessage(Constants.extensionName + ": " + msg, ...items);
    }

    public showQuickPickStrings(
        items: string[] | Thenable<string[]>,
        options?: vscode.QuickPickOptions,
    ): Thenable<string | undefined> {
        return vscode.window.showQuickPick(items, options);
    }

    public createQuickPick<T extends vscode.QuickPickItem>(): vscode.QuickPick<T> {
        return vscode.window.createQuickPick<T>();
    }

    /**
     * Shows a selection list.
     *
     * @param items An array of items, or a promise that resolves to an array of items.
     * @param options Configures the behavior of the selection list.
     * @return A promise that resolves to the selected item or undefined.
     */
    public showQuickPick<T extends vscode.QuickPickItem>(
        items: T[] | Thenable<T[]>,
        options?: vscode.QuickPickOptions,
    ): Thenable<T | undefined> {
        return vscode.window.showQuickPick<T>(items, options);
    }

    /**
     * Shows a file save dialog to the user which allows to select a file for saving-purposes.
     *
     * @param options Configures the behavior of the save dialog
     * @return A promise that resolves to the selected resource or `undefined`.
     */
    public showSaveDialog(options: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined> {
        return vscode.window.showSaveDialog(options);
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
    public async showTextDocument(
        document: vscode.TextDocument,
        options: TextDocumentShowOptions,
    ): Promise<vscode.TextEditor> {
        const editor = await vscode.window.showTextDocument(document, options);
        return editor;
    }

    /**
     * Formats and shows a vscode warning message
     */
    public showWarningMessage(msg: string): Thenable<string | undefined> {
        return vscode.window.showWarningMessage(Constants.extensionName + ": " + msg);
    }

    /**
     * Formats and shows a vscode warning message with items
     */
    public showWarningMessageAdvanced(
        msg: string,
        messageOptions: vscode.MessageOptions,
        items: any[],
    ): Thenable<string> {
        return vscode.window.showWarningMessage(
            Constants.extensionName + ": " + msg,
            messageOptions,
            ...items,
        );
    }

    /**
     * Formats and shows a vscode warning message
     */
    public openExternal(link: string): Thenable<boolean> {
        return vscode.env.openExternal(vscode.Uri.parse(link));
    }

    /**
     * Returns a array of the text editors currently visible in the window
     */
    public get visibleEditors(): readonly vscode.TextEditor[] {
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

    /**
     * Write text to the clipboard
     *
     * @param text Value to write to the clipboard
     * @return A promise that is called once the copy is complete
     */
    public clipboardWriteText(text: string): Thenable<void> {
        return vscode.env.clipboard.writeText(text);
    }

    /**
     * Called when workspace settings are changed
     */
    public get onDidChangeConfiguration(): vscode.Event<vscode.ConfigurationChangeEvent> {
        return vscode.workspace.onDidChangeConfiguration;
    }

    /**
     * Change a configuration setting
     */
    public setConfiguration(
        extensionName: string,
        resource: string,
        value: any,
        target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
    ): Thenable<void> {
        return this.getConfiguration(extensionName).update(resource, value, target);
    }

    /**
     * Set a context for contributing command actions
     */
    public async setContext(contextSection: string, value: any): Promise<void> {
        await this.executeCommand("setContext", contextSection, value);
    }

    /**
     * Getter for the MSSQL output channel
     */
    public get outputChannel(): vscode.OutputChannel {
        return VscodeWrapper._outputChannel;
    }

    /*
     * Called when there's a change in the extensions
     */
    public get onDidChangeExtensions(): vscode.Event<void> {
        return vscode.extensions.onDidChange;
    }

    /**
     * Gets the Azure Account extension
     */
    public get azureAccountExtension(): vscode.Extension<any> | undefined {
        return vscode.extensions.getExtension(Constants.azureAccountExtensionId);
    }

    /**
     * Returns true when the Azure Account extension is installed
     * but not active
     */
    public get azureAccountExtensionActive(): boolean {
        return this.azureAccountExtension !== undefined && this.azureAccountExtension.isActive;
    }

    /**
     * Returns whether an azure account is signed in
     */
    public get isAccountSignedIn(): boolean {
        return (
            this.azureAccountExtensionActive &&
            this.azureAccountExtension!.exports.status === AzureLoginStatus.LoggedIn
        );
    }
}
