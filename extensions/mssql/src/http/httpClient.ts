/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/locConstants";
import { ILogger } from "../models/interfaces";
import { getErrorMessage } from "../utils/utils";
import {
    HttpClientCore,
    IHttpClientDependencies,
    HttpDownloadError,
    IDownloadFileOptions,
    IDownloadFileResult,
} from "./httpClientCore";

export class HttpClient extends HttpClientCore {
    constructor(logger?: ILogger) {
        const dependencies: IHttpClientDependencies = {
            getProxyConfig: () =>
                vscode.workspace.getConfiguration("http")["proxy"] as string | undefined,
            getProxyStrictSSL: () =>
                vscode.workspace.getConfiguration("http")["proxyStrictSSL"] as boolean | undefined,
            parseUriScheme: (value: string) => vscode.Uri.parse(value).scheme,
            showWarningMessage: (message: string) => {
                void vscode.window.showWarningMessage(message);
            },
            getErrorMessage,
            messages: {
                missingProtocolWarning: LocalizedConstants.Proxy.missingProtocolWarning,
                unparseableWarning: LocalizedConstants.Proxy.unparseableWarning,
                unableToGetProxyAgentOptions: LocalizedConstants.Proxy.unableToGetProxyAgentOptions,
            },
        };
        super(logger, dependencies);
    }
}

export { HttpDownloadError, IDownloadFileOptions, IDownloadFileResult };
