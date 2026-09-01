/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import {
    InMemoryMetadataProvider,
    type MetadataProvider,
    type SimpleQueryExecutor,
    type SimpleQueryResult,
} from "@vscode-mssql/tsql-language-service";
import {
    PreviewMetadataSessionPool,
    previewMetadataSessionKey,
} from "../../src/languageservice/preview/previewMetadataSessionPool";

const { expect } = chai;
chai.use(sinonChai);

suite("Preview metadata session pool", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => sandbox.restore());

    test("shares one provider for a connection, database, and engine profile", async () => {
        const providers: MetadataProvider[] = [];
        const executors: SimpleQueryExecutor[] = [];
        const send = sandbox.stub().resolves({ columns: [], rows: [] } satisfies SimpleQueryResult);
        const pool = new PreviewMetadataSessionPool(
            (executor) => {
                executors.push(executor);
                const provider = new InMemoryMetadataProvider();
                providers.push(provider);
                return provider;
            },
            send,
            2,
        );

        const first = pool.acquire("same-session", "file:///one.sql");
        const second = pool.acquire("same-session", "file:///two.sql");

        expect(first.provider).to.equal(second.provider);
        expect(providers).to.have.length(1);
        await executors[0]!.execute("SELECT 1");
        expect(send).to.have.been.calledWith("file:///two.sql", "SELECT 1", undefined);

        second.dispose();
        await executors[0]!.execute("SELECT 2");
        expect(send).to.have.been.calledWith("file:///one.sql", "SELECT 2", undefined);
        first.dispose();
    });

    test("separates databases and profiles and evicts only inactive sessions", () => {
        let created = 0;
        const pool = new PreviewMetadataSessionPool(
            () => {
                created++;
                return new InMemoryMetadataProvider();
            },
            async () => ({ columns: [], rows: [] }),
            1,
        );
        const active = pool.acquire("server/db/sqlserver", "file:///one.sql");
        const other = pool.acquire("server/other/sqlserver", "file:///two.sql");
        expect(created).to.equal(2);
        expect(pool.size).to.equal(2, "active sessions are never evicted");

        other.dispose();
        const third = pool.acquire("server/db/fabric", "file:///three.sql");
        expect(pool.size).to.equal(2);
        expect(created).to.equal(3);
        active.dispose();
        third.dispose();
    });

    test("builds a stable key without passwords or access tokens", () => {
        const key = previewMetadataSessionKey({
            server: "LOCALHOST",
            port: 1433,
            database: "Sales",
            user: "AppUser",
            authenticationType: "SqlLogin",
            accountId: "account",
            tenantId: "tenant",
            engineProfile: "sqlserver-2025",
        });
        const equivalent = previewMetadataSessionKey({
            server: "localhost",
            port: 1433,
            database: "sales",
            user: "appuser",
            authenticationType: "sqllogin",
            accountId: "account",
            tenantId: "tenant",
            engineProfile: "sqlserver-2025",
        });

        expect(key).to.equal(equivalent);
        expect(key).not.to.include("password");
        expect(key).not.to.include("access-token");
    });
});
