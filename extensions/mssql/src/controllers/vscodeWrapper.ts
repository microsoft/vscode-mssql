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
            VscodeWrapper._outputChannel = vscode.window.createOutputChannel(
                Constants.outputChannelName,
                { log: true },
            );
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

    /**
     * Formats and shows a vscode warning message
     */
    public openExternal(link: string): Thenable<boolean> {
        return vscode.env.openExternal(vscode.Uri.parse(link));
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
