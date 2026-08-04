/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as fs from "fs";
import * as http from "http";
import { PassThrough, Writable } from "stream";
import {
    HttpClient,
    HttpDownloadError,
    IProxyAgentFactory,
    IProxyAgentOptions,
    IProxyResolver,
    ProxyConfigurationError,
} from "extension-toolkit/base";
import { ILogger } from "../../src/sharedInterfaces/logger";
import { createStubLogger } from "./utils";

chai.use(sinonChai);

suite("HttpClient tests", () => {
    let sandbox: sinon.SinonSandbox;
    let httpClient: HttpClient;
    let logger: sinon.SinonStubbedInstance<ILogger>;

    setup(() => {
        sandbox = sinon.createSandbox();

        logger = createStubLogger(sandbox);
        httpClient = new HttpClient({
            logger,
            proxyResolver: { resolve: () => undefined },
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("makeGetRequest tests", () => {
        test("should make a successful GET request", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const responseData = { value: [{ id: 1, name: "test" }] };

            const mockResponse = {
                data: responseData,
                status: 200,
                statusText: "OK",
                headers: {},
            };

            const getStub = sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "get")
                .resolves(mockResponse);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpClient as any, "setupConfigAndProxyForRequest").returns({
                headers: { Authorization: `Bearer ${token}` },
                validateStatus: () => true,
            });
            const result = await httpClient.makeGetRequest(requestUrl, token);

            expect(result).to.deep.equal(mockResponse);
            expect(getStub).to.have.been.calledWith(requestUrl, sinon.match.any);
        });
    });

    suite("makePostRequest tests", () => {
        test("should make a successful POST request", async () => {
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

            const postStub = sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "post")
                .resolves(mockResponse);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpClient as any, "setupConfigAndProxyForRequest").returns({
                headers: { Authorization: `Bearer ${token}` },
                validateStatus: () => true,
            });
            const result = await httpClient.makePostRequest(requestUrl, token, payload);

            expect(result).to.deep.equal(mockResponse);
            expect(postStub).to.have.been.calledWith(requestUrl, payload, sinon.match.any);
        });
    });

    suite("downloadFile tests", () => {
        test("should download successfully and invoke callbacks", async () => {
            const requestUrl = "https://download.example.com/file";
            const normalizedUrl = "https://download.example.com:443/file";
            const headers = { "content-length": "5" };

            const responseStream = new PassThrough();
            const receivedChunkLengths: number[] = [];
            let releaseWriteStream: (() => void) | undefined;
            const tmpFileStream = new Writable({
                write(chunk, _encoding, callback) {
                    receivedChunkLengths.push((chunk as Buffer).length);
                    callback();
                },
                final(callback) {
                    releaseWriteStream = callback;
                },
            });

            sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "setupRequest")
                .returns({ requestUrl: normalizedUrl, config: {} });

            sandbox
                .stub(fs, "createWriteStream")
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .returns(tmpFileStream as any);

            const mockResponse = {
                data: responseStream,
                status: 200,
                statusText: "OK",
                headers,
            };
            const getStub = sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "get")
                .resolves(mockResponse);

            const onProgress = sandbox.spy();
            let downloadCompleted = false;

            const downloadPromise = httpClient
                .downloadFile(requestUrl, 123, {
                    onProgress,
                })
                .then((result) => {
                    downloadCompleted = true;
                    return result;
                });

            responseStream.write(Buffer.from([1, 2, 3]));
            responseStream.end(Buffer.from([4, 5]));

            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(downloadCompleted).to.be.false;
            expect(releaseWriteStream).to.not.be.undefined;

            releaseWriteStream?.();

            const result = await downloadPromise;

            expect(result.status).to.equal(200);
            expect(result.headers).to.equal(headers);
            expect(receivedChunkLengths).to.deep.equal([3, 2]);
            expect(onProgress.args.map((args) => args[0])).to.deep.equal([
                { downloadedBytes: 0, totalBytes: 5, percentage: 0 },
                { downloadedBytes: 3, totalBytes: 5, percentage: 60 },
                { downloadedBytes: 5, totalBytes: 5, percentage: 100 },
            ]);
            expect(getStub).to.have.been.calledWith(
                normalizedUrl,
                sinon.match({ responseType: "stream" }),
            );
            expect(fs.createWriteStream).to.have.been.calledWith(
                "",
                sinon.match({ fd: 123, autoClose: false }),
            );
        });

        test("should return error code and destroy stream upon HTTP error", async () => {
            const requestUrl = "https://download.example.com/file";
            const normalizedUrl = "https://download.example.com:443/file";
            const headers = { "content-length": "0" };

            const responseStream = new PassThrough();
            const destroySpy = sandbox.spy(responseStream, "destroy");

            sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "setupRequest")
                .returns({ requestUrl: normalizedUrl, config: {} });

            const mockResponse = {
                data: responseStream,
                status: 404,
                statusText: "Not Found",
                headers,
            };
            sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "get")
                .resolves(mockResponse);

            const onProgress = sandbox.spy();
            const result = await httpClient.downloadFile(requestUrl, 123, { onProgress });

            expect(result.status).to.equal(404);
            expect(result.headers).to.equal(headers);
            expect(onProgress).to.have.been.calledWithExactly({
                downloadedBytes: 0,
                totalBytes: undefined,
                percentage: undefined,
            });
            expect(destroySpy).to.have.been.calledOnce;
        });

        test("should open and close path destinations", async () => {
            const result = { status: 200, headers: {} };
            const openStub = sandbox.stub(fs, "openSync").returns(123);
            const closeStub = sandbox.stub(fs, "closeSync");
            sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "downloadToFileDescriptor")
                .resolves(result);

            expect(
                await httpClient.downloadFile("https://example.com/file", "target.zip"),
            ).to.equal(result);
            expect(openStub).to.have.been.calledWith("target.zip", "w");
            expect(closeStub).to.have.been.calledWith(123);
        });

        test("should wrap request errors in HttpDownloadError", async () => {
            const requestUrl = "https://download.example.com/file";

            sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "setupRequest")
                .returns({ requestUrl, config: {} });

            const requestError = new Error("network error") as NodeJS.ErrnoException;
            requestError.code = "ECONNRESET";
            sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "get")
                .rejects(requestError);

            try {
                await httpClient.downloadFile(requestUrl, 123);
                expect.fail("Expected downloadFile to throw");
            } catch (error) {
                expect(error).to.be.instanceOf(HttpDownloadError);
                expect((error as HttpDownloadError).phase).to.equal("request");
                expect((error as HttpDownloadError).innerError).to.equal(requestError);
            }
        });

        test("should wrap response stream errors in HttpDownloadError", async () => {
            const requestUrl = "https://download.example.com/file";
            const responseStream = new PassThrough();
            const tmpFileStream = new PassThrough();

            sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "setupRequest")
                .returns({ requestUrl, config: {} });
            sandbox
                .stub(fs, "createWriteStream")
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .returns(tmpFileStream as any);

            const mockResponse = {
                data: responseStream,
                status: 200,
                statusText: "OK",
                headers: {},
            };
            sandbox
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .stub(httpClient as any, "get")
                .resolves(mockResponse);

            const responseError = new Error("stream failed") as NodeJS.ErrnoException;
            responseError.code = "EPIPE";

            const downloadPromise = httpClient.downloadFile(requestUrl, 123);
            await new Promise<void>((resolve) => setImmediate(resolve));
            responseStream.emit("error", responseError);

            try {
                await downloadPromise;
                expect.fail("Expected downloadFile to throw");
            } catch (error) {
                expect(error).to.be.instanceOf(HttpDownloadError);
                expect((error as HttpDownloadError).phase).to.equal("response");
                expect((error as HttpDownloadError).innerError).to.equal(responseError);
            }
        });
    });

    suite("Proxy request configuration tests", () => {
        function createRecordingFactory(): {
            factory: IProxyAgentFactory;
            calls: { method: string; options: IProxyAgentOptions }[];
        } {
            const calls: { method: string; options: IProxyAgentOptions }[] = [];
            const record = (method: string) => (options: IProxyAgentOptions) => {
                calls.push({ method, options });
                return new http.Agent();
            };

            return {
                calls,
                factory: {
                    httpOverHttp: sandbox.stub().callsFake(record("httpOverHttp")),
                    httpOverHttps: sandbox.stub().callsFake(record("httpOverHttps")),
                    httpsOverHttp: sandbox.stub().callsFake(record("httpsOverHttp")),
                    httpsOverHttps: sandbox.stub().callsFake(record("httpsOverHttps")),
                },
            };
        }

        test("disables Axios proxy detection and leaves direct URLs unchanged", () => {
            const requestUrl = "https://api.example.com/path?version=2";
            const request = httpClient["setupRequest"](requestUrl, "test-token");

            expect(request.requestUrl).to.equal(requestUrl);
            expect(request.config.proxy).to.be.false;
            expect(request.config.httpsAgent).to.be.undefined;
            expect(request.config.headers).to.deep.include({
                Authorization: "Bearer test-token",
            });
        });

        test("wraps proxy resolver failures without exposing the configured value", () => {
            const secretProxy = "http://user:secret@proxy.example.com:3128";
            const proxyResolver: IProxyResolver = {
                resolve: () => {
                    throw new Error(secretProxy);
                },
            };
            const client = new HttpClient({ logger, proxyResolver });

            expect(() => client["setupConfigAndProxyForRequest"]("https://example.test")).to.throw(
                ProxyConfigurationError,
                "Unable to resolve the configured proxy.",
            );
            expect(logger.error).to.have.been.calledWith("Unable to resolve the configured proxy.");
            expect(
                logger.error.args.flat().join(" "),
                "Proxy credentials must not be logged",
            ).not.to.contain("secret");
        });

        test("resolves the proxy again when a request redirects", () => {
            const resolvedTargets: string[] = [];
            const { factory } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
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
            const config = client["setupConfigAndProxyForRequest"]("http://example.test/start");
            const redirectOptions: {
                href: string;
                agents: Record<string, unknown>;
                agent?: unknown;
            } = {
                href: "https://redirected.example.test/final",
                agents: { http: config.httpAgent, https: config.httpsAgent },
            };

            config.beforeRedirect!(
                redirectOptions as never,
                { headers: {}, statusCode: 302 },
                { headers: {}, url: "http://example.test/start", method: "GET" },
            );

            expect(resolvedTargets).to.deep.equal([
                "http://example.test/start",
                "https://redirected.example.test/final",
            ]);
            expect(redirectOptions.agents.https).to.be.undefined;
            expect(redirectOptions.agent).to.be.undefined;
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
            test(`uses ${testCase.expectedFactory} for ${new URL(testCase.target).protocol} over ${new URL(testCase.proxy).protocol}`, () => {
                const { factory, calls } = createRecordingFactory();
                const proxyResolver: IProxyResolver = {
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

                client["setupConfigAndProxyForRequest"](testCase.target);

                expect(calls.map((call) => call.method)).to.deep.equal([testCase.expectedFactory]);
            });
        }

        test("decodes credentials and applies certificate settings only to HTTPS proxies", () => {
            const { factory, calls } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
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

            client["setupConfigAndProxyForRequest"]("https://example.test/direct");
            client["setupConfigAndProxyForRequest"]("https://example.test/secure");

            expect(calls[0].options.proxy.proxyAuth).to.equal("us@er:p:ss");
            expect(calls[0].options.proxy.rejectUnauthorized).to.be.undefined;
            expect(calls[1].options.proxy.proxyAuth).to.equal("us@er:p:ss");
            expect(calls[1].options.proxy.rejectUnauthorized).to.be.false;
            expect(calls[1].options.proxy.port).to.equal(443);
        });
    });
});
