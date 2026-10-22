/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QsWriteClipboardRequest } from "../../../sharedInterfaces/queryStudio";
import type { Rpc } from "./resultsGridShared";

export interface QueryStudioClipboardWriter {
    writeText(text: string): Promise<void>;
}

export interface QueryStudioClipboardWriteResult {
    attempts: number;
    mode: "webview" | "hostFallback";
}

/**
 * Prefer Chromium's zero-copy local clipboard path. If async result fetching
 * outlives its focus/permission, retry once through VS Code's host clipboard.
 */
export async function writeQueryStudioClipboard(
    rpc: Rpc,
    text: string,
    webviewClipboard: QueryStudioClipboardWriter | undefined = navigator.clipboard,
): Promise<QueryStudioClipboardWriteResult> {
    if (webviewClipboard) {
        try {
            await webviewClipboard.writeText(text);
            return { attempts: 1, mode: "webview" };
        } catch {
            // Fall through to the extension-host bridge.
        }
    }
    await rpc.sendRequest(QsWriteClipboardRequest.type, { text });
    return { attempts: webviewClipboard ? 2 : 1, mode: "hostFallback" };
}
