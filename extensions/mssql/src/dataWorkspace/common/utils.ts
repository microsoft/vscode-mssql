/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as vscode from "vscode";
import { DataWorkspace as locConstants } from "../../constants/locConstants";

export async function directoryExist(directoryPath: string): Promise<boolean> {
    const stats = await getFileStatus(directoryPath);
    return stats ? stats.isDirectory() : false;
}

export async function fileExist(filePath: string): Promise<boolean> {
    const stats = await getFileStatus(filePath);
    return stats ? stats.isFile() : false;
}

async function getFileStatus(path: string): Promise<fs.Stats | undefined> {
    try {
        const stats = await fs.promises.stat(path);
        return stats;
    } catch (e) {
        if (e.code === "ENOENT") {
            return undefined;
        } else {
            throw e;
        }
    }
}

/**
 * Shows a message with a "Learn More" button
 * @param message Info message
 * @param link Link to open when "Learn Button" is clicked
 */
export async function showInfoMessageWithLearnMoreLink(
    message: string,
    link: string,
): Promise<void> {
    const result = await vscode.window.showInformationMessage(message, locConstants.LearnMore);
    if (result === locConstants.LearnMore) {
        void vscode.env.openExternal(vscode.Uri.parse(link));
    }
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
