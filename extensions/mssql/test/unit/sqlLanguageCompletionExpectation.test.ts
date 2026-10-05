/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { completionExpectationAt } from "../../src/sqlLanguage/core/parser/cursorExpectation";
import { sketchStatement } from "../../src/sqlLanguage/core/sketch";
import { StatementSegment } from "../../src/sqlLanguage/core/segmenter";
import { FourslashDocument } from "../../src/sqlLanguage/testSupport/fourslash";

function expectation(source: string): ReturnType<typeof completionExpectationAt> {
    const doc = new FourslashDocument(source);
    const statement = statementAt(
        doc.fixture.text,
        doc.segments.batches[0].statements,
        doc.caretOffset,
    );
    const sketch = sketchStatement(doc.fixture.text, doc.lexed.tokens, statement);
    return completionExpectationAt(doc.fixture.text, doc.lexed.tokens, sketch, doc.caretOffset);
}

function statementAt(
    text: string,
    statements: readonly StatementSegment[],
    offset: number,
): StatementSegment {
    for (const statement of statements) {
        if (offset >= statement.start && offset <= statement.end + 1) {
            return statement;
        }
    }
    throw new Error(`No statement at offset ${offset} in ${JSON.stringify(text)}`);
}

suite("sqlLanguage completion expectation", () => {
    for (const moduleSql of [
        "CREATE PROCEDURE dbo.p/*caret*/ AS SELECT 1",
        "CREATE VIEW dbo.v/*caret*/ AS SELECT 1 AS c",
        "CREATE FUNCTION dbo.f/*caret*/() RETURNS int AS BEGIN RETURN 1 END",
        "CREATE TRIGGER dbo.tr/*caret*/ ON dbo.T AFTER INSERT AS SELECT 1",
    ]) {
        test(`module object names are declaration symbols: ${moduleSql.split("/*caret*/")[0]}`, () => {
            const e = expectation(moduleSql);

            expect(e.kind).to.equal("declarationName");
            expect(e.suppressReason).to.equal("declarationSymbol");
        });
    }

    test("module body positions fall back to expression expectations", () => {
        const e = expectation("CREATE PROCEDURE dbo.p AS SELECT /*caret*/ FROM Sales.Orders");

        expect(e.kind).to.equal("columnExpression");
    });

    test("FROM continuation after a source alias expects join operators", () => {
        const e = expectation("SELECT * FROM Sales.Orders o c/*caret*/");

        expect(e.kind).to.equal("joinOperator");
        expect(e.context).to.deep.equal({ kind: "joinOperator", scopeId: 0, prefix: "c" });
    });

    test("table source alias declarations stay silent", () => {
        const e = expectation("SELECT * FROM Sales.Orders c/*caret*/");

        expect(e.kind).to.equal("declarationName");
        expect(e.suppressReason).to.equal("declarationSymbol");
    });

    test("DECLARE variable names are declaration symbols", () => {
        const e = expectation("DECLARE @x/*caret*/");

        expect(e.kind).to.equal("declarationName");
        expect(e.suppressReason).to.equal("declarationSymbol");
    });

    test("DECLARE type positions remain type expectations", () => {
        const e = expectation("DECLARE @x /*caret*/");

        expect(e.kind).to.equal("typeName");
        expect(e.context.kind).to.equal("declareType");
    });

    test("table variable column names are declaration symbols", () => {
        const e = expectation("DECLARE @t TABLE (/*caret*/)");

        expect(e.kind).to.equal("declarationName");
    });

    test("table variable column names after commas are declaration symbols", () => {
        const e = expectation("DECLARE @t TABLE (Id int, /*caret*/)");

        expect(e.kind).to.equal("declarationName");
    });

    test("CREATE TABLE column types remain type expectations", () => {
        const e = expectation("CREATE TABLE dbo.T (Id i/*caret*/)");

        expect(e.kind).to.equal("typeName");
        expect(e.context).to.deep.equal({ kind: "declareType", prefix: "i" });
    });

    test("CREATE TABLE later column types remain type expectations", () => {
        const e = expectation("CREATE TABLE dbo.T (Id int, Name nvar/*caret*/)");

        expect(e.kind).to.equal("typeName");
        expect(e.context).to.deep.equal({ kind: "declareType", prefix: "nvar" });
    });

    test("ALTER TABLE ADD column names are declaration symbols", () => {
        const e = expectation("ALTER TABLE Sales.Orders ADD NewColumn/*caret*/");

        expect(e.kind).to.equal("declarationName");
    });

    test("ALTER TABLE ADD COLUMN column names are declaration symbols", () => {
        const e = expectation("ALTER TABLE Sales.Orders ADD COLUMN NewColumn/*caret*/");

        expect(e.kind).to.equal("declarationName");
    });

    test("ALTER TABLE ADD column types remain type expectations", () => {
        const e = expectation("ALTER TABLE Sales.Orders ADD NewColumn nvar/*caret*/");

        expect(e.kind).to.equal("typeName");
        expect(e.context).to.deep.equal({ kind: "declareType", prefix: "nvar" });
    });

    test("ALTER TABLE ADD COLUMN column types remain type expectations", () => {
        const e = expectation("ALTER TABLE Sales.Orders ADD COLUMN NewColumn dec/*caret*/");

        expect(e.kind).to.equal("typeName");
        expect(e.context).to.deep.equal({ kind: "declareType", prefix: "dec" });
    });
});
