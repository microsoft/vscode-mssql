/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import axios, { AxiosResponse } from "axios";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { HttpHelper } from "../../src/http/httpHelper";
import { Logger } from "../../src/models/logger";

chai.use(sinonChai);

suite("HttpHelper tests", () => {
    let sandbox: sinon.SinonSandbox;
    let httpHelper: HttpHelper;
    let logger: sinon.SinonStubbedInstance<Logger>;

    setup(() => {
        sandbox = sinon.createSandbox();

        logger = sandbox.createStubInstance(Logger);
        httpHelper = new HttpHelper(logger);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("makeGetRequest tests", () => {
        test("should make a successful GET request", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const responseData = { value: [{ id: 1, name: "test" }] };

            const mockResponse: AxiosResponse = {
                data: responseData,
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as AxiosResponse["config"],
            };

            const axiosGetStub = sandbox.stub(axios, "get").resolves(mockResponse);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "setupConfigAndProxyForRequest").returns({
                headers: { Authorization: `Bearer ${token}` },
                validateStatus: () => true,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "constructRequestUrl").returns(requestUrl);

            const result = await httpHelper.makeGetRequest(requestUrl, token);

            expect(result).to.deep.equal(mockResponse);
            expect(axiosGetStub).to.have.been.calledOnce;
        });

        test("should log GET request response", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const responseData = { value: [{ id: 1 }] };

            const mockResponse: AxiosResponse = {
                data: responseData,
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as AxiosResponse["config"],
            };

            sandbox.stub(axios, "get").resolves(mockResponse);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "setupConfigAndProxyForRequest").returns({});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "constructRequestUrl").returns(requestUrl);

            await httpHelper.makeGetRequest(requestUrl, token);

            expect(logger.piiSanitized).to.have.been.calledWith(
                "GET request ",
                sinon.match.array,
                [],
                requestUrl,
            );
        });
    });

    suite("makePostRequest tests", () => {
        test("should make a successful POST request", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const payload = { name: "new item" };
            const responseData = { id: 2, name: "new item" };

            const mockResponse: AxiosResponse = {
                data: responseData,
                status: 201,
                statusText: "Created",
                headers: {},
                config: {} as AxiosResponse["config"],
            };

            const axiosPostStub = sandbox.stub(axios, "post").resolves(mockResponse);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "setupConfigAndProxyForRequest").returns({
                headers: { Authorization: `Bearer ${token}` },
                validateStatus: () => true,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "constructRequestUrl").returns(requestUrl);

            const result = await httpHelper.makePostRequest(requestUrl, token, payload);

            expect(result).to.deep.equal(mockResponse);
            expect(axiosPostStub).to.have.been.calledWith(requestUrl, payload, sinon.match.any);
        });

        test("should log POST request response", async () => {
            const requestUrl = "https://api.example.com/data";
            const token = "test-token";
            const payload = { name: "test" };
            const responseData = { id: 1 };

            const mockResponse: AxiosResponse = {
                data: responseData,
                status: 201,
                statusText: "Created",
                headers: {},
                config: {} as AxiosResponse["config"],
            };

            sandbox.stub(axios, "post").resolves(mockResponse);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "setupConfigAndProxyForRequest").returns({});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "constructRequestUrl").returns(requestUrl);

            await httpHelper.makePostRequest(requestUrl, token, payload);

            expect(logger.piiSanitized).to.have.been.calledWith(
                "POST request ",
                sinon.match.array,
                [],
                requestUrl,
            );
        });
    });

    suite("Proxy validation tests", () => {
        const envProxy = "env-proxy";
        const configProxy = "config-proxy";

        test("warns when proxy lacks protocol", () => {
            const invalidProxyValue = "localhost:1234";

            httpHelper["loadProxyConfig"] = sandbox.stub().returns(invalidProxyValue);

            sandbox
                .stub(vscode.Uri, "parse")
                .withArgs(invalidProxyValue)
                .returns({ scheme: undefined } as vscode.Uri);

            const warningMessageStub = sandbox
                .stub(vscode.window, "showWarningMessage")
                .resolves(undefined);

            httpHelper.warnOnInvalidProxySettings();

            expect(warningMessageStub).to.have.been.calledOnceWithExactly(
                LocalizedConstants.Proxy.missingProtocolWarning(invalidProxyValue),
            );
        });

        test("warns when proxy parsing throws", () => {
            const invalidProxyValue = "env-proxy.example";

            httpHelper["loadProxyConfig"] = sandbox.stub().returns(invalidProxyValue);

            const uriError = new Error("invalid uri format");
            sandbox.stub(vscode.Uri, "parse").withArgs(invalidProxyValue).throws(uriError);

            const warningMessageStub = sandbox
                .stub(vscode.window, "showWarningMessage")
                .resolves(undefined);

            httpHelper.warnOnInvalidProxySettings();

            expect(warningMessageStub).to.have.been.calledOnceWithExactly(
                LocalizedConstants.Proxy.unparseableWarning(invalidProxyValue, uriError.message),
            );
        });

        test("Does not warn when proxy is valid", () => {
            const validProxyValues = [
                "http://valid-proxy.test:8080",
                "https://valid-proxy.example",
                "socks5://valid-proxy.subdomain.domain.com:1080",
            ];

            const proxyConfigStub = sandbox.stub();
            const warningMessageSpy = sandbox.stub(vscode.window, "showWarningMessage");

            for (const validProxyValue of validProxyValues) {
                proxyConfigStub.reset();
                httpHelper["loadProxyConfig"] = proxyConfigStub.returns(validProxyValue);

                httpHelper.warnOnInvalidProxySettings();

                expect(warningMessageSpy, `Should not warn for valid proxy: ${validProxyValue}`).to
                    .not.have.been.called;
            }
        });

        test("Does not warn when proxy is undefined", () => {
            httpHelper["loadProxyConfig"] = sandbox.stub().returns(undefined);

            const warningMessageSpy = sandbox.stub(vscode.window, "showWarningMessage");

            httpHelper.warnOnInvalidProxySettings();

            expect(warningMessageSpy).to.not.have.been.called;
        });

        test("loadProxyConfig prefers VS Code configuration over environment variables", () => {
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .withArgs("http")
                .returns({ proxy: configProxy } as unknown as vscode.WorkspaceConfiguration);

            sandbox.stub(process, "env").value({
                HTTP_PROXY: envProxy,
                https_proxy: envProxy,
            });

            const proxy = httpHelper["loadProxyConfig"]();

            expect(proxy).to.equal(configProxy);
        });

        test("loadProxyConfig falls back to environment variables when config missing", () => {
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .withArgs("http")
                .returns({ proxy: undefined } as unknown as vscode.WorkspaceConfiguration);

            sandbox.stub(process, "env").value({
                HTTP_PROXY: envProxy,
            });

            const proxy = httpHelper["loadProxyConfig"]();

            expect(proxy).to.equal(envProxy);
        });

        test("setupConfigAndProxyForRequest", () => {
            const fakeToken = "fake-token";
            const fakeProxyUrl = new URL("http://fake-proxy.test:8080");

            const loadProxyConfigStub = sandbox.stub();
            httpHelper["loadProxyConfig"] = loadProxyConfigStub.returns(fakeProxyUrl.toString());

            const result = httpHelper["setupConfigAndProxyForRequest"](
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

            httpHelper["loadProxyConfig"] = sandbox.stub().returns(undefined);

            const result = httpHelper["setupConfigAndProxyForRequest"](requestUrl, token);

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

            httpHelper["loadProxyConfig"] = sandbox.stub().returns(proxy);
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .withArgs("http")
                .returns({ proxyStrictSSL: true } as unknown as vscode.WorkspaceConfiguration);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "createProxyAgent").returns({
                isHttps: true,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                agent: {} as any,
            });

            const result = httpHelper["setupConfigAndProxyForRequest"](requestUrl, token);

            expect(result.proxy).to.be.false;
            expect(result.httpsAgent).to.exist;
            expect(result.httpAgent).to.be.undefined;
        });

        test("should setup config with HTTP proxy for HTTPS request", () => {
            const requestUrl = "https://api.example.com";
            const token = "test-token";
            const proxy = "http://proxy.example.com:8080";

            httpHelper["loadProxyConfig"] = sandbox.stub().returns(proxy);
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .withArgs("http")
                .returns({ proxyStrictSSL: false } as unknown as vscode.WorkspaceConfiguration);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "createProxyAgent").returns({
                isHttps: false,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                agent: {} as any,
            });

            const result = httpHelper["setupConfigAndProxyForRequest"](requestUrl, token);

            expect(result.proxy).to.be.false;
            expect(result.httpAgent).to.exist;
            expect(result.httpsAgent).to.be.undefined;
        });

        test("should log when proxy is found", () => {
            const requestUrl = "https://api.example.com";
            const token = "test-token";
            const proxy = "http://proxy.example.com:8080";

            httpHelper["loadProxyConfig"] = sandbox.stub().returns(proxy);
            sandbox
                .stub(vscode.workspace, "getConfiguration")
                .withArgs("http")
                .returns({ proxyStrictSSL: false } as unknown as vscode.WorkspaceConfiguration);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(httpHelper as any, "createProxyAgent").returns({
                isHttps: false,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                agent: {} as any,
            });

            httpHelper["setupConfigAndProxyForRequest"](requestUrl, token);

            expect(logger.verbose).to.have.been.calledWith(
                "Proxy endpoint found in environment variables or workspace configuration.",
            );
        });
    });
});
