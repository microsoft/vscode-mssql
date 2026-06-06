/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RpcPayloadRedactor } from "../../../src/languageservice/rpcCapture/rpcPayloadRedactor";

suite("RpcPayloadRedactor", () => {
    test("redacts connection, identity, path, query, and row payloads", () => {
        const redactor = new RpcPayloadRedactor();
        const result = redactor.sanitize(
            {
                ownerUri: "file:///c:/Users/person/Documents/query.sql",
                connection: {
                    server: "prod-sql.contoso.com",
                    database: "CustomerDb",
                    userName: "person@contoso.com",
                    password: "p@ssword",
                    connectionString:
                        "Server=prod-sql.contoso.com;Database=CustomerDb;User Id=person;Password=p@ssword;",
                    tenantId: "tenant-guid",
                    accessToken: "token-value",
                },
                query: "select * from dbo.Customers",
                rows: [
                    { CustomerName: "Alice", Email: "alice@contoso.com" },
                    { CustomerName: "Bob", Email: "bob@contoso.com" },
                ],
            },
            "connection/connect",
        );

        const sanitized = result.value as {
            ownerUri: string;
            connection: Record<string, unknown>;
            query: string;
            rows: Record<string, unknown>;
        };

        expect(sanitized.ownerUri).to.equal("<ownerUri:1>");
        expect(sanitized.connection.server).to.equal("<server:1>");
        expect(sanitized.connection.database).to.equal("<database:1>");
        expect(sanitized.connection.userName).to.equal("<user:1>");
        expect(sanitized.connection.password).to.equal("<secret:1>");
        expect(sanitized.connection.connectionString).to.equal("<connectionString:1>");
        expect(sanitized.connection.tenantId).to.equal("<id:1>");
        expect(sanitized.connection.accessToken).to.equal("<token:1>");
        expect(sanitized.query).to.match(/^<query length=\d+>$/);
        expect(sanitized.rows).to.deep.equal({
            __rpcInspectorSummary: "rows",
            rowCount: 2,
            columnCount: 2,
        });
        expect(JSON.stringify(sanitized)).not.to.contain("prod-sql");
        expect(JSON.stringify(sanitized)).not.to.contain("CustomerDb");
        expect(JSON.stringify(sanitized)).not.to.contain("p@ssword");
        expect(result.summary.counts.server).to.equal(1);
        expect(result.summary.counts.rows).to.equal(1);
    });

    test("preserves placeholder relationships deterministically", () => {
        const redactor = new RpcPayloadRedactor();
        const first = redactor.sanitize({
            primaryServer: "server-a",
            failoverServer: "server-b",
            retryServer: "server-a",
        }).value as Record<string, string>;

        expect(first.primaryServer).to.equal("<server:1>");
        expect(first.failoverServer).to.equal("<server:2>");
        expect(first.retryServer).to.equal("<server:1>");
    });

    test("redacts LSP document text and error messages", () => {
        const redactor = new RpcPayloadRedactor();
        const didOpen = redactor.sanitize(
            {
                textDocument: {
                    uri: "file:///c:/Users/person/source/private.sql",
                    text: "select secret_column from private_table",
                },
            },
            "textDocument/didOpen",
        ).value as { textDocument: { uri: string; text: string } };

        const error = redactor.sanitize(
            {
                code: -1,
                message: "Login failed for user person@contoso.com on prod-sql.contoso.com",
            },
            "connection/connect",
            true,
        ).value as { code: number; message: string };

        expect(didOpen.textDocument.uri).to.equal("<ownerUri:1>");
        expect(didOpen.textDocument.text).to.match(/^<query length=\d+>$/);
        expect(error.code).to.equal(-1);
        expect(error.message).to.match(/^<errorText length=\d+>$/);
        expect(JSON.stringify(error)).not.to.contain("person@contoso.com");
    });
});
