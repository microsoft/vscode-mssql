/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogger } from "../models/interfaces";
import { HttpDownloadError, HttpClientCore, IDownloadFileResult } from "../http/httpClientCore";
import { IPackage, IStatusView, PackageError } from "./interfaces";

/*
 * Http client class to handle downloading files using http or https urls
 */
export default class DownloadHelper {
    /*
     * Downloads a file and stores the result in the temp file inside the package object
     */
    public downloadFile(
        urlString: string,
        pkg: IPackage,
        logger: ILogger,
        statusView: IStatusView,
    ): Promise<void> {
        return this.downloadFileWithProgress(urlString, pkg, logger, statusView);
    }

    private async downloadFileWithProgress(
        urlString: string,
        pkg: IPackage,
        logger: ILogger,
        statusView: IStatusView,
    ): Promise<void> {
        if (!pkg.tmpFile || pkg.tmpFile.fd === 0) {
            throw new PackageError("Temporary package file unavailable", pkg);
        }

        const progress: IDownloadProgress = {
            packageSize: 0,
            dots: 0,
            downloadedBytes: 0,
            downloadPercentage: 0,
        };

        const httpHelper = new HttpClientCore();

        try {
            const result: IDownloadFileResult = await httpHelper.downloadFile(
                urlString,
                pkg.tmpFile.fd,
                {
                    onHeaders: (headers) => {
                        progress.packageSize = this.getPackageSize(headers["content-length"]);
                        logger.append(`(${Math.ceil(progress.packageSize / 1024)} KB) `);
                    },
                    onData: (data) => {
                        this.handleDataReceivedEvent(progress, data, logger, statusView);
                    },
                },
            );

            if (result.status !== 200) {
                logger.appendLine(`failed (error code '${result.status}')`);
                throw new PackageError(result.status.toString(), pkg);
            }
        } catch (error: unknown) {
            if (error instanceof PackageError) {
                throw error;
            }

            if (error instanceof HttpDownloadError) {
                const messagePrefix =
                    error.phase === "response" ? "Response error" : "Request error";
                throw new PackageError(
                    `${messagePrefix}: ${error.innerError.code || "NONE"}`,
                    pkg,
                    error.innerError,
                );
            }

            throw new PackageError("Request error: NONE", pkg, error);
        }
    }

    /*
     * Calculate the download percentage and stores in the progress object
     */
    public handleDataReceivedEvent(
        progress: IDownloadProgress,
        data: Buffer,
        logger: ILogger,
        statusView: IStatusView,
    ): void {
        progress.downloadedBytes += data.length;

        // Update status bar item with percentage
        if (progress.packageSize > 0) {
            let newPercentage = Math.ceil(100 * (progress.downloadedBytes / progress.packageSize));
            if (newPercentage !== progress.downloadPercentage) {
                statusView.updateServiceDownloadingProgress(progress.downloadPercentage);
                progress.downloadPercentage = newPercentage;
            }

            // Update dots after package name in output console
            let newDots = Math.ceil(progress.downloadPercentage / 5);
            if (newDots > progress.dots) {
                logger.append(".".repeat(newDots - progress.dots));
                progress.dots = newDots;
            }
        }
        return;
    }

    private getPackageSize(contentLengthHeader: unknown): number {
        if (typeof contentLengthHeader === "number") {
            return contentLengthHeader;
        }

        if (Array.isArray(contentLengthHeader)) {
            return this.getPackageSize(contentLengthHeader[0]);
        }

        if (typeof contentLengthHeader !== "string") {
            return 0;
        }

        const packageSize = parseInt(contentLengthHeader, 10);
        return Number.isNaN(packageSize) ? 0 : packageSize;
    }
}

/*
 * Interface to store the values needed to calculate download percentage
 */
export interface IDownloadProgress {
    packageSize: number;
    downloadedBytes: number;
    downloadPercentage: number;
    dots: number;
}
