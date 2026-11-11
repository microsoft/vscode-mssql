/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewApi } from "vscode-webview";

class VsCodeApiFetcher {
    public vscodeApiInstance: WebviewApi<unknown>;

    constructor() {
        // A page may pre-acquire the API in an inline boot-error relay
        // (acquireVsCodeApi throws if called twice) — reuse it if present.
        const pre = (globalThis as { __vscodeApiPreAcquired?: WebviewApi<unknown> })
            .__vscodeApiPreAcquired;
        this.vscodeApiInstance = pre ?? acquireVsCodeApi<unknown>();
    }
}

export const vsCodeApiInstance = new VsCodeApiFetcher();
