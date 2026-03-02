/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as fs from "fs";
import {
    HttpClientCore,
    IHttpClientDependencies,
    ILogger,
    HttpDownloadError,
    IDownloadFileOptions,
    IDownloadFileResult,
} from "./httpClientCore";
import * as constants from "../common/constants";

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
        };
        super(logger, dependencies);
    }

    /**
     * Downloads a file from downloadUrl and writes it to targetPath (path-based wrapper over downloadFile).
     * Used by build tooling (buildHelper.ts) which works with file paths rather than file descriptors.
     */
    public async download(
        downloadUrl: string,
        targetPath: string,
        outputChannel?: vscode.OutputChannel,
    ): Promise<void> {
        const fd = fs.openSync(targetPath, "w");

        let totalMB: number | undefined;
        let receivedBytes = 0;
        let printThreshold = 0.1;

        const options: IDownloadFileOptions = {
            onHeaders: (headers) => {
                const totalBytes = parseInt((headers["content-length"] as string) || "0");
                totalMB = totalBytes > 0 ? totalBytes / (1024 * 1024) : undefined;
                if (totalMB !== undefined) {
                    outputChannel?.appendLine(
                        `${constants.downloading} ${downloadUrl} (0 / ${totalMB.toFixed(2)} MB)`,
                    );
                }
            },
            onData: (chunk: Buffer) => {
                receivedBytes += chunk.length;
                if (totalMB) {
                    const receivedMB = receivedBytes / (1024 * 1024);
                    if (receivedMB / totalMB >= printThreshold) {
                        outputChannel?.appendLine(
                            `${constants.downloadProgress} (${receivedMB.toFixed(2)} / ${totalMB.toFixed(2)} MB)`,
                        );
                        printThreshold += 0.1;
                    }
                }
            },
        };

        let result: IDownloadFileResult;
        try {
            result = await this.downloadFile(downloadUrl, fd, options);
        } catch (e) {
            outputChannel?.appendLine(constants.downloadError);
            throw e;
        } finally {
            fs.closeSync(fd);
        }

        if (result.status !== 200) {
            outputChannel?.appendLine(constants.downloadError);
            throw new Error(`HTTP ${result.status}`);
        }
    }
}

export { ILogger, HttpDownloadError, IDownloadFileOptions, IDownloadFileResult };
