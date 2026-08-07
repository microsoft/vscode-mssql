/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PassThrough, Writable } = require("node:stream");
const { afterEach, beforeEach, describe, it, mock } = require("node:test");
const { HttpClient, HttpDownloadError, ProxyMessages } = require("../dist/base/index.js");

const proxyEnvironmentVariables = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"];

describe("HttpClient", () => {
    let environment;
    let httpClient;
    let logger;
    let parseUriScheme;
    let proxyValue;

    beforeEach(() => {
        environment = Object.fromEntries(
            proxyEnvironmentVariables.map((name) => [name, process.env[name]]),
        );
        for (const name of proxyEnvironmentVariables) {
            delete process.env[name];
        }

        logger = createMockLogger();
        parseUriScheme = (value) => new URL(value).protocol;
        proxyValue = undefined;
        httpClient = new HttpClient(logger, {
            getProxyConfig: () => proxyValue,
            parseUriScheme: (value) => parseUriScheme(value),
        });
    });

    afterEach(() => {
        mock.restoreAll();
        for (const name of proxyEnvironmentVariables) {
            const value = environment[name];
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    });

    describe("get", () => {
        it("makes a successful GET request", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const mockResponse = {
                data: { value: [{ id: 1, name: "test" }] },
                status: 200,
                statusText: "OK",
                headers: { "x-request-id": "request-id", "retry-after": 5 },
                config: { internal: true },
            };
            const send = mock.method(httpClient, "send", async () => mockResponse);

            const result = await httpClient.get(requestUrl, {
                headers: { Authorization: `Bearer ${token}` },
            });

            assert.equal(result.data, mockResponse.data);
            assert.equal(result.status, 200);
            assert.equal(result.statusText, "OK");
            assert.equal(result.ok, true);
            assert.equal(result.headers.get("X-Request-Id"), "request-id");
            assert.equal(result.headers.get("retry-after"), "5");
            assert.equal(send.mock.callCount(), 1);
            assert.equal(send.mock.calls[0].arguments[0], "https://api.example.com:443/data");
            assert.deepEqual(send.mock.calls[0].arguments[1].headers, {
                Authorization: `Bearer ${token}`,
            });
        });
    });

    describe("postJson", () => {
        it("makes a successful POST request", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const payload = { name: "new item" };
            const mockResponse = {
                data: { id: 2, name: "new item" },
                status: 201,
                statusText: "Created",
                headers: {},
            };
            const send = mock.method(httpClient, "send", async () => mockResponse);

            const result = await httpClient.postJson(requestUrl, payload, {
                headers: { Authorization: `Bearer ${token}` },
            });

            assert.equal(result.data, mockResponse.data);
            assert.equal(result.status, 201);
            assert.equal(result.statusText, "Created");
            assert.equal(result.ok, true);
            assert.equal(send.mock.callCount(), 1);
            assert.equal(send.mock.calls[0].arguments[0], "https://api.example.com:443/data");
            assert.deepEqual(send.mock.calls[0].arguments[1].data, payload);
            assert.deepEqual(send.mock.calls[0].arguments[1].headers, {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/json",
            });
        });
    });

    describe("downloads", () => {
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
            const setupRequest = mock.method(httpClient, "setupRequest", () => ({
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
            const send = mock.method(httpClient, "send", async () => mockResponse);
            const onProgress = mock.fn();
            let downloadCompleted = false;

            const downloadPromise = httpClient
                .downloadToFileDescriptor(requestUrl, 123, { onProgress })
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
            assert.equal(result.ok, true);
            assert.equal(result.headers.get("Content-Length"), "5");
            assert.deepEqual(receivedChunkLengths, [3, 2]);
            assert.deepEqual(
                onProgress.mock.calls.map((call) => call.arguments[0]),
                [
                    { downloadedBytes: 0, totalBytes: 5, percentage: 0 },
                    { downloadedBytes: 3, totalBytes: 5, percentage: 60 },
                    { downloadedBytes: 5, totalBytes: 5, percentage: 100 },
                ],
            );
            assert.equal(send.mock.calls[0].arguments[0], normalizedUrl);
            assert.equal(setupRequest.mock.calls[0].arguments[1], "stream");
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
            mock.method(httpClient, "send", async () => ({
                data: responseStream,
                status: 404,
                statusText: "Not Found",
                headers,
            }));
            const onProgress = mock.fn();

            const result = await httpClient.downloadToFileDescriptor(requestUrl, 123, {
                onProgress,
            });

            assert.equal(result.status, 404);
            assert.equal(result.ok, false);
            assert.equal(result.headers.get("content-length"), "0");
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

            const actual = await httpClient.downloadToPath(
                "https://example.com/file",
                "target.zip",
            );

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
            mock.method(httpClient, "send", async () => {
                throw requestError;
            });

            await assert.rejects(httpClient.downloadToFileDescriptor(requestUrl, 123), (error) => {
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
            mock.method(httpClient, "send", async () => ({
                data: responseStream,
                status: 200,
                statusText: "OK",
                headers: {},
            }));
            const responseError = Object.assign(new Error("stream failed"), { code: "EPIPE" });

            const downloadPromise = httpClient.downloadToFileDescriptor(requestUrl, 123);
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

    describe("proxy configuration", () => {
        it("warns when the proxy lacks a protocol", () => {
            proxyValue = "localhost:1234";
            parseUriScheme = () => undefined;

            const warning = httpClient.getInvalidProxySettingsWarning();

            assert.equal(warning, ProxyMessages.missingProtocolWarning(proxyValue));
            assert.equal(logger.warn.mock.callCount(), 1);
        });

        it("warns when proxy parsing throws", () => {
            proxyValue = "env-proxy.example";
            const uriError = new Error("invalid uri format");
            parseUriScheme = () => {
                throw uriError;
            };

            const warning = httpClient.getInvalidProxySettingsWarning();

            assert.equal(warning, ProxyMessages.unparseableWarning(proxyValue, uriError.message));
            assert.equal(logger.warn.mock.callCount(), 1);
        });

        it("redacts proxy credentials and query values from warnings", () => {
            proxyValue = "http://user:super-secret@[invalid-host]?token=also-secret";
            parseUriScheme = () => {
                throw new Error(`Invalid URL: ${proxyValue}`);
            };

            const warning = httpClient.getInvalidProxySettingsWarning();
            const loggedWarning = logger.warn.mock.calls[0].arguments[0];

            for (const exposedValue of ["user", "super-secret", "token", "also-secret"]) {
                assert.equal(warning.includes(exposedValue), false);
                assert.equal(loggedWarning.includes(exposedValue), false);
            }
            assert.ok(warning.includes("<redacted>"));
            assert.ok(loggedWarning.includes("<redacted>"));
        });

        it("does not warn when the proxy is valid", () => {
            for (const validProxyValue of [
                "http://valid-proxy.test:8080",
                "https://valid-proxy.example",
                "socks5://valid-proxy.subdomain.domain.com:1080",
            ]) {
                proxyValue = validProxyValue;
                const warning = httpClient.getInvalidProxySettingsWarning();
                assert.equal(warning, undefined);
            }

            assert.equal(logger.warn.mock.callCount(), 0);
        });

        it("does not warn when the proxy is undefined", () => {
            const warning = httpClient.getInvalidProxySettingsWarning();

            assert.equal(warning, undefined);
            assert.equal(logger.warn.mock.callCount(), 0);
        });

        it("validates both protocol-specific environment proxies", () => {
            process.env.HTTPS_PROXY = "https://valid-proxy.example";
            process.env.HTTP_PROXY = "invalid-proxy";

            const warning = httpClient.getInvalidProxySettingsWarning();

            assert.equal(
                warning,
                ProxyMessages.unparseableWarning(process.env.HTTP_PROXY, "Invalid URL"),
            );
            assert.equal(logger.warn.mock.callCount(), 1);
        });

        it("prefers VS Code configuration over environment variables for requests", () => {
            proxyValue = "config-proxy";
            process.env.HTTP_PROXY = "env-proxy";
            process.env.https_proxy = "env-proxy";

            const proxy = httpClient.getProxyForRequest(new URL("https://api.example.com"));

            assert.equal(proxy, proxyValue);
        });

        it("falls back to environment variables when request configuration is missing", () => {
            process.env.HTTP_PROXY = "http://env-proxy";

            const proxy = httpClient.getProxyForRequest(new URL("http://api.example.com"));

            assert.equal(proxy, process.env.HTTP_PROXY);
        });

        it("selects the environment proxy for the request protocol", () => {
            process.env.HTTP_PROXY = "http://http-proxy";
            process.env.HTTPS_PROXY = "http://https-proxy";

            assert.equal(
                httpClient.getProxyForRequest(new URL("http://api.example.com")),
                process.env.HTTP_PROXY,
            );
            assert.equal(
                httpClient.getProxyForRequest(new URL("https://api.example.com")),
                process.env.HTTPS_PROXY,
            );
        });

        it("falls back to HTTP_PROXY for an HTTPS request", () => {
            process.env.HTTP_PROXY = "http://http-proxy";

            const proxy = httpClient.getProxyForRequest(new URL("https://api.example.com"));

            assert.equal(proxy, process.env.HTTP_PROXY);
        });

        it("does not use HTTPS_PROXY for an HTTP request", () => {
            process.env.HTTPS_PROXY = "http://https-proxy";

            const proxy = httpClient.getProxyForRequest(new URL("http://api.example.com"));

            assert.equal(proxy, undefined);
        });

        it("sets up an HTTP request with a proxy", () => {
            const fakeToken = "fake-token";
            const fakeProxyUrl = new URL("http://fake-proxy.test:8080");
            proxyValue = fakeProxyUrl.toString();

            const result = httpClient.setupConfigAndProxyForRequest(new URL("http://fakeUrl.ms/"), {
                Authorization: `Bearer ${fakeToken}`,
            });

            assert.ok(result.headers.Authorization.includes(fakeToken));
            assert.equal(result.proxy, false);
            assert.deepEqual(result.httpAgent.proxyOptions, {
                host: fakeProxyUrl.hostname,
                port: Number.parseInt(fakeProxyUrl.port),
            });
            assert.equal(result.httpsAgent, undefined);
        });

        it("applies proxyStrictSSL to an HTTPS proxy case-insensitively", () => {
            for (const proxy of [
                "https://proxy.example.com:8080",
                "HTTPS://proxy.example.com:8080",
            ]) {
                proxyValue = proxy;
                const client = new HttpClient(logger, {
                    getProxyConfig: () => proxyValue,
                    getProxyStrictSSL: () => false,
                });

                const result = client.setupConfigAndProxyForRequest(
                    new URL("https://api.example.com"),
                    {},
                );

                assert.equal(result.httpsAgent.proxyOptions.rejectUnauthorized, false);
            }
        });

        it("sets up a request without a proxy", () => {
            const requestUrl = new URL("https://api.example.com");
            const headers = { Authorization: "Bearer test-token" };

            const result = httpClient.setupConfigAndProxyForRequest(requestUrl, headers);

            assert.deepEqual(result.headers, headers);
            assert.equal(result.validateStatus(200), true);
            assert.equal(result.proxy, undefined);
            assert.equal(result.httpAgent, undefined);
            assert.equal(result.httpsAgent, undefined);
        });

        for (const proxy of ["https://proxy.example.com:8080", "http://proxy.example.com:8080"]) {
            it(`sets up an HTTPS request through ${new URL(proxy).protocol}`, () => {
                const agent = {};
                proxyValue = proxy;
                mock.method(httpClient, "createProxyAgent", () => ({ agent }));

                const result = httpClient.setupConfigAndProxyForRequest(
                    new URL("https://api.example.com"),
                    {},
                );

                assert.equal(result.proxy, false);
                assert.equal(result.httpsAgent, agent);
                assert.equal(result.httpAgent, undefined);
            });
        }

        it("creates a proxy agent when a proxy is configured", () => {
            proxyValue = "http://proxy.example.com:8080";
            const createProxyAgent = mock.method(httpClient, "createProxyAgent", () => ({
                agent: {},
            }));

            httpClient.setupConfigAndProxyForRequest(new URL("https://api.example.com"), {});

            assert.equal(createProxyAgent.mock.callCount(), 1);
        });
    });
});

function createMockLogger() {
    return {
        debug: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
        piiSanitized: mock.fn(),
    };
}
