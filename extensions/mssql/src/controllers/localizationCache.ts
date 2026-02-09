/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

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
        return undefined;
    }

    localizationFileReadPromise = (async () => {
        try {
            const file = await vscode.workspace.fs.readFile(vscode.l10n.uri);
            const fileContents = Buffer.from(file).toString();
            localizationFileCache = fileContents;
            return fileContents;
        } finally {
            localizationFileReadPromise = undefined;
        }
    })();

    return localizationFileReadPromise;
}
