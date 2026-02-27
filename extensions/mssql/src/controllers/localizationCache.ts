/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { getErrorMessage } from "../utils/utils";

let localizationFileCache: string | undefined;
let localizationFileReadPromise: Promise<string | undefined> | undefined;

export function initializeWebviewLocalizationCache(): void {
    void getLocalizationFileContentsCached();
}

export async function getLocalizationFileContentsCached(): Promise<string | undefined> {
    if (localizationFileCache !== undefined) {
        return localizationFileCache;
    }

    if (localizationFileReadPromise) {
        return localizationFileReadPromise;
    }

    if (!vscode.l10n.uri) {
        // No localization; running in English locale.
        return undefined;
    }

    localizationFileReadPromise = (async () => {
        try {
            const file = await vscode.workspace.fs.readFile(vscode.l10n.uri);
            const fileContents = Buffer.from(file).toString();
            localizationFileCache = fileContents;
            return fileContents;
        } catch (err) {
            console.error("Error reading localization file:", getErrorMessage(err));
            throw err;
        } finally {
            localizationFileReadPromise = undefined;
        }
    })();

    return localizationFileReadPromise;
}
