/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { BridgeErrorCode, BridgeRequestError } from "../../../src/sqlToolsMcp/contracts";
import { normalizeSqlToolsMcpQuery } from "../../../src/sqlToolsMcp/queryNormalizer";

suite("SQL Tools MCP query normalizer", () => {
    test("injects returnAsMarkdown for text queries by default", () => {
        const query = normalizeSqlToolsMcpQuery({
            query: "SELECT @returnAsMarkdown;",
        });

        expect(query).to.equal("DECLARE @returnAsMarkdown bit = 1;\nSELECT @returnAsMarkdown;");
    });

    test("normalizes text query parameters and preserves equals signs in values", () => {
        const query = normalizeSqlToolsMcpQuery({
            query: "SELECT @name, @filter, @returnAsMarkdown;",
            returnAsMarkdown: false,
            queryParameters: ["name=O'Brien", "@filter=a=b=c"],
        });

        expect(query).to.equal(
            [
                "DECLARE @name nvarchar(max) = N'O''Brien';",
                "DECLARE @filter nvarchar(max) = N'a=b=c';",
                "DECLARE @returnAsMarkdown bit = 0;",
                "SELECT @name, @filter, @returnAsMarkdown;",
            ].join("\n"),
        );
    });

    test("does not duplicate explicit returnAsMarkdown parameter", () => {
        const query = normalizeSqlToolsMcpQuery({
            query: "SELECT @returnAsMarkdown;",
            returnAsMarkdown: false,
            queryParameters: ["returnAsMarkdown=true"],
        });

        expect(query).to.equal("DECLARE @returnAsMarkdown bit = 1;\nSELECT @returnAsMarkdown;");
    });

    test("rejects duplicate query parameter names", () => {
        expectBridgeError(
            () =>
                normalizeSqlToolsMcpQuery({
                    query: "SELECT @name;",
                    queryParameters: ["name=first", "@Name=second"],
                }),
            BridgeErrorCode.InvalidRequest,
            "Query parameter names must be unique.",
        );
    });

    test("builds conservative stored procedure execution without returnAsMarkdown injection", () => {
        const query = normalizeSqlToolsMcpQuery({
            query: "dbo.sp_help",
            executeStoredProcedure: true,
            returnAsMarkdown: true,
            queryParameters: ["objname=Customers"],
        });

        expect(query).to.equal(
            [
                "DECLARE @objname nvarchar(max) = N'Customers';",
                "EXEC [dbo].[sp_help] @objname = @objname;",
            ].join("\n"),
        );
        expect(query).not.to.contain("@returnAsMarkdown");
    });

    test("supports stored procedure execution without parameters", () => {
        const query = normalizeSqlToolsMcpQuery({
            query: "sp_help",
            executeStoredProcedure: true,
        });

        expect(query).to.equal("\nEXEC [sp_help];");
    });

    test("rejects empty query descriptors", () => {
        expectBridgeError(
            () => normalizeSqlToolsMcpQuery({ query: "" }),
            BridgeErrorCode.InvalidRequest,
            "QueryContentDescriptor.query is required.",
        );
    });

    test("rejects GO-separated batches", () => {
        expectBridgeError(
            () =>
                normalizeSqlToolsMcpQuery({
                    query: "SELECT 1;\nGO\nSELECT 2;",
                }),
            BridgeErrorCode.InvalidRequest,
            "Normalized execution does not support GO-separated batches.",
        );
    });

    test("rejects malformed query parameters", () => {
        expectBridgeError(
            () =>
                normalizeSqlToolsMcpQuery({
                    query: "SELECT 1;",
                    queryParameters: ["missingSeparator"],
                }),
            BridgeErrorCode.InvalidRequest,
            "Query parameters must use name=value syntax.",
        );
    });

    test("rejects invalid query parameter names", () => {
        expectBridgeError(
            () =>
                normalizeSqlToolsMcpQuery({
                    query: "SELECT 1;",
                    queryParameters: ["1bad=value"],
                }),
            BridgeErrorCode.InvalidRequest,
            "Query parameter name is invalid.",
        );
    });

    test("rejects invalid returnAsMarkdown values", () => {
        expectBridgeError(
            () =>
                normalizeSqlToolsMcpQuery({
                    query: "SELECT @returnAsMarkdown;",
                    queryParameters: ["returnAsMarkdown=maybe"],
                }),
            BridgeErrorCode.InvalidRequest,
            "returnAsMarkdown must be true or false.",
        );
    });

    test("rejects stored procedure names outside the conservative identifier grammar", () => {
        for (const procedureName of [
            "[dbo].[sp help]",
            "dbo.sp help",
            "server.database.schema.proc",
        ]) {
            expectBridgeError(
                () =>
                    normalizeSqlToolsMcpQuery({
                        query: procedureName,
                        executeStoredProcedure: true,
                    }),
                BridgeErrorCode.InvalidRequest,
                "Stored procedure execution requires a valid procedure name.",
            );
        }
    });
});

function expectBridgeError(
    callback: () => unknown,
    errorCode: BridgeErrorCode,
    message: string,
): void {
    expect(callback).to.throw(BridgeRequestError, message);
    try {
        callback();
    } catch (error) {
        expect(error).to.be.instanceOf(BridgeRequestError);
        expect((error as BridgeRequestError).bridgeErrorCode).to.equal(errorCode);
        return;
    }
    throw new Error("Expected BridgeRequestError.");
}
