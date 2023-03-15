/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { parse as parseUrl, Url } from 'url';
import { ILogger } from '../models/interfaces';
import { IHttpClient, IPackage, IStatusView, PackageError } from './interfaces';
import { getProxyAgent, isBoolean } from './proxy';

/*
 * Http client class to handle downloading files using http or https urls
 */
export default class HttpClient implements IHttpClient {

	/*
	 * Downloads a file and stores the result in the temp file inside the package object
	 */
	public downloadFile(
		urlString: string,
		pkg: IPackage,
		logger: ILogger,
		statusView: IStatusView,
		proxy?: string,
		strictSSL?: boolean,
		authorization?: string): Promise<void> {
		const url = parseUrl(urlString);
		let options = this.getHttpClientOptions(url, proxy, strictSSL, authorization);
		let clientRequest = url.protocol === 'http:' ? http.request : https.request;

		return new Promise<void>((resolve, reject) => {
			if (!pkg.tmpFile || pkg.tmpFile.fd === 0) {
				return reject(new PackageError('Temporary package file unavailable', pkg));
			}

			let request = clientRequest(options, response => {
				if (response.statusCode === 301 || response.statusCode === 302) {
					// Redirect - download from new location
					return resolve(this.downloadFile(response.headers.location!, pkg, logger, statusView, proxy, strictSSL, authorization));
				}

				if (response.statusCode !== 200) {
					// Download failed - print error message
					logger.appendLine(`failed (error code '${response.statusCode}')`);
					return reject(new PackageError(response.statusCode!.toString(), pkg));
				}

				// If status code is 200
				this.handleSuccessfulResponse(pkg, response, logger, statusView).then(_ => {
					resolve();
				}).catch(err => {
					reject(err);
				});
			});

			request.on('error', (error: any) => {
				reject(new PackageError(`Request error: ${error.code || 'NONE'}`, pkg, error));
			});

			// Execute the request
			request.end();
		});
	}

	private getHttpClientOptions(url: Url, proxy?: string, strictSSL?: boolean, authorization?: string): any {
		const agent = getProxyAgent(url, proxy, strictSSL);

		let options: http.RequestOptions = {
			host: url.hostname,
			path: url.path,
			agent: agent
		};

		if (url.protocol === 'https:') {
			let httpsOptions: https.RequestOptions = {
				host: url.hostname,
				path: url.path,
				agent: agent,
				rejectUnauthorized: isBoolean(strictSSL) ? strictSSL : true
			};
			options = httpsOptions;
		}
		if (authorization) {
			options.headers = Object.assign(options.headers || {}, { 'Proxy-Authorization': authorization });
		}

		return options;
	}

	/*
	 * Calculate the download percentage and stores in the progress object
	 */
	public handleDataReceivedEvent(progress: IDownloadProgress, data: any, logger: ILogger, statusView: IStatusView): void {
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
				logger.append('.'.repeat(newDots - progress.dots));
				progress.dots = newDots;
			}
		}
		return;
	}

	private handleSuccessfulResponse(pkg: IPackage, response: http.IncomingMessage, logger: ILogger, statusView: IStatusView): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let progress: IDownloadProgress = {
				packageSize: parseInt(response.headers['content-length']!, 10),
				dots: 0,
				downloadedBytes: 0,
				downloadPercentage: 0
			};
			logger.append(`(${Math.ceil(progress.packageSize / 1024)} KB) `);
			response.on('data', data => {
				this.handleDataReceivedEvent(progress, data, logger, statusView);
			});
			let tmpFile = fs.createWriteStream('', { fd: pkg.tmpFile.fd });
			response.on('end', () => {
				resolve();
			});

			response.on('error', (err: any) => {
				reject(new PackageError(`Response error: ${err.code || 'NONE'}`, pkg, err));
			});

			// Begin piping data from the response to the package file
			response.pipe(tmpFile, { end: false });
		});
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
