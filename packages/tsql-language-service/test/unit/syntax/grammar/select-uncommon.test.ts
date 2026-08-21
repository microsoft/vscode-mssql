/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("select-uncommon.sql");

suite("T-SQL uncommon SELECT grammar", () => {
    // Verifies full-text table functions preserve column targets, LANGUAGE, TOP_N, and aliases.
    test("parses full-text table rowsets", () => {
        const snapshot = parse(`
SELECT k.[KEY], k.RANK
FROM CONTAINSTABLE(dbo.Documents, (Title, Body), 'release NEAR notes', LANGUAGE 1033, 25) AS k;
SELECT k.[KEY]
FROM FREETEXTTABLE(dbo.Documents, *, 'language service') AS k;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/FullTextTableSource\(/g) ?? []).length, 2);
    });

    // Verifies OPENQUERY and OPENDATASOURCE retain linked-server and remote-object syntax.
    test("parses pass-through and ad hoc rowsets", () => {
        const snapshot = parse(`
SELECT * FROM OPENQUERY(Reporting, 'SELECT id FROM dbo.t') AS q;
SELECT * FROM OPENDATASOURCE('MSOLEDBSQL', 'Server=s;Trusted_Connection=yes').db.dbo.t AS d;
SELECT * FROM OPENDATASOURCE('Microsoft.Jet.OLEDB.4.0', 'Data Source=x.xls')...Sheet1;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /OpenQuerySource/);
        assert.equal((snapshot.tree.toString().match(/OpenDataSourceSource\(/g) ?? []).length, 2);
    });

    // Verifies OPENXML supports inline mappings and table-shaped WITH clauses.
    test("parses OPENXML rowsets", () => {
        const snapshot = parse(`
SELECT * FROM OPENXML(@doc, '/root/item', 2)
WITH (id INT '@id', body NVARCHAR(MAX) 'text()') AS x;
SELECT * FROM OPENXML(@doc, '/root/item') WITH dbo.XmlShape AS x;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/OpenXmlSource\(/g) ?? []).length, 2);
    });

    // Verifies provider, semicolon credential, and ordered BULK OPENROWSET variants.
    test("parses OPENROWSET provider and BULK forms", () => {
        const snapshot = parse(`
SELECT * FROM OPENROWSET('MSOLEDBSQL', N'server';'user';'password',
  'SELECT id FROM dbo.t') AS r;
SELECT * FROM OPENROWSET(BULK 'input.csv', SINGLE_CLOB, ORDER(id ASC, stamp DESC) UNIQUE) AS r;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/OpenRowsetSource\(/g) ?? []).length, 2);
    });

    // Verifies deprecated outer-join operators, COMPUTE, and string aliases remain recoverable syntax.
    test("parses legacy SELECT forms", () => {
        const snapshot = parse(`
SELECT t1.id 'legacy alias' FROM t1, t2 WHERE t1.id *= t2.id;
SELECT t1.id N'unicode alias' FROM t1, t2 WHERE t1.id =* t2.id;
SELECT category, amount FROM sales ORDER BY category
COMPUTE SUM(amount), AVG(amount) BY category;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /ComputeChunk/);
        assert.match(snapshot.tree.toString(), /EqualStar/);
    });

    // Verifies incomplete rowset calls report their exact trailing token.
    test("reports incomplete uncommon rowsets", () => {
        const snapshot = parse("SELECT * FROM OPENQUERY(server1,);");

        assert.deepEqual(
            snapshot.diagnostics.map((diagnostic) => diagnostic.message),
            ["Incorrect syntax near ')'."],
        );
    });
});
