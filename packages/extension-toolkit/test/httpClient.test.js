/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { PassThrough, Writable } = require("node:stream");
const { afterEach, beforeEach, describe, it, mock } = require("node:test");
const { HttpClient, HttpDownloadError, ProxyConfigurationError } = require("../dist/base/index.js");

describe("HttpClient", () => {
    let httpClient;
    let logger;

    beforeEach(() => {
        logger = createMockLogger();
        httpClient = new HttpClient({
            logger,
            proxyResolver: { resolve: () => undefined },
        });
    });

    afterEach(() => {
        mock.restoreAll();
    });

    describe("makeGetRequest", () => {
        it("makes a successful GET request", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const responseData = { value: [{ id: 1, name: "test" }] };
            const mockResponse = {
                data: responseData,
                status: 200,
                statusText: "OK",
                headers: {},
            };
            const get = mock.method(httpClient, "get", async () => mockResponse);
            mock.method(httpClient, "setupConfigAndProxyForRequest", () => ({
                headers: { Authorization: `Bearer ${token}` },
                validateStatus: () => true,
            }));

            const result = await httpClient.makeGetRequest(requestUrl, token);

            assert.deepEqual(result, mockResponse);
            assert.equal(get.mock.callCount(), 1);
            assert.equal(get.mock.calls[0].arguments[0], requestUrl);
            assert.equal(typeof get.mock.calls[0].arguments[1], "object");
        });
    });

    describe("makePostRequest", () => {
        it("makes a successful POST request", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const payload = { name: "new item" };
            const responseData = { id: 2, name: "new item" };
            const mockResponse = {
                data: responseData,
                status: 201,
                statusText: "Created",
                headers: {},
            };
            const post = mock.method(httpClient, "post", async () => mockResponse);
            mock.method(httpClient, "setupConfigAndProxyForRequest", () => ({
                headers: { Authorization: `Bearer ${token}` },
                validateStatus: () => true,
            }));

            const result = await httpClient.makePostRequest(requestUrl, token, payload);

            assert.deepEqual(result, mockResponse);
            assert.equal(post.mock.callCount(), 1);
            assert.equal(post.mock.calls[0].arguments[0], requestUrl);
            assert.equal(post.mock.calls[0].arguments[1], payload);
            assert.equal(typeof post.mock.calls[0].arguments[2], "object");
        });
    });

    describe("downloadFile", () => {
        it("downloads successfully and invokes callbacks", async () => {
            const requestUrl = "https://download.example.com/file";
            const normalizedUrl = "https://download.example.com:443/file";
            const headers = { "content-length": "5" };
            const responseStream = new PassThrough();
            const receivedChunkLengths = [];
            let releaseWriteStream;
            const tmpFileStream = new Writable({
                write(chunk, _encoding, callback) {
                    receivedChunkLengths.push(chunk.length);
                    callback();
                },
                final(callback) {
                    releaseWriteStream = callback;
                },
            });
            mock.method(httpClient, "setupRequest", () => ({
                requestUrl: normalizedUrl,
                config: {},
            }));
            const createWriteStream = mock.method(fs, "createWriteStream", () => tmpFileStream);
            const mockResponse = {
                data: responseStream,
                status: 200,
                statusText: "OK",
                headers,
            };
            const get = mock.method(httpClient, "get", async () => mockResponse);
            const onProgress = mock.fn();
            let downloadCompleted = false;

            const downloadPromise = httpClient
                .downloadFile(requestUrl, 123, { onProgress })
                .then((result) => {
                    downloadCompleted = true;
                    return result;
                });

            responseStream.write(Buffer.from([1, 2, 3]));
            responseStream.end(Buffer.from([4, 5]));
            await new Promise((resolve) => setImmediate(resolve));

            assert.equal(downloadCompleted, false);
            assert.equal(typeof releaseWriteStream, "function");
            releaseWriteStream();

            const result = await downloadPromise;

            assert.equal(result.status, 200);
            assert.equal(result.headers, headers);
            assert.deepEqual(receivedChunkLengths, [3, 2]);
            assert.deepEqual(
                onProgress.mock.calls.map((call) => call.arguments[0]),
                [
                    { downloadedBytes: 0, totalBytes: 5, percentage: 0 },
                    { downloadedBytes: 3, totalBytes: 5, percentage: 60 },
                    { downloadedBytes: 5, totalBytes: 5, percentage: 100 },
                ],
            );
            assert.equal(get.mock.calls[0].arguments[0], normalizedUrl);
            assert.equal(get.mock.calls[0].arguments[1].responseType, "stream");
            assert.deepEqual(createWriteStream.mock.calls[0].arguments, [
                "",
                { fd: 123, autoClose: false },
            ]);
        });

        it("returns the error code and destroys the stream for an HTTP error", async () => {
            const requestUrl = "https://download.example.com/file";
            const normalizedUrl = "https://download.example.com:443/file";
            const headers = { "content-length": "0" };
            const responseStream = new PassThrough();
            const destroy = mock.method(responseStream, "destroy", () => responseStream);
            mock.method(httpClient, "setupRequest", () => ({
                requestUrl: normalizedUrl,
                config: {},
            }));
            const mockResponse = {
                data: responseStream,
                status: 404,
                statusText: "Not Found",
                headers,
            };
            mock.method(httpClient, "get", async () => mockResponse);
            const onProgress = mock.fn();

            const result = await httpClient.downloadFile(requestUrl, 123, { onProgress });

            assert.equal(result.status, 404);
            assert.equal(result.headers, headers);
            assert.deepEqual(onProgress.mock.calls[0].arguments, [
                { downloadedBytes: 0, totalBytes: undefined, percentage: undefined },
            ]);
            assert.equal(destroy.mock.callCount(), 1);
        });

        it("opens and closes path destinations", async () => {
            const result = { status: 200, headers: {} };
            const openSync = mock.method(fs, "openSync", () => 123);
            const closeSync = mock.method(fs, "closeSync", () => undefined);
            mock.method(httpClient, "downloadToFileDescriptor", async () => result);

            const actual = await httpClient.downloadFile("https://example.com/file", "target.zip");

            assert.equal(actual, result);
            assert.deepEqual(openSync.mock.calls[0].arguments, ["target.zip", "w"]);
            assert.deepEqual(closeSync.mock.calls[0].arguments, [123]);
        });

        it("wraps request errors in HttpDownloadError", async () => {
            const requestUrl = "https://download.example.com/file";
            mock.method(httpClient, "setupRequest", () => ({ requestUrl, config: {} }));
            const requestError = Object.assign(new Error("network error"), {
                code: "ECONNRESET",
            });
            mock.method(httpClient, "get", async () => {
                throw requestError;
            });

            await assert.rejects(httpClient.downloadFile(requestUrl, 123), (error) => {
                assert.ok(error instanceof HttpDownloadError);
                assert.equal(error.phase, "request");
                assert.equal(error.innerError, requestError);
                return true;
            });
        });

        it("wraps response stream errors in HttpDownloadError", async () => {
            const requestUrl = "https://download.example.com/file";
            const responseStream = new PassThrough();
            const tmpFileStream = new PassThrough();
            mock.method(httpClient, "setupRequest", () => ({ requestUrl, config: {} }));
            mock.method(fs, "createWriteStream", () => tmpFileStream);
            const mockResponse = {
                data: responseStream,
                status: 200,
                statusText: "OK",
                headers: {},
            };
            mock.method(httpClient, "get", async () => mockResponse);
            const responseError = Object.assign(new Error("stream failed"), { code: "EPIPE" });

            const downloadPromise = httpClient.downloadFile(requestUrl, 123);
            await new Promise((resolve) => setImmediate(resolve));
            responseStream.emit("error", responseError);

            await assert.rejects(downloadPromise, (error) => {
                assert.ok(error instanceof HttpDownloadError);
                assert.equal(error.phase, "response");
                assert.equal(error.innerError, responseError);
                return true;
            });
        });
    });

    describe("proxy request configuration", () => {
        it("disables Axios proxy detection and leaves direct URLs unchanged", () => {
            const requestUrl = "https://api.example.com/path?version=2";

            const request = httpClient.setupRequest(requestUrl, "test-token");

            assert.equal(request.requestUrl, requestUrl);
            assert.equal(request.config.proxy, false);
            assert.equal(request.config.httpsAgent, undefined);
            assert.equal(request.config.headers.Authorization, "Bearer test-token");
        });

        it("wraps proxy resolver failures without exposing the configured value", () => {
            const secretProxy = "http://user:secret@proxy.example.com:3128";
            const proxyResolver = {
                resolve: () => {
                    throw new Error(secretProxy);
                },
            };
            const client = new HttpClient({ logger, proxyResolver });

            assert.throws(
                () => client.setupConfigAndProxyForRequest("https://example.test"),
                (error) => {
                    assert.ok(error instanceof ProxyConfigurationError);
                    assert.equal(error.message, "Unable to resolve the configured proxy.");
                    return true;
                },
            );
            assert.ok(
                logger.error.mock.calls.some(
                    (call) => call.arguments[0] === "Unable to resolve the configured proxy.",
                ),
            );
            assert.equal(
                logger.error.mock.calls
                    .flatMap((call) => call.arguments)
                    .join(" ")
                    .includes("secret"),
                false,
            );
        });

        it("resolves the proxy again when a request redirects", () => {
            const resolvedTargets = [];
            const { factory } = createRecordingFactory();
            const proxyResolver = {
                resolve: (target) => {
                    resolvedTargets.push(target.toString());
                    return target.pathname === "/start"
                        ? {
                              url: new URL("http://proxy.example.com:3128"),
                              rejectUnauthorized: true,
                              source: "environment",
                          }
                        : undefined;
                },
            };
            const client = new HttpClient({ logger, proxyResolver, proxyAgentFactory: factory });
            const config = client.setupConfigAndProxyForRequest("http://example.test/start");
            const redirectOptions = {
                href: "https://redirected.example.test/final",
                agents: { http: config.httpAgent, https: config.httpsAgent },
            };

            config.beforeRedirect(
                redirectOptions,
                { headers: {}, statusCode: 302 },
                { headers: {}, url: "http://example.test/start", method: "GET" },
            );

            assert.deepEqual(resolvedTargets, [
                "http://example.test/start",
                "https://redirected.example.test/final",
            ]);
            assert.equal(redirectOptions.agents.https, undefined);
            assert.equal(redirectOptions.agent, undefined);
        });

        for (const testCase of [
            {
                target: "http://example.test",
                proxy: "http://proxy.example.com:3128",
                expectedFactory: "httpOverHttp",
            },
            {
                target: "http://example.test",
                proxy: "https://proxy.example.com:3128",
                expectedFactory: "httpOverHttps",
            },
            {
                target: "https://example.test",
                proxy: "http://proxy.example.com:3128",
                expectedFactory: "httpsOverHttp",
            },
            {
                target: "https://example.test",
                proxy: "https://proxy.example.com:3128",
                expectedFactory: "httpsOverHttps",
            },
        ]) {
            it(`uses ${testCase.expectedFactory} for ${new URL(testCase.target).protocol} over ${new URL(testCase.proxy).protocol}`, () => {
                const { factory, calls } = createRecordingFactory();
                const proxyResolver = {
                    resolve: () => ({
                        url: new URL(testCase.proxy),
                        rejectUnauthorized: true,
                        source: "environment",
                    }),
                };
                const client = new HttpClient({
                    logger,
                    proxyResolver,
                    proxyAgentFactory: factory,
                });

                client.setupConfigAndProxyForRequest(testCase.target);

                assert.deepEqual(
                    calls.map((call) => call.method),
                    [testCase.expectedFactory],
                );
            });
        }

        it("decodes credentials and applies certificate settings only to HTTPS proxies", () => {
            const { factory, calls } = createRecordingFactory();
            const proxyResolver = {
                resolve: (target) => ({
                    url: new URL(
                        target.pathname === "/secure"
                            ? "https://us%40er:p%3Ass@proxy.example.com"
                            : "http://us%40er:p%3Ass@proxy.example.com",
                    ),
                    rejectUnauthorized: false,
                    source: "vscode",
                }),
            };
            const client = new HttpClient({ logger, proxyResolver, proxyAgentFactory: factory });

            client.setupConfigAndProxyForRequest("https://example.test/direct");
            client.setupConfigAndProxyForRequest("https://example.test/secure");

            assert.equal(calls[0].options.proxy.proxyAuth, "us@er:p:ss");
            assert.equal(calls[0].options.proxy.rejectUnauthorized, undefined);
            assert.equal(calls[1].options.proxy.proxyAuth, "us@er:p:ss");
            assert.equal(calls[1].options.proxy.rejectUnauthorized, false);
            assert.equal(calls[1].options.proxy.port, 443);
        });
    });
});

function createMockLogger() {
    return {
        debug: mock.fn(),
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
        piiSanitized: mock.fn(),
    };
}

function createRecordingFactory() {
    const calls = [];
    const record = (method) => (options) => {
        calls.push({ method, options });
        return new http.Agent();
    };

    return {
        calls,
        factory: {
            httpOverHttp: record("httpOverHttp"),
            httpOverHttps: record("httpOverHttps"),
            httpsOverHttp: record("httpsOverHttp"),
            httpsOverHttps: record("httpsOverHttps"),
        },
    };
}
