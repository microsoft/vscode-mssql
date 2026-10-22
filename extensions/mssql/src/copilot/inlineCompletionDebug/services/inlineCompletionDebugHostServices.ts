/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * User-facing host interactions (dialogs, clipboard, settings writes, trace
 * file I/O) behind an injectable seam so the Inline Completion Debug command
 * handler and domain services are unit-testable with fakes (final plan
 * WI-1.1). `vscode` imports inside the services are fine — they run in the
 * extension host — but anything that pops UI, writes user settings, or
 * touches the clipboard must ride this object instead of calling the vscode
 * API directly.
 */

import * as vscode from "vscode";

export interface InlineCompletionDebugHostServices {
    showSaveDialog(options: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined>;
    showOpenDialog(options: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined>;
    showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    showWarningMessage(
        message: string,
        options: vscode.MessageOptions,
        ...items: string[]
    ): Thenable<string | undefined>;
    writeClipboardText(text: string): Thenable<void>;
    /** Scoped (workspace when folders exist, otherwise global) settings write. */
    updateConfiguration(section: string, value: unknown): Thenable<void>;
    readFile(uri: vscode.Uri): Thenable<Uint8Array>;
    writeFile(uri: vscode.Uri, content: Uint8Array): Thenable<void>;
}

export function getConfigurationTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
}

export function createDefaultInlineCompletionDebugHostServices(): InlineCompletionDebugHostServices {
    return {
        showSaveDialog: (options) => vscode.window.showSaveDialog(options),
        showOpenDialog: (options) => vscode.window.showOpenDialog(options),
        showInformationMessage: (message, ...items) =>
            vscode.window.showInformationMessage(message, ...items),
        showWarningMessage: (message, options, ...items) =>
            vscode.window.showWarningMessage(message, options, ...items),
        writeClipboardText: (text) => vscode.env.clipboard.writeText(text),
        updateConfiguration: (section, value) =>
            vscode.workspace.getConfiguration().update(section, value, getConfigurationTarget()),
        readFile: (uri) => vscode.workspace.fs.readFile(uri),
        writeFile: (uri, content) => vscode.workspace.fs.writeFile(uri, content),
    };
}
