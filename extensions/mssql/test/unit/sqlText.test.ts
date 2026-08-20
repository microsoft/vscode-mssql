/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";

import {
    SQL_TEXT_LINE_BREAK,
    tokenizeSingleLineSqlText,
    tokenizeSqlText,
} from "../../src/webviews/common/sqlText";
import { normalizeExecutionPlanQuery } from "../../src/webviews/pages/ExecutionPlan/executionPlanQuery";

suite("SqlText", () => {
    test("preserves the original SQL while assigning lightweight syntax token types", () => {
        const sql =
            "SELECT TOP (10) [name], N'value ''one''' FROM #items -- comment\nWHERE id = 42";
        const tokens = tokenizeSqlText(sql);

        expect(tokens.map((token) => token.text).join("")).to.equal(sql);
        expect(
            tokens.filter((token) => token.kind === "keyword").map((token) => token.text),
        ).to.deep.equal(["SELECT", "TOP", "FROM", "WHERE"]);
        expect(tokens.some((token) => token.kind === "identifier" && token.text === "[name]")).to.be
            .true;
        expect(tokens.some((token) => token.kind === "variable" && token.text === "#items")).to.be
            .true;
        expect(tokens.some((token) => token.kind === "string" && token.text === "N'value ''one'''"))
            .to.be.true;
        expect(tokens.some((token) => token.kind === "number" && token.text === "42")).to.be.true;
        expect(tokens.some((token) => token.kind === "comment" && token.text === "-- comment")).to
            .be.true;
    });

    test("keeps HTML-like and unterminated input as plain React-rendered text", () => {
        const sql = "SELECT '<img src=x onerror=alert(1)>' /* unfinished";
        const tokens = tokenizeSqlText(sql);

        expect(tokens.map((token) => token.text).join("")).to.equal(sql);
        expect(tokens.find((token) => token.kind === "string")?.text).to.equal(
            "'<img src=x onerror=alert(1)>'",
        );
        expect(tokens.find((token) => token.kind === "comment")?.text).to.equal("/* unfinished");
    });

    test("renders each SQL line break as a visible character without extending line comments", () => {
        const sql = "SELECT 1 -- first\r\nFROM dbo.Items\nWHERE id = 1\rORDER BY id";
        const tokens = tokenizeSingleLineSqlText(sql);
        const displayText = tokens.map((token) => token.text).join("");

        expect(displayText).to.equal(
            `SELECT 1 -- first ${SQL_TEXT_LINE_BREAK} FROM dbo.Items ${SQL_TEXT_LINE_BREAK} WHERE id = 1 ${SQL_TEXT_LINE_BREAK} ORDER BY id`,
        );
        expect(
            tokens.filter((token) => token.kind === "comment").map((token) => token.text),
        ).to.deep.equal(["-- first"]);
        expect(
            tokens.filter((token) => token.kind === "keyword").map((token) => token.text),
        ).to.deep.equal(["SELECT", "FROM", "WHERE", "ORDER", "BY"]);
    });

    test("distinguishes functions, data types, variables, and operators", () => {
        const tokens = tokenizeSqlText(
            "SELECT CAST(@value AS nvarchar(50)), ROW_NUMBER() OVER (ORDER BY id), id >= 10",
        );

        expect(
            tokens.filter((token) => token.kind === "function").map((token) => token.text),
        ).to.deep.equal(["CAST", "ROW_NUMBER"]);
        expect(
            tokens.filter((token) => token.kind === "type").map((token) => token.text),
        ).to.deep.equal(["nvarchar"]);
        expect(
            tokens.filter((token) => token.kind === "variable").map((token) => token.text),
        ).to.deep.equal(["@value"]);
        expect(
            tokens.filter((token) => token.kind === "operator").map((token) => token.text),
        ).to.deep.equal([">="]);
    });
});

suite("ExecutionPlanQuery", () => {
    test("removes only leading statement separators while preserving comments", () => {
        expect(
            normalizeExecutionPlanQuery(
                ";\r\n\r\n-- Wide result\r\nselect top (50) * from sys.objects",
            ),
        ).to.equal("-- Wide result\r\nselect top (50) * from sys.objects");
        expect(normalizeExecutionPlanQuery("\r\n/* keep this */\r\nselect 1")).to.equal(
            "/* keep this */\r\nselect 1",
        );
    });
});
