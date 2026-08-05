/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as fs from "fs";
import { PassThrough, Writable } from "stream";
import { HttpClient, HttpDownloadError, IHttpClientMessages } from "extension-toolkit/base";
import { ILogger } from "../../src/sharedInterfaces/logger";
import { createStubLogger } from "./utils";

chai.use(sinonChai);

const proxyMessages: IHttpClientMessages = {
    missingProtocolWarning: (proxy) => `Invalid proxy protocol: ${proxy}`,
    unparseableWarning: (proxy, errorMessage) => `Invalid proxy: ${proxy}. ${errorMessage}`,
    unableToGetProxyAgentOptions: "Unable to read proxy agent options.",
};

suite("HttpClient tests", () => {
    let sandbox: sinon.SinonSandbox;
    let httpClient: HttpClient;
    let logger: sinon.SinonStubbedInstance<ILogger>;
    let getProxyConfig: sinon.SinonStub;
    let parseUriScheme: sinon.SinonStub;
    let showWarningMessage: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        logger = createStubLogger(sandbox);
        getProxyConfig = sandbox.stub().returns(undefined);
        parseUriScheme = sandbox.stub().callsFake((value: string) => new URL(value).protocol);
        showWarningMessage = sandbox.stub();
        httpClient = new HttpClient(logger, {
            getProxyConfig,
            parseUriScheme,
            showWarningMessage,
            messages: proxyMessages,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpClient as any, "constructRequestUrl").returns(requestUrl);

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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpClient as any, "constructRequestUrl").returns(requestUrl);

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

    suite("Proxy validation tests", () => {
        const envProxy = "env-proxy";
        const configProxy = "config-proxy";

        test("warns when proxy lacks protocol", () => {
            const invalidProxyValue = "localhost:1234";

            httpClient["loadProxyConfig"] = sandbox.stub().returns(invalidProxyValue);

            parseUriScheme.withArgs(invalidProxyValue).returns(undefined);

            httpClient.warnOnInvalidProxySettings();

            expect(showWarningMessage).to.have.been.calledWithExactly(
                proxyMessages.missingProtocolWarning(invalidProxyValue),
            );
        });

        test("warns when proxy parsing throws", () => {
            const invalidProxyValue = "env-proxy.example";

            httpClient["loadProxyConfig"] = sandbox.stub().returns(invalidProxyValue);

            const uriError = new Error("invalid uri format");
            parseUriScheme.withArgs(invalidProxyValue).throws(uriError);

            httpClient.warnOnInvalidProxySettings();

            expect(showWarningMessage).to.have.been.calledWithExactly(
                proxyMessages.unparseableWarning(invalidProxyValue, uriError.message),
            );
        });

        test("Does not warn when proxy is valid", () => {
            const validProxyValues = [
                "http://valid-proxy.test:8080",
                "https://valid-proxy.example",
                "socks5://valid-proxy.subdomain.domain.com:1080",
            ];

            const proxyConfigStub = sandbox.stub();
            for (const validProxyValue of validProxyValues) {
                proxyConfigStub.reset();
                httpClient["loadProxyConfig"] = proxyConfigStub.returns(validProxyValue);

                httpClient.warnOnInvalidProxySettings();

                expect(showWarningMessage, `Should not warn for valid proxy: ${validProxyValue}`).to
                    .not.have.been.called;
            }
        });

        test("Does not warn when proxy is undefined", () => {
            httpClient["loadProxyConfig"] = sandbox.stub().returns(undefined);

            httpClient.warnOnInvalidProxySettings();

            expect(showWarningMessage).to.not.have.been.called;
        });

        test("loadProxyConfig prefers VS Code configuration over environment variables", () => {
            getProxyConfig.returns(configProxy);

            sandbox.stub(process, "env").value({
                HTTP_PROXY: envProxy,
                https_proxy: envProxy,
            });

            const proxy = httpClient["loadProxyConfig"]();

            expect(proxy).to.equal(configProxy);
        });

        test("loadProxyConfig falls back to environment variables when config missing", () => {
            sandbox.stub(process, "env").value({
                HTTP_PROXY: envProxy,
            });

            const proxy = httpClient["loadProxyConfig"]();

            expect(proxy).to.equal(envProxy);
        });

        test("setupConfigAndProxyForRequest", () => {
            const fakeToken = "fake-token";
            const fakeProxyUrl = new URL("http://fake-proxy.test:8080");

            const loadProxyConfigStub = sandbox.stub();
            httpClient["loadProxyConfig"] = loadProxyConfigStub.returns(fakeProxyUrl.toString());

            const result = httpClient["setupConfigAndProxyForRequest"](
                "http://fakeUrl.ms/",
                fakeToken,
            );

            expect(result.headers.Authorization).to.contain(fakeToken);
            expect(result.proxy, "Automatic proxy detection should be disabled").to.be.false;
            expect(result.httpAgent.proxyOptions).to.deep.equal({
                host: fakeProxyUrl.hostname,
                port: parseInt(fakeProxyUrl.port),
            });
            expect(result.httpsAgent).to.be.undefined;
        });
    });

    suite("setupConfigAndProxyForRequest tests", () => {
        test("should setup config without proxy", () => {
            const requestUrl = "https://api.example.com";
            const token = "test-token";

            httpClient["loadProxyConfig"] = sandbox.stub().returns(undefined);

            const result = httpClient["setupConfigAndProxyForRequest"](requestUrl, token);

            expect(result.headers).to.deep.equal({
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            });
            expect(result.validateStatus!(200)).to.be.true;
            expect(result.proxy).to.be.undefined;
            expect(result.httpAgent).to.be.undefined;
            expect(result.httpsAgent).to.be.undefined;
        });

        test("should setup config with HTTPS proxy for HTTPS request", () => {
            const requestUrl = "https://api.example.com";
            const token = "test-token";
            const proxy = "https://proxy.example.com:8080";

            httpClient["loadProxyConfig"] = sandbox.stub().returns(proxy);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpClient as any, "createProxyAgent").returns({
                isHttps: true,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                agent: {} as any,
            });

            const result = httpClient["setupConfigAndProxyForRequest"](requestUrl, token);

            expect(result.proxy).to.be.false;
            expect(result.httpsAgent).to.exist;
            expect(result.httpAgent).to.be.undefined;
        });

        test("should setup config with HTTP proxy for HTTPS request", () => {
            const requestUrl = "https://api.example.com";
            const token = "test-token";
            const proxy = "http://proxy.example.com:8080";

            httpClient["loadProxyConfig"] = sandbox.stub().returns(proxy);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpClient as any, "createProxyAgent").returns({
                isHttps: false,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                agent: {} as any,
            });

            const result = httpClient["setupConfigAndProxyForRequest"](requestUrl, token);

            expect(result.proxy).to.be.false;
            expect(result.httpsAgent).to.exist;
            expect(result.httpAgent).to.be.undefined;
        });

        test("should create proxy agent when proxy is found", () => {
            const requestUrl = "https://api.example.com";
            const token = "test-token";
            const proxy = "http://proxy.example.com:8080";

            httpClient["loadProxyConfig"] = sandbox.stub().returns(proxy);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpClient as any, "createProxyAgent").returns({
                isHttps: false,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                agent: {} as any,
            });

            httpClient["setupConfigAndProxyForRequest"](requestUrl, token);

            expect((httpClient as any).createProxyAgent).to.have.been.called;
        });
    });
});
