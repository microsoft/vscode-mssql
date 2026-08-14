/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { HttpClient, IHttpClientDependencies, IHttpClientLogger } from "../../base";

/** Options for creating a VS Code-aware HTTP client. */
export interface IVscodeHttpClientOptions {
    /** Optional logger for HTTP diagnostics and proxy configuration warnings. */
    logger?: IHttpClientLogger;
}

/**
 * An HTTP client configured from VS Code's `http.proxy`, `http.noProxy`, and
 * `http.proxyStrictSSL` settings. Invalid proxy settings are reported through VS Code
 * notifications and the optional logger.
 */
export class VscodeHttpClient extends HttpClient {
    /**
     * Creates a VS Code-aware HTTP client.
     *
     * @param options Optional diagnostic logger.
     */
    constructor(options: IVscodeHttpClientOptions = {}) {
        const dependencies: IHttpClientDependencies = {
            getProxyConfig: () =>
                vscode.workspace.getConfiguration("http")["proxy"] as string | undefined,
            getNoProxyConfig: () =>
                vscode.workspace.getConfiguration("http")["noProxy"] as string[] | undefined,
            getProxyStrictSSL: () =>
                vscode.workspace.getConfiguration("http")["proxyStrictSSL"] as boolean | undefined,
            parseUriScheme: (value: string) => vscode.Uri.parse(value).scheme,
        };
        super(options.logger, dependencies);
    }

    /** Validates the configured proxy and displays a VS Code warning when it is invalid. */
    public warnOnInvalidProxySettings(): void {
        const warning = this.getInvalidProxySettingsWarning();
        if (warning) {
            void vscode.window.showWarningMessage(warning);
        }
    }
}
