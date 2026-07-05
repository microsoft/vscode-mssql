/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B9 / LS-1 sketch parser suite — the spec §5.2 "why a FROM/WHERE scanner is
 * not enough" cases plus the statement families completions need. The sketch
 * must be TOTAL (mid-edit fragments still sketch).
 */

import { expect } from "chai";
import { lex } from "../../src/sqlLanguage/core/lexer";
import { segment } from "../../src/sqlLanguage/core/segmenter";
import { StatementSketch, sketchStatement } from "../../src/sqlLanguage/core/sketch";

function sketch(text: string, statementIndex: number = 0): StatementSketch {
    const { tokens } = lex(text);
    const batches = segment(text, tokens).batches;
    const statements = batches.flatMap((b) => b.statements);
    expect(statements.length).to.be.greaterThan(statementIndex);
    return sketchStatement(text, tokens, statements[statementIndex]);
}

suite("sqlLanguage sketch parser", () => {
    test("alias to the RIGHT of an incomplete member access is still known", () => {
        const s = sketch("SELECT o. FROM Sales.Orders AS o;");
        expect(s.kind).to.equal("select");
        const orders = s.sources.find((src) => src.parts.join(".") === "Sales.Orders");
        expect(orders).to.not.equal(undefined);
        expect(orders!.alias).to.equal("o");
        expect(orders!.scopeId).to.equal(0);
    });

    test("CTE with declared columns; outer FROM sees the CTE name", () => {
        const s = sketch(
            "WITH recent(OrderID, CustomerID) AS (SELECT 1, 2) SELECT r.OrderID FROM recent r",
        );
        expect(s.ctes).to.have.length(1);
        expect(s.ctes[0].name).to.equal("recent");
        expect(s.ctes[0].columns).to.deep.equal(["OrderID", "CustomerID"]);
        expect(s.ctes[0].bodyScopeId).to.not.equal(undefined);
        const outer = s.sources.find((src) => src.parts[0] === "recent");
        expect(outer?.alias).to.equal("r");
        expect(outer?.scopeId).to.equal(0);
    });

    test("correlated subquery gets its own scope with its own source", () => {
        const s = sketch(
            "SELECT * FROM Sales.Orders o WHERE EXISTS (SELECT 1 FROM Sales.OrderLines l WHERE l.OrderID = o.OrderID)",
        );
        expect(s.scopes.length).to.equal(2);
        const inner = s.sources.find((src) => src.parts.join(".") === "Sales.OrderLines");
        expect(inner?.scopeId).to.equal(1);
        expect(inner?.alias).to.equal("l");
        expect(s.scopes[1].parentId).to.equal(0);
        const outer = s.sources.find((src) => src.parts.join(".") === "Sales.Orders");
        expect(outer?.scopeId).to.equal(0);
    });

    test("derived table: inner scope + alias on the outside", () => {
        const s = sketch("SELECT d.x FROM (SELECT OrderID AS x FROM Sales.Orders) AS d");
        const derived = s.sources.find((src) => src.kind === "derived");
        expect(derived?.alias).to.equal("d");
        expect(derived?.innerScopeId).to.equal(1);
        const innerItems = s.selectItems.filter((it) => it.scopeId === 1);
        expect(innerItems).to.have.length(1);
        expect(innerItems[0].alias).to.equal("x");
    });

    test("UPDATE alias form records target + FROM sources", () => {
        const s = sketch(
            "UPDATE o SET o.Comments = 'x' FROM Sales.Orders o JOIN Sales.Customers c ON c.CustomerID = o.CustomerID",
        );
        expect(s.kind).to.equal("update");
        expect(s.target?.parts).to.deep.equal(["o"]);
        expect(s.target?.isAliasForm).to.equal(true);
        expect(s.sources.map((x) => x.alias)).to.include.members(["o", "c"]);
        expect(s.clauses.some((c) => c.kind === "setAssignments")).to.equal(true);
        expect(s.clauses.some((c) => c.kind === "on")).to.equal(true);
    });

    test("INSERT with column list and VALUES clause", () => {
        const s = sketch("INSERT INTO Sales.Orders (OrderID, CustomerID) VALUES (1, 2)");
        expect(s.kind).to.equal("insert");
        expect(s.target?.parts).to.deep.equal(["Sales", "Orders"]);
        expect(s.insertColumns?.names).to.deep.equal(["OrderID", "CustomerID"]);
        expect(s.clauses.some((c) => c.kind === "values")).to.equal(true);
    });

    test("INSERT ... SELECT parses the source query into the same statement", () => {
        const s = sketch("INSERT dbo.Archive SELECT OrderID FROM Sales.Orders WHERE OrderID > 5");
        expect(s.target?.parts).to.deep.equal(["dbo", "Archive"]);
        expect(s.sources.some((src) => src.parts.join(".") === "Sales.Orders")).to.equal(true);
        expect(s.clauses.some((c) => c.kind === "where")).to.equal(true);
    });

    test("EXEC with named and positional args", () => {
        const s = sketch("EXEC Sales.GetOrders @CustomerID = 42, 7, @Total = @t OUTPUT");
        expect(s.kind).to.equal("exec");
        expect(s.exec?.procParts).to.deep.equal(["Sales", "GetOrders"]);
        expect(s.exec?.args.map((a) => a.name)).to.deep.equal(["@CustomerID", undefined, "@Total"]);
    });

    test("EXEC ('dynamic') is opaque — no proc claim", () => {
        const s = sketch("EXEC ('SELECT 1')");
        expect(s.exec).to.equal(undefined);
    });

    test("DECLARE scalar and table variable with columns", () => {
        const s = sketch("DECLARE @id int = 5, @name nvarchar(50)");
        expect(s.declares.map((d) => d.name)).to.deep.equal(["@id", "@name"]);
        expect(s.declares[0].typeText).to.equal("int");

        const t = sketch("DECLARE @t TABLE (OrderID int PRIMARY KEY, Qty int)");
        expect(t.declares).to.have.length(1);
        expect(t.declares[0].isTable).to.equal(true);
        expect(t.declares[0].tableColumns).to.deep.equal(["OrderID", "Qty"]);
    });

    test("CREATE TABLE #temp records columns, skipping constraints", () => {
        const s = sketch(
            "CREATE TABLE #tmp (Id int NOT NULL, Name nvarchar(10), CONSTRAINT PK_t PRIMARY KEY (Id))",
        );
        expect(s.kind).to.equal("createTable");
        expect(s.createdTable?.parts).to.deep.equal(["#tmp"]);
        expect(s.createdTable?.columns).to.deep.equal(["Id", "Name"]);
    });

    test("SELECT INTO #temp records the target", () => {
        const s = sketch("SELECT OrderID, CustomerID INTO #recent FROM Sales.Orders");
        expect(s.selectInto?.parts).to.deep.equal(["#recent"]);
        expect(s.sources.some((src) => src.parts.join(".") === "Sales.Orders")).to.equal(true);
    });

    test("USE records the database", () => {
        expect(sketch("USE AdventureWorks").useDatabase).to.equal("AdventureWorks");
    });

    test("star items and qualified stars are flagged", () => {
        const s = sketch("SELECT o.*, 1 AS one FROM Sales.Orders o");
        const star = s.selectItems.find((it) => it.isStar);
        expect(star?.starQualifier).to.equal("o");
        const one = s.selectItems.find((it) => it.alias === "one");
        expect(one).to.not.equal(undefined);
    });

    test("TVF source with alias", () => {
        const s = sketch("SELECT f.OrderID FROM dbo.OrdersByCustomer(42) AS f");
        const tvf = s.sources.find((src) => src.kind === "tvf");
        expect(tvf?.parts).to.deep.equal(["dbo", "OrdersByCustomer"]);
        expect(tvf?.alias).to.equal("f");
    });

    test("table hints do not become aliases", () => {
        const s = sketch("SELECT * FROM Sales.Orders WITH (NOLOCK) WHERE OrderID = 1");
        const src = s.sources[0];
        expect(src.alias).to.equal(undefined);
        expect(s.clauses.some((c) => c.kind === "where")).to.equal(true);
    });

    test("mid-edit fragments still sketch (total parser)", () => {
        const s = sketch("SELECT o. FROM ");
        expect(s.kind).to.equal("select");
        expect(s.clauses.some((c) => c.kind === "selectList")).to.equal(true);

        const t = sketch("SELECT * FROM Sales.Orders o JOIN Sales.Customers c ON ");
        expect(t.sources.map((x) => x.alias)).to.deep.equal(["o", "c"]);
        expect(t.clauses.some((c) => c.kind === "on")).to.equal(true);
    });
});
