/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    ImmutableTextSnapshot,
    LezerSyntaxService,
    applyTextChanges,
} = require("../../../dist/index.js");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("specialized-index.sql");

suite("T-SQL XML, spatial, and full-text grammar", () => {
    // Verifies primary and secondary XML indexes retain source index type and options.
    test("parses XML indexes", () => {
        const snapshot = parse(`
CREATE PRIMARY XML INDEX c1 ON db..t1(c1) WITH (PAD_INDEX = ON, FILLFACTOR = 23);
CREATE XML INDEX c2 ON db..t1(c1) USING XML INDEX c1 FOR PATH WITH (MAXDOP = 10);
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/XmlIndexStatement\(/g) ?? []).length, 2);
        assert.match(snapshot.tree.toString(), /Using,Xml,Index/);
    });

    // Verifies selective XML paths retain XQUERY/SQL typing, maximum length, and singleton flags.
    test("parses selective XML indexes", () => {
        const snapshot = parse(`
CREATE SELECTIVE XML INDEX sxi1 ON t1(c1) FOR (
    path1 = '/a/b/c' AS XQUERY 'xs:string' MAXLENGTH(50) SINGLETON,
    path2 = '/d/e' AS SQL NVARCHAR(50)
);
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/SelectiveXmlPath\(/g) ?? []).length, 2);
        assert.match(snapshot.tree.toString(), /MaxLengthClause\(/);
    });

    // Verifies spatial tessellation and nested bounding-box/grid options remain structured.
    test("parses spatial indexes", () => {
        const snapshot = parse(`
CREATE SPATIAL INDEX sp1 ON a..c(d) USING GEOMETRY_GRID WITH (
    BOUNDING_BOX = (XMIN = 2, YMIN = 4, XMAX = 6, YMAX = 8),
    GRIDS = (LOW, HIGH, MEDIUM, HIGH)
);
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /SpatialIndexStatement\(/);
        // An index WITH list is a list of IndexOption, so that ORDER(a, b) — which names columns
        // rather than taking a value — has somewhere to live. Each option that does take a nested
        // list still keeps it structured, which is what this fixture is here to hold in place.
        assert.equal((tree.match(/IndexOption\(/g) ?? []).length, 2);
        assert.equal((tree.match(/GenericOptionList\(/g) ?? []).length, 2);
    });

    // Verifies full-text catalog, stoplist, index, alteration, and drop forms have explicit nodes.
    test("parses full-text object families", () => {
        const snapshot = parse(`
CREATE FULLTEXT CATALOG c1 ON [PRIMARY] WITH ACCENT_SENSITIVITY = ON AS DEFAULT;
CREATE FULLTEXT STOPLIST fs1 FROM SYSTEM STOPLIST AUTHORIZATION dbo;
CREATE FULLTEXT INDEX ON dbo.Items(Name LANGUAGE English) KEY INDEX PK_Items ON c1
WITH (CHANGE_TRACKING = AUTO, STOPLIST = SYSTEM);
ALTER FULLTEXT INDEX ON dbo.Items DISABLE;
DROP FULLTEXT INDEX ON dbo.Items;
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/FullTextStatement\(/g) ?? []).length, 5);
        assert.match(snapshot.tree.toString(), /FullTextColumn\(/);
    });

    // Verifies missing XML-index targets remain visible at the exact terminator.
    test("reports malformed XML index syntax", () => {
        const sql = "CREATE PRIMARY XML INDEX c1 ON ;";
        const snapshot = parse(sql);
        const semicolon = sql.indexOf(";");

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(snapshot.diagnostics.some((diagnostic) => diagnostic.range.start === semicolon));
    });

    // Verifies incomplete spatial option values never become accepted generic text.
    test("reports malformed spatial options", () => {
        const snapshot = parse("CREATE SPATIAL INDEX sp ON dbo.T(shape) WITH (BOUNDING_BOX = );");

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies native reuse in nested spatial options exactly matches a fresh parse.
    test("keeps specialized-index incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const sql = "CREATE SPATIAL INDEX sp ON dbo.T(shape) WITH (CELLS_PER_OBJECT = 8);";
        const firstDocument = new ImmutableTextSnapshot("file:///indexes.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.lastIndexOf("8");
        const change = { start, end: start + 1, text: "16" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.ok(incremental.statistics.reusableFragmentCount > 0);
        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });
});
