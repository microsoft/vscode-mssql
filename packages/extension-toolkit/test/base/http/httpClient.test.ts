/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from "http";
import axios, { AxiosHeaders, AxiosResponse } from "axios";
import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { HttpClient } from "../../../src/base/http/httpClient";
import { HttpClientError } from "../../../src/base/http/httpErrors";
import { IHttpClientLogger } from "../../../src/base/http/httpTypes";
import {
    IProxyAgentFactory,
    IProxyAgentOptions,
    IProxyResolver,
} from "../../../src/base/http/proxy";
import { ITestServer, readRequestBody, startTestServer } from "./testServer";

chai.use(sinonChai);

const noProxy: IProxyResolver = { resolve: () => undefined };

function createClient(overrides: {
    logger?: IHttpClientLogger;
    proxyResolver?: IProxyResolver;
    proxyAgentFactory?: IProxyAgentFactory;
}): HttpClient {
    return new HttpClient({ proxyResolver: noProxy, ...overrides });
}

async function captureHttpClientError(action: () => Promise<unknown>): Promise<HttpClientError> {
    try {
        await action();
        expect.fail("Expected the HTTP operation to reject.");
    } catch (error) {
        expect(error).to.be.instanceOf(HttpClientError);
        return error as HttpClientError;
    }
}

function createAxiosResponse<T>(data: T): AxiosResponse<T> {
    return {
        data,
        status: 200,
        statusText: "OK",
        headers: {},
        config: { headers: new AxiosHeaders() },
    };
}

describe("HttpClient", () => {
    let server: ITestServer | undefined;
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(async () => {
        sandbox.restore();
        await server?.close();
        server = undefined;
    });

    describe("responses", () => {
        it("returns the parsed body and status for a successful response", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-type": "application/json" });
                response.end(JSON.stringify({ value: "ok" }));
            });

            const result = await createClient({}).get<{ value: string }>(server.origin);

            expect(result.status).to.equal(200);
            expect(result.ok).to.be.true;
            expect(result.data).to.deep.equal({ value: "ok" });
        });

        it("resolves rather than throwing for a non-success status", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(404, { "content-type": "application/json" });
                response.end(JSON.stringify({ error: "missing" }));
            });

            const result = await createClient({}).get(server.origin);

            expect(result.status).to.equal(404);
            expect(result.ok).to.be.false;
        });

        it("treats 204 as a success", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(204);
                response.end();
            });

            expect((await createClient({}).get(server.origin)).ok).to.be.true;
        });

        it("treats 300 as a non-success", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(300);
                response.end();
            });

            expect((await createClient({}).get(server.origin)).ok).to.be.false;
        });

        it("exposes response headers case-insensitively", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "X-Trace-Id": "abc123" });
                response.end();
            });

            const result = await createClient({}).get(server.origin);

            expect(result.headers.get("x-trace-id")).to.equal("abc123");
            expect(result.headers.get("X-TRACE-ID")).to.equal("abc123");
        });

        it("preserves every value of a repeated response header", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "Set-Cookie": ["a=1", "b=2"] });
                response.end();
            });

            const result = await createClient({}).get(server.origin);

            expect(result.headers.getAll("set-cookie")).to.deep.equal(["a=1", "b=2"]);
        });

        it("constructs a toolkit response rather than returning the Axios object", async () => {
            const axiosResponse = {
                ...createAxiosResponse({ value: "ok" }),
                request: { transport: "axios" },
            };
            sandbox.stub(axios, "request").resolves(axiosResponse);

            const result = await createClient({}).get<{ value: string }>(
                "http://example.test/resource",
            );

            expect(result).to.deep.equal({
                data: { value: "ok" },
                status: 200,
                statusText: "OK",
                ok: true,
                headers: result.headers,
            });
            expect(result).not.to.have.property("config");
            expect(result).not.to.have.property("request");
        });
    });

    describe("requests", () => {
        it("sends caller-supplied request headers", async () => {
            let received: http.IncomingHttpHeaders | undefined;
            server = await startTestServer((request, response) => {
                received = request.headers;
                response.writeHead(200);
                response.end();
            });

            await createClient({}).get(server.origin, {
                headers: { Authorization: "Bearer token" },
            });

            expect(received?.authorization).to.equal("Bearer token");
            expect(received?.["content-type"]).to.be.undefined;
        });

        it("sends the direct request URL to Axios unchanged", async () => {
            const request = sandbox.stub(axios, "request").resolves(createAxiosResponse({}));
            const url = "http://example.test/resource?api-version=1";

            await createClient({}).get(url);

            expect(request).to.have.been.calledOnceWith(
                sinon.match({
                    method: "GET",
                    url,
                }),
            );
        });

        it("sends a JSON body with JSON content negotiation headers", async () => {
            let received: { headers: http.IncomingHttpHeaders; body: string } | undefined;
            server = await startTestServer(async (request, response) => {
                received = { headers: request.headers, body: await readRequestBody(request) };
                response.writeHead(200);
                response.end();
            });

            await createClient({}).postJson(server.origin, { name: "value" });

            expect(received!.headers["content-type"]).to.match(/^application\/json/);
            expect(received!.headers.accept).to.equal("application/json");
            expect(received!.body).to.equal(JSON.stringify({ name: "value" }));
        });

        it("does not override a caller-supplied content type", async () => {
            let received: http.IncomingHttpHeaders | undefined;
            server = await startTestServer(async (request, response) => {
                received = request.headers;
                await readRequestBody(request);
                response.writeHead(200);
                response.end();
            });

            await createClient({}).postJson(
                server.origin,
                { name: "value" },
                { headers: { "content-type": "application/merge-patch+json" } },
            );

            expect(received?.["content-type"]).to.equal("application/merge-patch+json");
        });
    });

    describe("diagnostics", () => {
        it("logs only the target origin, excluding the path and query", async () => {
            server = await startTestServer((_request, response) => response.end());
            const logger = {
                debug: sandbox.stub(),
                warn: sandbox.stub(),
                error: sandbox.stub(),
            };

            await createClient({ logger }).get(
                `${server.origin}/opaque/customer-123?access_token=secret`,
            );

            const diagnostics = logger.debug.args.flat().join(" ");
            expect(diagnostics).to.contain(server.origin);
            expect(diagnostics).not.to.contain("opaque");
            expect(diagnostics).not.to.contain("customer-123");
            expect(diagnostics).not.to.contain("access_token");
            expect(diagnostics).not.to.contain("secret");
        });
    });

    describe("error handling", () => {
        it("reports an invalid URL as a network failure", async () => {
            const error = await captureHttpClientError(() => createClient({}).get("not-a-url"));

            expect(error.kind).to.equal("network");
            expect(error.code).to.equal("ERR_INVALID_URL");
            expect(error.cause).to.be.instanceOf(Error);
        });

        it("reports a refused connection as a network failure", async () => {
            const closed = await startTestServer((_request, response) => response.end());
            const origin = closed.origin;
            await closed.close();

            const error = await captureHttpClientError(() => createClient({}).get(origin));

            expect(error.kind).to.equal("network");
            expect(error.code).to.equal("ECONNREFUSED");
            expect(error.cause).to.be.instanceOf(Error);
        });

        it("reports an elapsed timeout", async () => {
            server = await startTestServer(() => {
                // Intentionally never responds so the client timeout elapses.
            });

            const error = await captureHttpClientError(() =>
                createClient({}).get(server!.origin, { timeoutMs: 50 }),
            );

            expect(error.kind).to.equal("timeout");
        });

        it("reports cancellation through an abort signal", async () => {
            server = await startTestServer(() => {
                // Intentionally never responds so the request is cancelled while in flight.
            });

            const controller = new AbortController();
            const pending = createClient({}).get(server.origin, { signal: controller.signal });
            setTimeout(() => controller.abort(), 25);

            const error = await captureHttpClientError(() => pending);

            expect(error.kind).to.equal("cancelled");
        });

        it("reports an unusable proxy configuration", async () => {
            server = await startTestServer((_request, response) => response.end());

            const failingResolver: IProxyResolver = {
                resolve: () => {
                    throw new Error("bad proxy");
                },
            };

            const error = await captureHttpClientError(() =>
                createClient({ proxyResolver: failingResolver }).get(server!.origin),
            );

            expect(error.kind).to.equal("proxy-configuration");
            expect(error.cause).to.be.instanceOf(Error);
        });

        it("does not log credentials from a failing proxy resolver", async () => {
            const logger = {
                debug: sandbox.stub(),
                warn: sandbox.stub(),
                error: sandbox.stub(),
            };
            const failingResolver: IProxyResolver = {
                resolve: () => {
                    throw new Error("https://user:secret@proxy.example.com");
                },
            };

            await captureHttpClientError(() =>
                createClient({ logger, proxyResolver: failingResolver }).get(
                    "https://example.test",
                ),
            );

            expect(logger.error).to.have.been.calledOnce;
            expect(logger.error.firstCall.args.join(" ")).not.to.contain("user");
            expect(logger.error.firstCall.args.join(" ")).not.to.contain("secret");
        });

        it("preserves proxy configuration failures raised while redirecting", async () => {
            server = await startTestServer((request, response) => {
                if (request.url === "/start") {
                    response.writeHead(302, { Location: "/final" });
                    response.end();
                    return;
                }

                response.end();
            });
            const proxyResolver: IProxyResolver = {
                resolve: (target) => {
                    if (target.pathname === "/final") {
                        throw new Error("bad redirected proxy");
                    }

                    return undefined;
                },
            };

            const error = await captureHttpClientError(() =>
                createClient({ proxyResolver }).get(`${server!.origin}/start`),
            );

            expect(error.kind).to.equal("proxy-configuration");
            expect(error.cause).to.be.instanceOf(Error);
        });
    });

    describe("proxy agents", () => {
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

        it("does not create an agent when no proxy is resolved", async () => {
            server = await startTestServer((_request, response) => response.end());
            const { factory, calls } = createRecordingFactory();

            await createClient({ proxyAgentFactory: factory }).get(server.origin);

            expect(calls).to.be.empty;
        });

        it("resolves the proxy again for each redirected target", async () => {
            const resolvedTargets: string[] = [];
            server = await startTestServer((request, response) => {
                if (request.url === "/start") {
                    response.writeHead(302, { Location: "/final?version=2" });
                    response.end();
                    return;
                }

                response.end("redirected");
            });
            const proxyResolver: IProxyResolver = {
                resolve: (target) => {
                    resolvedTargets.push(target.toString());
                    return undefined;
                },
            };

            const result = await createClient({ proxyResolver }).get(`${server.origin}/start`);

            expect(result.data).to.equal("redirected");
            expect(resolvedTargets).to.deep.equal([
                `${server.origin}/start`,
                `${server.origin}/final?version=2`,
            ]);
        });

        it("replaces the per-protocol proxy agent when a redirect changes protocol", async () => {
            const { factory, calls } = createRecordingFactory();
            const resolvedTargets: string[] = [];
            const proxyResolver: IProxyResolver = {
                resolve: (target) => {
                    resolvedTargets.push(target.toString());
                    return {
                        url: new URL("http://proxy.example.com:3128"),
                        rejectUnauthorized: true,
                        source: "environment",
                    };
                },
            };
            sandbox.stub(axios, "request").callsFake(async (config) => {
                const redirectOptions: {
                    href: string;
                    agents: Record<string, unknown>;
                    agent?: unknown;
                } = {
                    href: "https://redirected.example.test/final",
                    agents: { http: config.httpAgent, https: config.httpsAgent },
                };
                config.beforeRedirect!(
                    redirectOptions,
                    { headers: {}, statusCode: 302 },
                    { headers: {}, url: config.url!, method: "GET" },
                );

                expect(redirectOptions.agents.https).to.equal(redirectOptions.agent);
                return createAxiosResponse({});
            });

            await createClient({ proxyResolver, proxyAgentFactory: factory }).get(
                "http://example.test/start",
            );

            expect(resolvedTargets).to.deep.equal([
                "http://example.test/start",
                "https://redirected.example.test/final",
            ]);
            expect(calls.map((call) => call.method)).to.deep.equal([
                "httpOverHttp",
                "httpsOverHttp",
            ]);
        });

        it("clears the old proxy agent when a redirected target resolves direct", async () => {
            const { factory } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
                resolve: (target) =>
                    target.pathname === "/start"
                        ? {
                              url: new URL("http://proxy.example.com:3128"),
                              rejectUnauthorized: true,
                              source: "environment",
                          }
                        : undefined,
            };
            sandbox.stub(axios, "request").callsFake(async (config) => {
                const redirectOptions: {
                    href: string;
                    agents: Record<string, unknown>;
                    agent?: unknown;
                } = {
                    href: "http://direct.example.test/final",
                    agents: { http: config.httpAgent, https: config.httpsAgent },
                };
                config.beforeRedirect!(
                    redirectOptions,
                    { headers: {}, statusCode: 302 },
                    { headers: {}, url: config.url!, method: "GET" },
                );

                expect(redirectOptions.agents.http).to.be.undefined;
                expect(redirectOptions.agent).to.be.undefined;
                return createAxiosResponse({});
            });

            await createClient({ proxyResolver, proxyAgentFactory: factory }).get(
                "http://example.test/start",
            );
        });

        it("uses an http-over-http agent for an http target behind an http proxy", async () => {
            server = await startTestServer((_request, response) => response.end());
            const { factory, calls } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
                resolve: () => ({
                    url: new URL("http://proxy.example.com:3128"),
                    rejectUnauthorized: true,
                    source: "environment",
                }),
            };

            await createClient({ proxyResolver, proxyAgentFactory: factory }).get(server.origin);

            expect(calls).to.have.length(1);
            expect(calls[0].method).to.equal("httpOverHttp");
            expect(calls[0].options.proxy.host).to.equal("proxy.example.com");
            expect(calls[0].options.proxy.port).to.equal(3128);
        });

        for (const testCase of [
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
            it(`uses ${testCase.expectedFactory} for ${new URL(testCase.target).protocol} over ${new URL(testCase.proxy).protocol}`, async () => {
                sandbox.stub(axios, "request").resolves(createAxiosResponse({}));
                const { factory, calls } = createRecordingFactory();
                const proxyResolver: IProxyResolver = {
                    resolve: () => ({
                        url: new URL(testCase.proxy),
                        rejectUnauthorized: true,
                        source: "environment",
                    }),
                };

                await createClient({ proxyResolver, proxyAgentFactory: factory }).get(
                    testCase.target,
                );

                expect(calls).to.have.length(1);
                expect(calls[0].method).to.equal(testCase.expectedFactory);
            });
        }

        it("omits certificate options for an http proxy", async () => {
            server = await startTestServer((_request, response) => response.end());
            const { factory, calls } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
                resolve: () => ({
                    url: new URL("http://proxy.example.com:3128"),
                    rejectUnauthorized: false,
                    source: "vscode",
                }),
            };

            await createClient({ proxyResolver, proxyAgentFactory: factory }).get(server.origin);

            expect(calls[0].options.proxy.rejectUnauthorized).to.be.undefined;
        });

        it("forwards certificate validation options for an https proxy", async () => {
            server = await startTestServer((_request, response) => response.end());
            const { factory, calls } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
                resolve: () => ({
                    url: new URL("https://proxy.example.com"),
                    rejectUnauthorized: false,
                    source: "vscode",
                }),
            };

            await createClient({ proxyResolver, proxyAgentFactory: factory }).get(server.origin);

            expect(calls[0].method).to.equal("httpOverHttps");
            expect(calls[0].options.proxy.port).to.equal(443);
            expect(calls[0].options.proxy.rejectUnauthorized).to.be.false;
        });

        it("forwards enabled certificate validation for an https proxy", async () => {
            sandbox.stub(axios, "request").resolves(createAxiosResponse({}));
            const { factory, calls } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
                resolve: () => ({
                    url: new URL("https://proxy.example.com"),
                    rejectUnauthorized: true,
                    source: "vscode",
                }),
            };

            await createClient({ proxyResolver, proxyAgentFactory: factory }).get(
                "https://example.test",
            );

            expect(calls[0].method).to.equal("httpsOverHttps");
            expect(calls[0].options.proxy.rejectUnauthorized).to.be.true;
        });

        it("forwards proxy credentials", async () => {
            server = await startTestServer((_request, response) => response.end());
            const { factory, calls } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
                resolve: () => ({
                    url: new URL("http://user:secret@proxy.example.com:3128"),
                    rejectUnauthorized: true,
                    source: "environment",
                }),
            };

            await createClient({ proxyResolver, proxyAgentFactory: factory }).get(server.origin);

            expect(calls[0].options.proxy.proxyAuth).to.equal("user:secret");
        });

        it("decodes percent-encoded proxy credentials before authentication", async () => {
            sandbox.stub(axios, "request").resolves(createAxiosResponse({}));
            const { factory, calls } = createRecordingFactory();
            const proxyResolver: IProxyResolver = {
                resolve: () => ({
                    url: new URL("http://us%40er:p%3Ass@proxy.example.com:3128"),
                    rejectUnauthorized: true,
                    source: "environment",
                }),
            };

            await createClient({ proxyResolver, proxyAgentFactory: factory }).get(
                "http://example.test",
            );

            expect(calls[0].options.proxy.proxyAuth).to.equal("us@er:p:ss");
        });

        it("maps proxy agent construction failures to proxy-configuration", async () => {
            const factory = createRecordingFactory().factory;
            (factory.httpOverHttp as sinon.SinonStub).throws(new Error("factory failed"));
            const proxyResolver: IProxyResolver = {
                resolve: () => ({
                    url: new URL("http://proxy.example.com:3128"),
                    rejectUnauthorized: true,
                    source: "environment",
                }),
            };

            const error = await captureHttpClientError(() =>
                createClient({ proxyResolver, proxyAgentFactory: factory }).get(
                    "http://example.test",
                ),
            );

            expect(error.kind).to.equal("proxy-configuration");
            expect(error.message).not.to.contain("factory failed");
            expect(error.cause).to.be.instanceOf(Error);
        });
    });
});
