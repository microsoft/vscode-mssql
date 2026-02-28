/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as http from "http";
import * as tunnel from "tunnel";
import axios from "axios";
import * as os from "os";
import * as path from "path";
import { HttpClient } from "../src/common/httpClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeAgent(): http.Agent {
    return { fake: true } as unknown as http.Agent;
}

/** Stubs axios.get to capture the AxiosRequestConfig and throw immediately. */
function stubAxiosGetCapture(sandbox: sinon.SinonSandbox): {
    capturedConfig: { value: Parameters<typeof axios.get>[1] };
} {
    const capturedConfig: { value: Parameters<typeof axios.get>[1] } = { value: undefined };
    sandbox.stub(axios, "get").callsFake(async (_url, cfg) => {
        capturedConfig.value = cfg;
        throw new Error("axios stubbed");
    });
    return { capturedConfig };
}

/** Stubs vscode http config to return the given proxy string (proxyStrictSSL defaults to true). */
function stubVscodeProxy(sandbox: sinon.SinonSandbox, proxy: string | undefined): void {
    stubVscodeProxyWithOptions(sandbox, proxy, true);
}

/** Stubs vscode http config with full control over proxy and proxyStrictSSL. */
function stubVscodeProxyWithOptions(
    sandbox: sinon.SinonSandbox,
    proxy: string | undefined,
    proxyStrictSSL: boolean,
): void {
    sandbox
        .stub(vscode.workspace, "getConfiguration")
        .callsFake((section?: string): vscode.WorkspaceConfiguration => {
            const map: Record<string, unknown> =
                section === "http" ? { proxy, proxyStrictSSL } : {};
            return {
                get: (key: string) => map[key],
                has: () => false,
                inspect: () => undefined,
                update: async () => {},
            } as unknown as vscode.WorkspaceConfiguration;
        });
}

// ---------------------------------------------------------------------------
// Suite: HttpClient – proxy agent selection
// ---------------------------------------------------------------------------

suite("HttpClient: proxy agent selection", function (): void {
    let sandbox: sinon.SinonSandbox;

    setup(function () {
        sandbox = sinon.createSandbox();
        delete process.env["HTTP_PROXY"];
        delete process.env["http_proxy"];
        delete process.env["HTTPS_PROXY"];
        delete process.env["https_proxy"];
    });

    teardown(function () {
        sandbox.restore();
        delete process.env["HTTP_PROXY"];
        delete process.env["http_proxy"];
        delete process.env["HTTPS_PROXY"];
        delete process.env["https_proxy"];
    });

    // -----------------------------------------------------------------------
    // No proxy – no agent attached
    // -----------------------------------------------------------------------

    test("No proxy: axios config has no agent or proxy override", async function (): Promise<void> {
        stubVscodeProxy(sandbox, undefined);
        const { capturedConfig } = stubAxiosGetCapture(sandbox);

        await new HttpClient()
            .download("https://example.com/file.zip", path.join(os.tmpdir(), "file.zip"))
            .catch(() => {});

        const cfg = capturedConfig.value as Record<string, unknown>;
        expect(cfg["proxy"]).to.be.undefined;
        expect(cfg["httpsAgent"]).to.be.undefined;
        expect(cfg["httpAgent"]).to.be.undefined;
    });

    // -----------------------------------------------------------------------
    // Tunnel variant selection (parameterised)
    // -----------------------------------------------------------------------

    const tunnelCases: {
        desc: string;
        proxyUrl: string;
        downloadUrl: string;
        tunnelFn: keyof typeof tunnel;
        agentProp: "httpsAgent" | "httpAgent";
    }[] = [
        {
            desc: "http proxy + https URL",
            proxyUrl: "http://proxy.example.com:8080",
            downloadUrl: "https://nuget.org/pkg",
            tunnelFn: "httpsOverHttp",
            agentProp: "httpsAgent",
        },
        {
            desc: "http proxy + http URL",
            proxyUrl: "http://proxy.example.com:8080",
            downloadUrl: "http://nuget.org/pkg",
            tunnelFn: "httpOverHttp",
            agentProp: "httpAgent",
        },
        {
            desc: "https proxy + https URL",
            proxyUrl: "https://proxy.example.com:8443",
            downloadUrl: "https://nuget.org/pkg",
            tunnelFn: "httpsOverHttps",
            agentProp: "httpsAgent",
        },
        {
            desc: "https proxy + http URL",
            proxyUrl: "https://proxy.example.com:8443",
            downloadUrl: "http://nuget.org/pkg",
            tunnelFn: "httpOverHttps",
            agentProp: "httpAgent",
        },
    ];

    for (const { desc, proxyUrl, downloadUrl, tunnelFn, agentProp } of tunnelCases) {
        test(`Selects correct tunnel variant: ${desc}`, async function (): Promise<void> {
            stubVscodeProxy(sandbox, proxyUrl);
            const fakeAgent = makeFakeAgent();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tunnelStub = sandbox.stub(tunnel, tunnelFn).returns(fakeAgent as any);
            const { capturedConfig } = stubAxiosGetCapture(sandbox);

            await new HttpClient()
                .download(downloadUrl, path.join(os.tmpdir(), "pkg"))
                .catch(() => {});

            expect(tunnelStub.calledOnce, `${tunnelFn} should be called once`).to.be.true;
            const cfg = capturedConfig.value as Record<string, unknown>;
            expect(cfg["proxy"]).to.equal(false, "Axios built-in proxy should be disabled");
            expect(cfg[agentProp]).to.equal(fakeAgent, `${agentProp} should be the tunnel agent`);
        });
    }

    // -----------------------------------------------------------------------
    // Tunnel options: host/port and credentials
    // -----------------------------------------------------------------------

    test("Tunnel receives correct host and port from proxy URL", async function (): Promise<void> {
        stubVscodeProxy(sandbox, "http://proxy.example.com:3128");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tunnelStub = sandbox.stub(tunnel, "httpsOverHttp").returns(makeFakeAgent() as any);
        stubAxiosGetCapture(sandbox);

        await new HttpClient()
            .download("https://nuget.org/pkg", path.join(os.tmpdir(), "pkg"))
            .catch(() => {});

        const opts = tunnelStub.firstCall.args[0] as tunnel.HttpsOverHttpOptions;
        expect(opts.proxy?.host).to.equal("proxy.example.com");
        expect(opts.proxy?.port).to.equal(3128);
    });

    test("Tunnel receives proxyAuth when proxy URL contains credentials", async function (): Promise<void> {
        stubVscodeProxy(sandbox, "http://user:secret@proxy.example.com:8080");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tunnelStub = sandbox.stub(tunnel, "httpsOverHttp").returns(makeFakeAgent() as any);
        stubAxiosGetCapture(sandbox);

        await new HttpClient()
            .download("https://nuget.org/pkg", path.join(os.tmpdir(), "pkg"))
            .catch(() => {});

        const opts = tunnelStub.firstCall.args[0] as tunnel.HttpsOverHttpOptions;
        expect(opts.proxy?.proxyAuth).to.equal("user:secret");
    });

    // -----------------------------------------------------------------------
    // Proxy source priority: VS Code > HTTP_PROXY > http_proxy > HTTPS_PROXY
    // -----------------------------------------------------------------------

    test("Proxy source priority: VS Code setting wins over env vars", async function (): Promise<void> {
        stubVscodeProxy(sandbox, "http://vscode-proxy.example.com:1111");
        process.env["HTTP_PROXY"] = "http://http-proxy.example.com:2222";
        process.env["HTTPS_PROXY"] = "http://https-proxy.example.com:3333";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tunnelStub = sandbox.stub(tunnel, "httpsOverHttp").returns(makeFakeAgent() as any);
        stubAxiosGetCapture(sandbox);

        await new HttpClient()
            .download("https://nuget.org/pkg", path.join(os.tmpdir(), "pkg"))
            .catch(() => {});

        const opts = tunnelStub.firstCall.args[0] as tunnel.HttpsOverHttpOptions;
        expect(opts.proxy?.host).to.equal("vscode-proxy.example.com");
    });

    test("Proxy source priority: HTTP_PROXY wins over HTTPS_PROXY", async function (): Promise<void> {
        stubVscodeProxy(sandbox, undefined);
        // Note: on Windows env vars are case-insensitive so we only test distinct names.
        process.env["HTTP_PROXY"] = "http://http-proxy.example.com:2222";
        process.env["HTTPS_PROXY"] = "http://https-proxy.example.com:4444";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tunnelStub = sandbox.stub(tunnel, "httpsOverHttp").returns(makeFakeAgent() as any);
        stubAxiosGetCapture(sandbox);

        await new HttpClient()
            .download("https://nuget.org/pkg", path.join(os.tmpdir(), "pkg"))
            .catch(() => {});

        const opts = tunnelStub.firstCall.args[0] as tunnel.HttpsOverHttpOptions;
        expect(opts.proxy?.host).to.equal("http-proxy.example.com");
    });

    test("Proxy source priority: HTTPS_PROXY used when no other proxy source is set", async function (): Promise<void> {
        stubVscodeProxy(sandbox, undefined);
        process.env["HTTPS_PROXY"] = "http://https-proxy.example.com:4444";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tunnelStub = sandbox.stub(tunnel, "httpsOverHttp").returns(makeFakeAgent() as any);
        stubAxiosGetCapture(sandbox);

        await new HttpClient()
            .download("https://nuget.org/pkg", path.join(os.tmpdir(), "pkg"))
            .catch(() => {});

        const opts = tunnelStub.firstCall.args[0] as tunnel.HttpsOverHttpOptions;
        expect(opts.proxy?.host).to.equal("https-proxy.example.com");
    });

    // -----------------------------------------------------------------------
    // Port defaulting and rejectUnauthorized wiring
    // -----------------------------------------------------------------------

    for (const { proxyUrl, tunnelFn, expectedPort } of [
        {
            proxyUrl: "http://proxy.example.com",
            tunnelFn: "httpsOverHttp" as const,
            expectedPort: 80,
        },
        {
            proxyUrl: "https://proxy.example.com",
            tunnelFn: "httpsOverHttps" as const,
            expectedPort: 443,
        },
    ]) {
        test(`Port defaults to ${expectedPort} when ${proxyUrl.split(":")[0]} proxy URL omits an explicit port`, async function (): Promise<void> {
            stubVscodeProxy(sandbox, proxyUrl);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tunnelStub = sandbox.stub(tunnel, tunnelFn).returns(makeFakeAgent() as any);
            stubAxiosGetCapture(sandbox);

            await new HttpClient()
                .download("https://nuget.org/pkg", path.join(os.tmpdir(), "pkg"))
                .catch(() => {});

            const opts = tunnelStub.firstCall.args[0] as tunnel.HttpsOverHttpOptions;
            expect(opts.proxy?.port).to.equal(expectedPort);
        });
    }

    for (const { strictSSL, expected } of [
        { strictSSL: false, expected: false },
        { strictSSL: true, expected: true },
    ]) {
        test(`rejectUnauthorized is ${expected} in tunnel options when proxyStrictSSL is ${strictSSL}`, async function (): Promise<void> {
            stubVscodeProxyWithOptions(sandbox, "http://proxy.example.com:3128", strictSSL);

            const tunnelStub = sandbox
                .stub(tunnel, "httpsOverHttp")
                .returns(makeFakeAgent() as any);
            stubAxiosGetCapture(sandbox);

            await new HttpClient()
                .download("https://nuget.org/pkg", path.join(os.tmpdir(), "pkg"))
                .catch(() => {});

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const opts = tunnelStub.firstCall.args[0] as any;
            expect(opts.proxy?.rejectUnauthorized).to.equal(expected);
        });
    }
});
