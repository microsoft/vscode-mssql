/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from "fs";
import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";

export async function exists(path: string, uri?: vscode.Uri): Promise<boolean> {
    if (uri) {
        const fullPath = vscode.Uri.joinPath(uri, path);
        try {
            await vscode.workspace.fs.stat(fullPath);
            return true;
        } catch {
            return false;
        }
    } else {
        try {
            await fs.access(path);
            return true;
        } catch (e) {
            return false;
        }
    }
}

/**
 * Generates a random nonce value that can be used in a webview
 */
export function getNonce(): string {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class CancelError extends Error {}

export function isIConnectionInfo(
    connectionInfo: any,
): connectionInfo is IConnectionInfo {
    return (
        (connectionInfo &&
            connectionInfo.server &&
            connectionInfo.authenticationType) ||
        connectionInfo.connectionString
    );
}

/**
 * Consolidates on the error message string
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getErrorMessage(error: any): string {
    return error instanceof Error
        ? typeof error.message === "string"
            ? error.message
            : ""
        : typeof error === "string"
            ? error
            : `${JSON.stringify(error, undefined, "\t")}`;
}