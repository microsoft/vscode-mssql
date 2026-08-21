/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import type { TsqlFeatureProfile } from "../../../../src/index.ts";
import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("json.sql", profile(17, 170));

suite("T-SQL SQL/JSON grammar", () => {
    // Verifies SQL Server 2022 object/array constructors preserve key separators and null clauses.
    test("parses JSON object and array constructors", () => {
        const snapshot = parse(`
SELECT JSON_OBJECT('name':u.name, 'roles':JSON_ARRAY('admin', NULL ABSENT ON NULL));
SELECT JSON_OBJECT(NULL ON NULL), JSON_ARRAY(ABSENT ON NULL);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /JsonObjectMember/);
        assert.match(snapshot.tree.toString(), /JsonNullClause/);
    });

    // Verifies SQL Server 2025 aggregate constructors own ORDER BY, RETURNING, and OVER syntax.
    test("parses JSON aggregate constructors", () => {
        const snapshot = parse(`
SELECT JSON_OBJECTAGG(t.name:t.value NULL ON NULL RETURNING JSON)
  OVER (PARTITION BY t.group_id)
FROM dbo.t AS t;
SELECT JSON_ARRAYAGG(t.name ORDER BY t.ordinal DESC ABSENT ON NULL RETURNING JSON)
  OVER (PARTITION BY t.group_id)
FROM dbo.t AS t;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(
            (snapshot.tree.toString().match(/JsonAggregateExpression\(/g) ?? []).length,
            2,
        );
    });

    // Verifies SQL Server 2025 JSON_QUERY and JSON_VALUE extensions remain inside their calls.
    test("parses JSON query and scalar returning clauses", () => {
        const snapshot = parse(`
SELECT JSON_QUERY(@doc, '$.items' WITH ARRAY WRAPPER);
SELECT JSON_VALUE(@doc, '$.count' RETURNING INT);`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /JsonArrayWrapperClause/);
        assert.match(snapshot.tree.toString(), /JsonValueReturningClause/);
    });

    test("parses correlated JSON rowsets and nested extraction", () => {
        const snapshot = parse(`
SELECT JSON_VALUE(userRow.value, '$.id'), roleRow.value
FROM OPENJSON(@json, '$.users') AS userRow
CROSS APPLY OPENJSON(JSON_QUERY(userRow.value, '$.roles')) AS roleRow;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.match(snapshot.tree.toString(), /ApplyJoin/);
    });

    test("parses JSON extraction from temp-table columns", () => {
        const snapshot = parse(`
CREATE TABLE #products (id int, document nvarchar(max));
INSERT INTO #products VALUES (1, N'{"brand":"Contoso","specs":{"ram":"16GB"}}');
SELECT JSON_VALUE(document, '$.brand'), JSON_QUERY(document, '$.specs')
FROM #products
WHERE JSON_VALUE(document, '$.specs.ram') IS NOT NULL;
DROP TABLE #products;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
    });

    // Verifies constructor punctuation errors are visible instead of falling into generic calls.
    test("reports malformed JSON constructor members", () => {
        const snapshot = parse("SELECT JSON_OBJECT('name' u.name); ");

        assert.deepEqual(
            snapshot.diagnostics.map((diagnostic) => diagnostic.message),
            ["Incorrect syntax near 'u'."],
        );
    });

    // Verifies compatibility profiles gate 2022 constructors and 2025 aggregate extensions.
    test("gates SQL/JSON features by compatibility level", () => {
        const sql2022 = parse("SELECT JSON_OBJECT('a':1);", profile(15, 150));
        const sql2025 = parse("SELECT JSON_ARRAYAGG(a RETURNING JSON) FROM t;", profile(16, 160));

        assert.ok(sql2022.diagnostics.some((diagnostic) => diagnostic.message.includes("JSON")));
        assert.ok(sql2025.diagnostics.some((diagnostic) => diagnostic.message.includes("JSON")));
    });
});

function profile(
    serverMajorVersion: TsqlFeatureProfile["serverMajorVersion"],
    compatibilityLevel: TsqlFeatureProfile["compatibilityLevel"],
): TsqlFeatureProfile {
    return {
        serverMajorVersion,
        compatibilityLevel,
        engineProfile: "sql-server",
        previewFeatures: false,
    };
}
