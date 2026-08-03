/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import * as zlib from "zlib";
import axios, { AxiosHeaders } from "axios";
import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { HttpClient } from "../../../src/base/http/httpClient";
import { HttpClientError } from "../../../src/base/http/httpErrors";
import { IDownloadProgress } from "../../../src/base/http/httpTypes";
import { IProxyResolver } from "../../../src/base/http/proxy";
import { ITestServer, startTestServer } from "./testServer";

chai.use(sinonChai);

const noProxy: IProxyResolver = { resolve: () => undefined };
const payload = "downloaded-content";

function createClient(): HttpClient {
    return new HttpClient({ proxyResolver: noProxy });
}

async function captureHttpClientError(action: () => Promise<unknown>): Promise<HttpClientError> {
    try {
        await action();
        expect.fail("Expected the download to reject.");
    } catch (error) {
        expect(error).to.be.instanceOf(HttpClientError);
        return error as HttpClientError;
    }
}

describe("HttpClient downloads", () => {
    let server: ITestServer | undefined;
    let workingDirectory: string;
    let sandbox: sinon.SinonSandbox;

    beforeEach(async () => {
        sandbox = sinon.createSandbox();
        workingDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "toolkit-download-"));
    });

    afterEach(async () => {
        sandbox.restore();
        await server?.close();
        server = undefined;
        await fsPromises.rm(workingDirectory, { recursive: true, force: true });
    });

    describe("downloadToPath", () => {
        it("writes the response body to the destination", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": String(payload.length) });
                response.end(payload);
            });
            const destination = path.join(workingDirectory, "package.zip");

            const result = await createClient().downloadToPath(server.origin, destination);

            expect(result.ok).to.be.true;
            expect(await fsPromises.readFile(destination, "utf8")).to.equal(payload);
        });

        it("leaves no staging files behind after a successful download", async () => {
            server = await startTestServer((_request, response) => response.end(payload));
            const destination = path.join(workingDirectory, "package.zip");

            await createClient().downloadToPath(server.origin, destination);

            expect(await fsPromises.readdir(workingDirectory)).to.deep.equal(["package.zip"]);
        });

        it("does not create the destination for a non-success response", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(404);
                response.end("missing");
            });
            const destination = path.join(workingDirectory, "package.zip");

            const result = await createClient().downloadToPath(server.origin, destination);

            expect(result.ok).to.be.false;
            expect(fs.existsSync(destination)).to.be.false;
        });

        it("preserves an existing destination when the response is a non-success", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(500);
                response.end("boom");
            });
            const destination = path.join(workingDirectory, "package.zip");
            await fsPromises.writeFile(destination, "previous", "utf8");

            await createClient().downloadToPath(server.origin, destination);

            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
        });

        it("preserves an existing destination when the response stream fails", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": "1024" });
                response.write(payload);
                response.destroy();
            });
            const destination = path.join(workingDirectory, "package.zip");
            await fsPromises.writeFile(destination, "previous", "utf8");

            await captureHttpClientError(() =>
                createClient().downloadToPath(server!.origin, destination),
            );

            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
        });

        it("removes the staging file when the response stream fails", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": "1024" });
                response.write(payload);
                response.destroy();
            });
            const destination = path.join(workingDirectory, "package.zip");

            await captureHttpClientError(() =>
                createClient().downloadToPath(server!.origin, destination),
            );

            expect(await fsPromises.readdir(workingDirectory)).to.deep.equal([]);
        });

        it("fails when the body ends before the declared content length", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": "1024" });
                response.write(payload);
                // Delayed so the response headers are delivered before the stream is broken.
                setTimeout(() => response.destroy(), 25);
            });
            const destination = path.join(workingDirectory, "package.zip");

            const error = await captureHttpClientError(() =>
                createClient().downloadToPath(server!.origin, destination),
            );

            expect(error.kind).to.equal("response-stream");
        });

        it("reports cancellation while the body is streaming", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": "1024" });
                response.write(payload);
            });
            const destination = path.join(workingDirectory, "package.zip");
            await fsPromises.writeFile(destination, "previous", "utf8");
            const controller = new AbortController();
            const pending = createClient().downloadToPath(server.origin, destination, {
                signal: controller.signal,
            });
            setTimeout(() => controller.abort(), 25);

            const error = await captureHttpClientError(() => pending);

            expect(error.kind).to.equal("cancelled");
            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
            expect(await fsPromises.readdir(workingDirectory)).to.deep.equal(["package.zip"]);
        });

        it("preserves an existing destination after a request failure", async () => {
            const closedServer = await startTestServer((_request, response) => response.end());
            const origin = closedServer.origin;
            await closedServer.close();
            const destination = path.join(workingDirectory, "package.zip");
            await fsPromises.writeFile(destination, "previous", "utf8");

            const error = await captureHttpClientError(() =>
                createClient().downloadToPath(origin, destination),
            );

            expect(error.kind).to.equal("network");
            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
            expect(await fsPromises.readdir(workingDirectory)).to.deep.equal(["package.zip"]);
        });

        it("reports a timeout and preserves the destination while the body is streaming", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": "1024" });
                response.write(payload);
            });
            const destination = path.join(workingDirectory, "package.zip");
            await fsPromises.writeFile(destination, "previous", "utf8");

            const error = await captureHttpClientError(() =>
                createClient().downloadToPath(server!.origin, destination, { timeoutMs: 50 }),
            );

            expect(error.kind).to.equal("timeout");
            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
            expect(await fsPromises.readdir(workingDirectory)).to.deep.equal(["package.zip"]);
        });

        it("preserves an existing destination after a destination write failure", async () => {
            server = await startTestServer((_request, response) => response.end(payload));
            // The destination component is valid, but adding the staging suffix exceeds the
            // portable 255-character component limit and makes the staging write fail.
            const destination = path.join(workingDirectory, "a".repeat(240));
            await fsPromises.writeFile(destination, "previous", "utf8");

            const error = await captureHttpClientError(() =>
                createClient().downloadToPath(server!.origin, destination),
            );

            expect(error.kind).to.equal("destination");
            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
            expect(await fsPromises.readdir(workingDirectory)).to.deep.equal(["a".repeat(240)]);
        });

        it("forwards custom request headers", async () => {
            let receivedHeader: string | undefined;
            server = await startTestServer((request, response) => {
                receivedHeader = request.headers["x-download-id"] as string | undefined;
                response.end(payload);
            });

            await createClient().downloadToPath(
                server.origin,
                path.join(workingDirectory, "package.zip"),
                { headers: { "X-Download-Id": "abc123" } },
            );

            expect(receivedHeader).to.equal("abc123");
        });

        it("requests an unencoded response by default", async () => {
            let acceptEncoding: string | undefined;
            server = await startTestServer((request, response) => {
                acceptEncoding = request.headers["accept-encoding"];
                response.end(payload);
            });

            await createClient().downloadToPath(
                server.origin,
                path.join(workingDirectory, "package.zip"),
            );

            expect(acceptEncoding).to.equal("identity");
        });

        it("rejects an encoded success response before modifying the destination", async () => {
            const compressedPayload = zlib.gzipSync(payload);
            server = await startTestServer((_request, response) => {
                response.writeHead(200, {
                    "content-encoding": "gzip",
                    "content-length": String(compressedPayload.length),
                });
                response.end(compressedPayload);
            });
            const destination = path.join(workingDirectory, "package.zip");
            await fsPromises.writeFile(destination, "previous", "utf8");

            const error = await captureHttpClientError(() =>
                createClient().downloadToPath(server!.origin, destination),
            );

            expect(error.kind).to.equal("response-stream");
            expect(error.code).to.equal("ERR_UNSUPPORTED_CONTENT_ENCODING");
            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
            expect(await fsPromises.readdir(workingDirectory)).to.deep.equal(["package.zip"]);
        });

        it("rejects bytes received for a declared zero-length response", async () => {
            sandbox.stub(axios, "request").resolves({
                data: Readable.from(payload),
                status: 200,
                statusText: "OK",
                headers: { "content-length": "0" },
                config: { headers: new AxiosHeaders() },
            });
            const destination = path.join(workingDirectory, "package.zip");
            await fsPromises.writeFile(destination, "previous", "utf8");

            const error = await captureHttpClientError(() =>
                createClient().downloadToPath("http://example.test/package.zip", destination),
            );

            expect(error.kind).to.equal("response-stream");
            expect(error.code).to.equal("ERR_CONTENT_LENGTH_MISMATCH");
            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
        });
    });

    describe("progress reporting", () => {
        it("emits an initial zero-byte progress event with the total size", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": String(payload.length) });
                response.end(payload);
            });
            const events: IDownloadProgress[] = [];

            await createClient().downloadToPath(
                server.origin,
                path.join(workingDirectory, "package.zip"),
                { onProgress: (progress) => events.push(progress) },
            );

            expect(events[0]).to.deep.equal({
                downloadedBytes: 0,
                totalBytes: payload.length,
                percentage: 0,
            });
        });

        it("reports the full size once the download completes", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": String(payload.length) });
                response.end(payload);
            });
            const events: IDownloadProgress[] = [];

            await createClient().downloadToPath(
                server.origin,
                path.join(workingDirectory, "package.zip"),
                { onProgress: (progress) => events.push(progress) },
            );

            expect(events[events.length - 1]).to.deep.equal({
                downloadedBytes: payload.length,
                totalBytes: payload.length,
                percentage: 100,
            });
        });

        it("reports an unknown total when no content length is sent", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "transfer-encoding": "chunked" });
                response.write(payload);
                response.end();
            });
            const events: IDownloadProgress[] = [];

            await createClient().downloadToPath(
                server.origin,
                path.join(workingDirectory, "package.zip"),
                { onProgress: (progress) => events.push(progress) },
            );

            expect(events[0].totalBytes).to.be.undefined;
            expect(events[0].percentage).to.be.undefined;
        });

        it("reports a known empty response as zero total bytes", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": "0" });
                response.end();
            });
            const onProgress = sandbox.spy();

            await createClient().downloadToPath(
                server.origin,
                path.join(workingDirectory, "package.zip"),
                { onProgress },
            );

            expect(onProgress).to.have.been.calledWith({
                downloadedBytes: 0,
                totalBytes: 0,
                percentage: 100,
            });
        });

        it("surfaces a throwing progress callback as a progress-callback failure", async () => {
            server = await startTestServer((_request, response) => response.end(payload));

            const error = await captureHttpClientError(() =>
                createClient().downloadToPath(
                    server!.origin,
                    path.join(workingDirectory, "package.zip"),
                    {
                        onProgress: () => {
                            throw new Error("callback failed");
                        },
                    },
                ),
            );

            expect(error.kind).to.equal("progress-callback");
        });

        it("preserves an existing destination when a progress callback fails mid-stream", async () => {
            server = await startTestServer((_request, response) => response.end(payload));
            const destination = path.join(workingDirectory, "package.zip");
            await fsPromises.writeFile(destination, "previous", "utf8");

            const error = await captureHttpClientError(() =>
                createClient().downloadToPath(server!.origin, destination, {
                    onProgress: (progress) => {
                        if (progress.downloadedBytes > 0) {
                            throw new Error("callback failed");
                        }
                    },
                }),
            );

            expect(error.kind).to.equal("progress-callback");
            expect(await fsPromises.readFile(destination, "utf8")).to.equal("previous");
            expect(await fsPromises.readdir(workingDirectory)).to.deep.equal(["package.zip"]);
        });
    });

    describe("downloadToFileDescriptor", () => {
        it("writes the response body into the descriptor", async () => {
            server = await startTestServer((_request, response) => response.end(payload));
            const destination = path.join(workingDirectory, "package.zip");
            const descriptor = fs.openSync(destination, "w");

            try {
                const result = await createClient().downloadToFileDescriptor(
                    server.origin,
                    descriptor,
                );

                expect(result.ok).to.be.true;
            } finally {
                fs.closeSync(descriptor);
            }

            expect(await fsPromises.readFile(destination, "utf8")).to.equal(payload);
        });

        it("leaves the caller's descriptor open after a successful download", async () => {
            server = await startTestServer((_request, response) => response.end(payload));
            const descriptor = fs.openSync(path.join(workingDirectory, "package.zip"), "w");

            try {
                await createClient().downloadToFileDescriptor(server.origin, descriptor);

                expect(() => fs.writeSync(descriptor, "still-open")).not.to.throw();
            } finally {
                fs.closeSync(descriptor);
            }
        });

        it("leaves the caller's descriptor open after a failed download", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(200, { "content-length": "1024" });
                response.write(payload);
                response.destroy();
            });
            const descriptor = fs.openSync(path.join(workingDirectory, "package.zip"), "w");

            try {
                await captureHttpClientError(() =>
                    createClient().downloadToFileDescriptor(server!.origin, descriptor),
                );

                expect(() => fs.writeSync(descriptor, "still-open")).not.to.throw();
            } finally {
                fs.closeSync(descriptor);
            }
        });

        it("does not write anything for a non-success response", async () => {
            server = await startTestServer((_request, response) => {
                response.writeHead(404);
                response.end("missing");
            });
            const destination = path.join(workingDirectory, "package.zip");
            const descriptor = fs.openSync(destination, "w");

            try {
                const result = await createClient().downloadToFileDescriptor(
                    server.origin,
                    descriptor,
                );

                expect(result.ok).to.be.false;
            } finally {
                fs.closeSync(descriptor);
            }

            expect(await fsPromises.readFile(destination, "utf8")).to.equal("");
        });
    });
});
