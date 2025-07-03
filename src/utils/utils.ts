/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from "fs";
import * as vscode from "vscode";
import type { PagedAsyncIterableIterator } from "@azure/core-paging";
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
 * Generates a unique URI for a file in the specified folder using the
 * provided basename and file extension
 */
export async function getUniqueFilePath(
    folder: vscode.Uri,
    basename: string,
    fileExtension: string,
): Promise<vscode.Uri> {
    let uniqueFileName: vscode.Uri;
    let counter = 1;
    if (await exists(`${basename}.${fileExtension}`, folder)) {
        while (await exists(`${basename}${counter}.${fileExtension}`, folder)) {
            counter += 1;
        }
        uniqueFileName = vscode.Uri.joinPath(folder, `${basename}${counter}.${fileExtension}`);
    } else {
        uniqueFileName = vscode.Uri.joinPath(folder, `${basename}.${fileExtension}`);
    }
    return uniqueFileName;
}

/**
 * Generates a random nonce value that can be used in a webview
 */
export function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class CancelError extends Error {}

export function isIConnectionInfo(connectionInfo: any): connectionInfo is IConnectionInfo {
    return (
        (connectionInfo && connectionInfo.server && connectionInfo.authenticationType) ||
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

// Copied from https://github.com/microsoft/vscode-azuretools/blob/5794d9d2ccbbafdb09d44b2e1883e515077e4a72/azure/src/utils/uiUtils.ts#L26
export async function listAllIterator<T>(iterator: PagedAsyncIterableIterator<T>): Promise<T[]> {
    const resources: T[] = [];
    for await (const r of iterator) {
        resources.push(r);
    }

    return resources;
}

/** Groups items by a specified key */
export function groupBy<K, V>(values: V[], key: keyof V): Map<K, V[]> {
    // TODO: replace with Object.groupBy once ES2024 is supported
    return values.reduce((rv, x) => {
        const keyValue = x[key] as K;
        if (!rv.has(keyValue)) {
            rv.set(keyValue, []);
        }
        rv.get(keyValue)!.push(x);
        return rv;
    }, new Map<K, V[]>());
}
