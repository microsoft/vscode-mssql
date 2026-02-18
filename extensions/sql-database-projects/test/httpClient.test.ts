/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import should = require('should/as-function');
import * as sinon from 'sinon';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { Readable } from 'stream';
import { HttpClient } from '../src/common/httpClient';

suite('HttpClient Tests', function (): void {

	let axiosGetStub: sinon.SinonStub;

	setup(() => {
		axiosGetStub = sinon.stub(axios, 'get');
		// Clear the cache before each test
		(HttpClient as any).cache = new Map();
	});

	teardown(() => {
		sinon.restore();
	});

	// ---- getRequest tests (uses axios in both old and new code) ----

	suite('getRequest', () => {
		test('Should return data on successful GET request', async () => {
			const mockData = { items: [1, 2, 3] };
			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				data: mockData
			});

			const result = await HttpClient.getRequest('https://example.com/api/data');
			should(result).deepEqual(mockData);
			should(axiosGetStub.calledOnce).be.true();
		});

		test('Should throw error on non-200 status', async () => {
			axiosGetStub.resolves({
				status: 404,
				statusText: 'Not Found',
				data: {}
			});

			await should(HttpClient.getRequest('https://example.com/api/missing'))
				.be.rejectedWith(/404/);
		});

		test('Should throw error with error details from response body', async () => {
			axiosGetStub.resolves({
				status: 400,
				statusText: 'Bad Request',
				data: {
					error: {
						code: 'InvalidInput',
						message: 'The input was invalid'
					}
				}
			});

			await should(HttpClient.getRequest('https://example.com/api/bad'))
				.be.rejectedWith(/InvalidInput/);
		});

		test('Should cache results when useCache is true', async () => {
			const mockData = { value: 'cached' };
			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				data: mockData
			});

			const url = 'https://example.com/api/cached';
			const result1 = await HttpClient.getRequest(url, true);
			const result2 = await HttpClient.getRequest(url, true);

			should(result1).deepEqual(mockData);
			should(result2).deepEqual(mockData);
			// axios.get should only have been called once because the second call should use the cache
			should(axiosGetStub.calledOnce).be.true();
		});

		test('Should not cache results when useCache is false', async () => {
			const mockData = { value: 'not-cached' };
			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				data: mockData
			});

			const url = 'https://example.com/api/not-cached';
			await HttpClient.getRequest(url, false);
			await HttpClient.getRequest(url, false);

			// axios.get should have been called twice
			should(axiosGetStub.calledTwice).be.true();
		});

		test('Should pass correct headers in request config', async () => {
			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				data: {}
			});

			await HttpClient.getRequest('https://example.com/api/headers');

			const config = axiosGetStub.firstCall.args[1];
			should(config.headers['Content-Type']).equal('application/json');
			should(config.validateStatus).be.a.Function();
			// validateStatus should always return true (never throw)
			should(config.validateStatus(500)).be.true();
			should(config.validateStatus(200)).be.true();
		});
	});

	// ---- download tests (now uses axios with responseType: 'stream') ----

	suite('download', () => {
		let tempDir: string;
		let targetPath: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'httpClient-test-'));
			targetPath = path.join(tempDir, 'downloaded-file.bin');
		});

		teardown(() => {
			try {
				if (fs.existsSync(targetPath)) {
					fs.unlinkSync(targetPath);
				}
				if (fs.existsSync(tempDir)) {
					fs.rmdirSync(tempDir);
				}
			} catch {
				// cleanup best effort
			}
		});

		test('Should download file to target path', async () => {
			const fileContent = 'Hello, this is test file content';
			const readable = new Readable();
			readable.push(Buffer.from(fileContent));
			readable.push(null);

			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				headers: { 'content-length': String(fileContent.length) },
				data: readable
			});

			const httpClient = new HttpClient();
			await httpClient.download('https://example.com/file.zip', targetPath);

			should(fs.existsSync(targetPath)).be.true();
			const downloadedContent = fs.readFileSync(targetPath, 'utf-8');
			should(downloadedContent).equal(fileContent);
		});

		test('Should pass stream responseType and timeout to axios', async () => {
			const readable = new Readable();
			readable.push(Buffer.from('data'));
			readable.push(null);

			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				headers: {},
				data: readable
			});

			const httpClient = new HttpClient();
			await httpClient.download('https://example.com/file.zip', targetPath);

			const config = axiosGetStub.firstCall.args[1];
			should(config.responseType).equal('stream');
			should(config.timeout).equal(20000);
		});

		test('Should reject on non-200 status', async () => {
			axiosGetStub.resolves({
				status: 404,
				statusText: 'Not Found',
				headers: {},
				data: null
			});

			const httpClient = new HttpClient();
			await should(httpClient.download('https://example.com/missing.zip', targetPath))
				.be.rejected();
		});

		test('Should report download progress to output channel', async () => {
			// Create a file that is large enough to trigger progress reporting
			const chunkSize = 1024 * 1024; // 1 MB
			const totalSize = chunkSize * 2; // 2 MB total

			const readable = new Readable({
				read() {
					// Push two 1 MB chunks
					this.push(Buffer.alloc(chunkSize, 'a'));
					this.push(Buffer.alloc(chunkSize, 'b'));
					this.push(null);
				}
			});

			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				headers: { 'content-length': String(totalSize) },
				data: readable
			});

			const appendedLines: string[] = [];
			const mockOutputChannel = {
				appendLine: (line: string) => appendedLines.push(line)
			} as any;

			const httpClient = new HttpClient();
			await httpClient.download('https://example.com/large-file.zip', targetPath, mockOutputChannel);

			// Should have at least the initial download message
			should(appendedLines.length).be.greaterThan(0);
			// First message should contain the download URL
			should(appendedLines[0]).containEql('https://example.com/large-file.zip');
		});

		test('Should work without output channel', async () => {
			const readable = new Readable();
			readable.push(Buffer.from('data'));
			readable.push(null);

			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				headers: {},
				data: readable
			});

			const httpClient = new HttpClient();
			// Should not throw when outputChannel is undefined
			await httpClient.download('https://example.com/file.zip', targetPath);

			should(fs.existsSync(targetPath)).be.true();
		});

		test('Should reject on stream error', async () => {
			const readable = new Readable({
				read() {
					this.destroy(new Error('Network error during download'));
				}
			});

			axiosGetStub.resolves({
				status: 200,
				statusText: 'OK',
				headers: {},
				data: readable
			});

			const httpClient = new HttpClient();
			await should(httpClient.download('https://example.com/error.zip', targetPath))
				.be.rejectedWith(/Network error during download/);
		});
	});
});
