/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from "http";
import * as sinon from "sinon";
import { expect } from "chai";
import { Logger } from "../../../src/models/logger";
import { PythonNotebooks } from "../../../src/constants/locConstants";
import { PythonNotebookCredentialsProvider } from "../../../src/notebooks/pythonNotebookCredentials";
import {
    PythonNotebookSessionBroker,
    PythonNotebookBootstrap,
} from "../../../src/notebooks/pythonNotebookSessionBroker";

suite("PythonNotebookSessionBroker", () => {
    let sandbox: sinon.SinonSandbox;
    let provider: sinon.SinonStubbedInstance<PythonNotebookCredentialsProvider>;
    let broker: PythonNotebookSessionBroker;
    let enabled: boolean;
    const reference = { version: 1, connectionId: "selected", database: "db" } as const;

    setup(() => {
        sandbox = sinon.createSandbox();
        provider = sandbox.createStubInstance(PythonNotebookCredentialsProvider);
        provider.getConfiguration.resolves({
            settings: {
                server: "server",
                database: "db",
                encrypt: "yes",
                trustServerCertificate: false,
                loginTimeout: 15,
                queryTimeout: 30,
            },
            authentication: { kind: "sql", username: "user", password: "synthetic-secret" },
        });
        provider.getSqlToken.resolves({ token: "synthetic-token", expiresOn: 9999999999 });
        enabled = true;
        broker = new PythonNotebookSessionBroker(sandbox.createStubInstance(Logger), () => enabled);
    });

    teardown(async () => {
        await broker.dispose();
        sandbox.restore();
    });

    function request(
        bootstrap: PythonNotebookBootstrap,
        path = "/v1/configuration",
        options: {
            capability?: string;
            origin?: string;
            host?: string;
            body?: string;
            method?: string;
        } = {},
    ): Promise<{ status: number; body: string; cache: string }> {
        return new Promise((resolve, reject) => {
            const url = new URL(path, bootstrap.brokerUrl);
            const headers: http.OutgoingHttpHeaders = {
                authorization: `Bearer ${options.capability ?? bootstrap.capability}`,
                "content-type": "application/json",
            };
            if (options.origin) headers.origin = options.origin;
            if (options.host) headers.host = options.host;
            const req = http.request(url, { method: options.method ?? "POST", headers }, (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk: string) => {
                    body += chunk;
                });
                res.on("end", () =>
                    resolve({
                        status: res.statusCode,
                        body,
                        cache: res.headers["cache-control"],
                    }),
                );
            });
            req.on("error", reject);
            req.end(options.body ?? "{}");
        });
    }

    test("provides configuration only for the capability's bound connection", async () => {
        const session = await broker.createSession(provider, reference);
        expect(new URL(session.brokerUrl).hostname).to.equal("127.0.0.1");
        const response = await request(session);
        expect(response.status).to.equal(200);
        expect(response.cache).to.equal("no-store");
        expect(JSON.parse(response.body).settings.database).to.equal("db");
        expect(provider.getConfiguration.calledWith(reference)).to.equal(true);
    });

    test("rejects invalid capabilities and browser or DNS-rebound requests", async () => {
        const session = await broker.createSession(provider, reference);
        for (const options of [
            { capability: "wrong" },
            { origin: "https://example.com" },
            { host: "example.com" },
            { method: "GET" },
        ]) {
            expect((await request(session, "/v1/configuration", options)).status).not.to.equal(200);
        }
        expect(provider.getConfiguration.called).to.equal(false);
    });

    test("rejects oversized bodies and unknown routes", async () => {
        const session = await broker.createSession(provider, reference);
        expect(
            (await request(session, "/v1/configuration", { body: " ".repeat(1025) })).status,
        ).to.equal(413);
        expect((await request(session, "/unknown")).status).to.equal(404);
        expect(provider.getConfiguration.called).to.equal(false);
    });

    test("rechecks trust and feature enablement at credential delivery", async () => {
        const session = await broker.createSession(provider, reference);
        enabled = false;
        expect((await request(session)).status).to.equal(403);
        expect(provider.getConfiguration.called).to.equal(false);
    });

    test("revoked capabilities cannot obtain tokens", async () => {
        const session = await broker.createSession(provider, reference);
        const other = await broker.createSession(provider, reference);
        broker.revoke(session.capability);
        expect((await request(session, "/v1/token")).status).to.equal(403);
        expect((await request(other, "/v1/token")).status).to.equal(200);
        expect(provider.getSqlToken.calledWith(reference)).to.equal(true);
    });

    test("does not return credentials if revoked while acquisition was pending", async () => {
        let complete: () => void;
        let acquired: () => void;
        const started = new Promise<void>((resolve) => {
            acquired = resolve;
        });
        const pending = new Promise<void>((resolve) => {
            complete = resolve;
        });
        provider.getSqlToken.callsFake(async () => {
            acquired();
            await pending;
            return { token: "synthetic-token", expiresOn: 9999999999 };
        });
        const session = await broker.createSession(provider, reference);
        const response = request(session, "/v1/token");
        await started;
        broker.revoke(session.capability);
        complete();
        expect((await response).status).to.equal(403);
    });

    test("stops the listener after the last session and can start a new one", async () => {
        const session = await broker.createSession(provider, reference);
        broker.revoke(session.capability);
        try {
            await request(session);
            expect.fail("The unused listener must be closed");
        } catch (error) {
            expect((error as NodeJS.ErrnoException).code).to.equal("ECONNREFUSED");
        }
        const next = await broker.createSession(provider, reference);
        expect((await request(next)).status).to.equal(200);
    });

    test("keeps the listener alive while a replacement session is being created", async () => {
        const first = await broker.createSession(provider, reference);
        const replacement = broker.createSession(provider, reference);
        broker.revoke(first.capability);
        const next = await replacement;
        expect((await request(next)).status).to.equal(200);
        expect((await request(first)).status).to.equal(403);
    });

    test("rejects a session whose listener startup is disposed", async function () {
        this.timeout(2000);
        const creation = broker.createSession(provider, reference).then(
            () => undefined,
            (error: Error) => error.message,
        );
        await broker.dispose();
        expect(await creation).to.equal(PythonNotebooks.errors.trust);
    });
});
