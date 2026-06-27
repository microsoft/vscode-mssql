/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

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
            return vscode.window.activeTextEditor.document.uri.toString();
        }
        return undefined;
    }

    /**
     * Create an output channel in vscode.
     */
    public createOutputChannel(channelName: string): vscode.OutputChannel {
        return vscode.window.createOutputChannel(channelName, { log: true });
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
            } catch {
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

    public createQuickPick<T extends vscode.QuickPickItem>(): vscode.QuickPick<T> {
        return vscode.window.createQuickPick<T>();
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
     * Getter for the MSSQL output channel
     */
    public get outputChannel(): vscode.OutputChannel {
        return VscodeWrapper._outputChannel;
    }
}
