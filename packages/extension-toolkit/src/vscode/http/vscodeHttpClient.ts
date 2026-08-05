/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    HttpClient,
    IHttpClientDependencies,
    IHttpClientLogger,
    IHttpClientMessages,
} from "../../base";
import { ProxyMessages } from "../localization/locConstants";

/** Options for creating a VS Code-aware HTTP client. */
export interface IVscodeHttpClientOptions {
    /** Localized messages used when reporting invalid VS Code proxy settings. */
    messages?: IHttpClientMessages;

    /** Optional logger for HTTP diagnostics and proxy configuration warnings. */
    logger?: IHttpClientLogger;
}

/**
 * An HTTP client configured from VS Code's `http.proxy` and `http.proxyStrictSSL` settings.
 * Invalid proxy settings are reported through VS Code notifications and the optional logger.
 */
export class VscodeHttpClient extends HttpClient {
    /**
     * Creates a VS Code-aware HTTP client.
     *
     * @param options Localized proxy messages and optional diagnostic logger.
     */
    constructor(options: IVscodeHttpClientOptions = {}) {
        const dependencies: IHttpClientDependencies = {
            getProxyConfig: () =>
                vscode.workspace.getConfiguration("http")["proxy"] as string | undefined,
            getProxyStrictSSL: () =>
                vscode.workspace.getConfiguration("http")["proxyStrictSSL"] as boolean | undefined,
            parseUriScheme: (value: string) => vscode.Uri.parse(value).scheme,
            showWarningMessage: (message: string) => {
                void vscode.window.showWarningMessage(message);
            },
            messages: options.messages ?? ProxyMessages,
        };
        super(options.logger, dependencies);
    }
}
