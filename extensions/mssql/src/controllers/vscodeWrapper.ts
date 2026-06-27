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
                resource = vscode.Uri.parse(resource);
            } catch {
                resource = undefined;
            }
        }
        return vscode.workspace.getConfiguration(extensionName, resource as vscode.Uri);
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
