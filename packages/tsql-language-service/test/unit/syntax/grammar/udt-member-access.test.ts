/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import { LezerSyntaxService } from "../../../../src/index.ts";
import { assertIncrementalEquivalent, createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, document, parse } = createSyntaxHarness("udt-member-access.sql");

suite("T-SQL UDT member access grammar", () => {
    // A member with an argument list is a call; without one it is a property or field.
    test("separates method calls from data members", () => {
        const tree = assertValid(`
SELECT @point.Distance(@other);
SELECT @point.X;
SELECT @xml.query('.');
`).tree.toString();
        assert.equal((tree.match(/FunctionMemberCall\(/g) ?? []).length, 2);
        assert.equal((tree.match(/UdtDataMemberCall\(/g) ?? []).length, 1);
        assert.equal((tree.match(/VariableMemberExpression\(/g) ?? []).length, 3);
    });

    // The :: operator reaches static members of a type, with or without an argument list.
    test("parses static member access through a type", () => {
        const tree = assertValid(`
SELECT geometry::Parse('POINT(0 0)');
SELECT dbo.Point::Origin;
SELECT db.dbo.Point::Parse();
`).tree.toString();
        assert.equal((tree.match(/UdtStaticMemberExpression\(/g) ?? []).length, 3);
        // A static member without an argument list keeps exactly the type, the operator, and the name.
        assert.match(
            tree,
            /UdtStaticMemberExpression\(MultipartIdentifier\(IdentifierName\(Identifier\),Dot,IdentifierName\(Identifier\)\),DoubleColon,IdentifierName\(Identifier\)\)/,
        );
    });

    // Members chain, and a static member may be followed by instance access.
    test("parses chained member access", () => {
        const tree = assertValid(`
SELECT @point.Origin.X;
SELECT dbo.Point::Origin.Distance(1);
`).tree.toString();
        // A static member names itself directly, so only the two instance links are member calls.
        assert.equal((tree.match(/UdtDataMemberCall\(/g) ?? []).length, 2);
        assert.equal((tree.match(/FunctionMemberCall\(/g) ?? []).length, 1);
    });

    // A function result may expose fields before a later method call, as in f().g.h.k(...).l.
    test("parses data-member tails after a function call", () => {
        const tree = assertValid("SELECT a.b.c.d.f().g.h.k(1, 2, DEFAULT).l;").tree.toString();
        assert.equal((tree.match(/FunctionMemberCall\(/g) ?? []).length, 1);
        assert.equal((tree.match(/UdtDataMemberCall\(/g) ?? []).length, 3);
    });

    // ScriptDOM accepts a collation between two CLR/UDT property accesses, including a final
    // collation on the resulting property.
    test("parses collated CLR member chains", () => {
        const tree = assertValid(
            "SELECT c1.f1().SomeProperty COLLATE Albanian_BIN .AnotherProperty COLLATE Albanian_BIN;",
        ).tree.toString();
        assert.equal((tree.match(/CollateClause\(/g) ?? []).length, 2);
        assert.equal((tree.match(/UdtDataMemberCall\(/g) ?? []).length, 2);
    });

    // Omitted server/schema components and the reserved ROWGUIDCOL pseudo-column remain valid in
    // SELECT projections when their bounded projection forms are used.
    test("parses omitted qualified stars and ROWGUIDCOL projections", () => {
        const tree = assertValid("SELECT ..t1.*, master..t1.Rowguidcol;").tree.toString();
        assert.match(tree, /OmittedTableSourceName\(/);
        assert.match(tree, /Dot,Star/);
        assert.match(tree, /RowguidReference\(/);
    });

    // An ordinary multipart column reference is untouched by the new member forms.
    test("leaves ordinary column references unchanged", () => {
        const tree = assertValid(`
SELECT a.b FROM dbo.t AS a;
SELECT db.dbo.t.c FROM db.dbo.t;
SELECT dbo.Fn(1);
`).tree.toString();
        assert.equal((tree.match(/UdtStaticMemberExpression\(/g) ?? []).length, 0);
        assert.equal((tree.match(/UdtDataMemberCall\(/g) ?? []).length, 0);
        assert.match(tree, /ColumnReference\(/);
        assert.match(tree, /FunctionCall\(/);
    });

    // Incomplete typing stays visible as recovery rather than reshaping the expression.
    test("keeps incomplete member input visible", () => {
        for (const sql of ["SELECT @point.", "SELECT dbo.Point::", "SELECT @point.Distance("]) {
            const snapshot = parse(sql);
            assert.ok(snapshot.statistics.rawErrorNodeCount > 0, sql);
            assert.match(snapshot.tree.toString(), /SelectStatement\(/, sql);
        }
    });

    // Recovery inside a member expression does not consume the following batch.
    test("recovers without losing the next batch", () => {
        const snapshot = parse(`SELECT dbo.Point::
GO
SELECT 1;
`);
        assert.equal(snapshot.statistics.batchCount, 2);
        assert.match(snapshot.tree.toString(), /SelectStatement\(/);
    });

    // Incremental parsing of the same final text must equal a fresh parse.
    test("keeps incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const first = `SELECT 1;
GO
SELECT @point.X;
GO
SELECT 2;
`;
        const previousDocument = document(1, first);
        assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot: service.parse(previousDocument),
            version: 2,
            // The script is one safe batch group, so the invariant under test is that the
            // incremental tree, diagnostics, and tokens equal a fresh parse.
            assertReuse: false,
            changes: [
                {
                    start: first.indexOf("@point.X") + "@point.".length,
                    end: first.indexOf("@point.X") + "@point.X".length,
                    text: "Distance(1)",
                },
            ],
        });
    });
});
