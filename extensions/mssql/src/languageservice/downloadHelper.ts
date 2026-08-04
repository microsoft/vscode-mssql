/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    HttpClient,
    HttpDownloadError,
    IDownloadFileResult,
    IDownloadProgress,
} from "extension-toolkit/base";
import { ILogger } from "../sharedInterfaces/logger";
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

        const progressState: IDownloadProgressState = {
            dots: 0,
            downloadPercentage: 0,
        };

        const httpHelper = new HttpClient({ logger });

        try {
            const result: IDownloadFileResult = await httpHelper.downloadFile(
                urlString,
                pkg.tmpFile.fd,
                {
                    onProgress: (progress) => {
                        this.handleDownloadProgress(progress, progressState, logger, statusView);
                    },
                },
            );

            if (result.status !== 200) {
                logger.error(`failed (error code '${result.status}')`);
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
    public handleDownloadProgress(
        progress: IDownloadProgress,
        progressState: IDownloadProgressState,
        logger: ILogger,
        statusView: IStatusView,
    ): void {
        if (progress.downloadedBytes === 0 && progress.totalBytes !== undefined) {
            logger.debug(
                `Package size: ${this.formatBytes(progress.totalBytes)} (${Math.ceil(progress.totalBytes / 1024)} KB)`,
            );
        }

        if (progress.percentage !== undefined && progress.totalBytes !== undefined) {
            const newPercentage = Math.min(100, Math.ceil(progress.percentage));
            if (newPercentage !== progressState.downloadPercentage) {
                statusView.updateServiceDownloadingProgress(newPercentage);
                progressState.downloadPercentage = newPercentage;
            }

            const newDots = Math.ceil(progressState.downloadPercentage / 5);
            if (newDots > progressState.dots) {
                logger.info(this.formatProgressMessage(progress, progressState.downloadPercentage));
                progressState.dots = newDots;
            }
        }
    }

    private formatProgressMessage(progress: IDownloadProgress, percentage: number): string {
        const totalSteps = 20;
        const completedSteps = Math.min(totalSteps, Math.ceil(percentage / 5));
        const progressBar = `${"#".repeat(completedSteps)}${"-".repeat(totalSteps - completedSteps)}`;
        const downloadedDisplay = this.formatBytes(
            Math.min(progress.downloadedBytes, progress.totalBytes ?? progress.downloadedBytes),
        );
        const totalDisplay = this.formatBytes(progress.totalBytes ?? progress.downloadedBytes);

        return `Download progress [${progressBar}] ${percentage}% (${downloadedDisplay} / ${totalDisplay})`;
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }

        const kilobytes = bytes / 1024;
        if (kilobytes < 1024) {
            return `${kilobytes.toFixed(1)} KB`;
        }

        const megabytes = kilobytes / 1024;
        return `${megabytes.toFixed(1)} MB`;
    }
}

/*
 * Interface to store the values needed to calculate download percentage
 */
export interface IDownloadProgressState {
    downloadPercentage: number;
    dots: number;
}
