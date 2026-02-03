/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import axios, { AxiosRequestConfig } from 'axios';
import * as constants from './constants';

const DownloadTimeoutMs = 20000;

/**
 * Class includes method for making http request
 */
export class HttpClient {
	private static cache: Map<string, any> = new Map();

	/**
	 * Makes http GET request to the given url. If useCache is set to true, returns the result from cache if exists
	 * @param url url to make http GET request against
	 * @param useCache if true and result is already cached the cached value will be returned
	 * @returns result of http GET request
	 */
	public static async getRequest(url: string, useCache = false): Promise<any> {

		if (useCache) {
			if (HttpClient.cache.has(url)) {
				return HttpClient.cache.get(url);
			}
		}

		const config: AxiosRequestConfig = {
			headers: {
				'Content-Type': 'application/json'
			},
			validateStatus: () => true // Never throw
		};
		const response = await axios.get(url, config);
		if (response.status !== 200) {
			let errorMessage: string[] = [];
			errorMessage.push(response.status.toString());
			errorMessage.push(response.statusText);
			if (response.data?.error) {
				errorMessage.push(`${response.data?.error?.code} : ${response.data?.error?.message}`);
			}
			throw new Error(errorMessage.join(os.EOL));
		}

		if (useCache) {
			HttpClient.cache.set(url, response.data);
		}
		return response.data;
	}

	/**
	 * Gets a file/fileContents at the given URL. Function is copied from Machine Learning extension extensions/machine-learning/src/common/httpClient.ts
	 * @param downloadUrl The URL to download the file from
	 * @param targetPath The path to download the file to
	 * @param outputChannel The output channel to output status messages to
	 * @returns Full path to the downloaded file or the contents of the file at the given downloadUrl
	 */
	public async download(downloadUrl: string, targetPath: string, outputChannel?: vscode.OutputChannel): Promise<void> {
		try {
			const response = await axios({
				method: 'GET',
				url: downloadUrl,
				responseType: 'stream',
				timeout: DownloadTimeoutMs
			});

			if (response.status !== 200) {
				outputChannel?.appendLine(constants.downloadError);
				throw new Error(`Failed to download: ${response.statusText}`);
			}

			const contentLength = response.headers['content-length'];
			const totalBytes = parseInt(contentLength || '0');
			const totalMegaBytes = totalBytes / (1024 * 1024);
			outputChannel?.appendLine(`${constants.downloading} ${downloadUrl} (0 / ${totalMegaBytes.toFixed(2)} MB)`);

			let receivedBytes = 0;
			let printThreshold = 0.1;

			const writer = fs.createWriteStream(targetPath);

			response.data.on('data', (chunk: Buffer) => {
				receivedBytes += chunk.length;
				if (totalMegaBytes > 0) {
					const receivedMegaBytes = receivedBytes / (1024 * 1024);
					const percentage = receivedMegaBytes / totalMegaBytes;
					if (percentage >= printThreshold) {
						outputChannel?.appendLine(`${constants.downloadProgress} (${receivedMegaBytes.toFixed(2)} / ${totalMegaBytes.toFixed(2)} MB)`);
						printThreshold += 0.1;
					}
				}
			});

			return new Promise((resolve, reject) => {
				const cleanup = () => {
					response.data.destroy();
					writer.destroy();
				};

				writer.on('finish', () => resolve());
				writer.on('error', (err) => {
					cleanup();
					outputChannel?.appendLine(constants.downloadError);
					reject(err);
				});
				response.data.on('error', (err: Error) => {
					cleanup();
					outputChannel?.appendLine(constants.downloadError);
					reject(err);
				});

				response.data.pipe(writer);
			});
		} catch (error) {
			outputChannel?.appendLine(constants.downloadError);
			throw error;
		}
	}
}
