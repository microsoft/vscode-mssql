/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Access seam for the single SqlInlineCompletionProvider instance so hosts
 * outside the VS Code ghost-text pipeline (Query Studio's Monaco webview)
 * can run the same completion pipeline against the same documents.
 */

import { SqlInlineCompletionProvider } from "./sqlInlineCompletionProvider";

let sharedProvider: SqlInlineCompletionProvider | undefined;

export function setSharedInlineCompletionProvider(
    provider: SqlInlineCompletionProvider | undefined,
): void {
    sharedProvider = provider;
}

export function getSharedInlineCompletionProvider(): SqlInlineCompletionProvider | undefined {
    return sharedProvider;
}
