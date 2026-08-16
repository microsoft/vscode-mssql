/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { LezerSyntaxService } = require("../../../dist/index.js");
const {
    assertIncrementalEquivalent,
    createSyntaxHarness,
} = require("../../support/syntaxHarness.js");
const { assertValid, document, parse } = createSyntaxHarness("index-order.sql");

suite("T-SQL columnstore index ORDER grammar", () => {
    // The ORDER list follows the key and INCLUDE lists and precedes the filter and options.
    test("parses the ORDER list in every valid position", () => {
        const tree = assertValid(`
CREATE CLUSTERED COLUMNSTORE INDEX CCI ON dbo.Sales ORDER (Region, SoldOn DESC);
CREATE NONCLUSTERED COLUMNSTORE INDEX NCI ON dbo.Sales (Region) ORDER (Region ASC) WITH (MAXDOP = 2) ON [PRIMARY];
CREATE NONCLUSTERED INDEX IX ON dbo.Sales (Region) INCLUDE (Total) ORDER (Total) WHERE Region > 0;
`).tree.toString();
        assert.equal((tree.match(/IndexOrderClause\(/g) ?? []).length, 3);
        assert.equal((tree.match(/IndexOrderColumn\(/g) ?? []).length, 4);
    });

    // Each order column keeps its own identifier node so a validator can range one column.
    test("keeps each order column separately addressable", () => {
        const tree = assertValid(
            "CREATE CLUSTERED COLUMNSTORE INDEX CCI ON dbo.Sales ORDER ([Sold On], Region);",
        ).tree.toString();
        assert.match(
            tree,
            /IndexOrderClause\(Order,OpenParen,IndexOrderColumn\(IdentifierName\(BracketedIdentifier\)\),Comma,IndexOrderColumn\(IdentifierName\(Identifier\)\),CloseParen\)/,
        );
    });

    // An index without an ORDER list is unchanged, including the storage clause that follows.
    test("leaves indexes without an ORDER list unchanged", () => {
        const tree = assertValid(`
CREATE NONCLUSTERED INDEX IX ON dbo.Sales (Region) INCLUDE (Total) WHERE Region > 0
    WITH (ONLINE = ON) ON [PRIMARY];
`).tree.toString();
        assert.equal((tree.match(/IndexOrderClause\(/g) ?? []).length, 0);
        assert.match(tree, /IndexStorageClause\(/);
    });

    // ORDER BY inside an ordinary query is untouched by the new clause.
    test("does not change ORDER BY in a query", () => {
        const tree = assertValid("SELECT Region FROM dbo.Sales ORDER BY Region;").tree.toString();
        assert.equal((tree.match(/IndexOrderClause\(/g) ?? []).length, 0);
        assert.match(tree, /OrderByClause\(/);
    });

    // Incomplete typing stays visible as recovery rather than reshaping the statement.
    test("keeps incomplete ORDER input visible", () => {
        for (const sql of [
            "CREATE CLUSTERED COLUMNSTORE INDEX CCI ON dbo.Sales ORDER (",
            "CREATE CLUSTERED COLUMNSTORE INDEX CCI ON dbo.Sales ORDER (Region,",
        ]) {
            const snapshot = parse(sql);
            assert.ok(snapshot.statistics.rawErrorNodeCount > 0, sql);
            assert.match(snapshot.tree.toString(), /CreateIndexStatement\(/, sql);
        }
    });

    // Recovery inside the ORDER list does not consume the following batch.
    test("recovers without losing the next batch", () => {
        const snapshot = parse(`CREATE CLUSTERED COLUMNSTORE INDEX CCI ON dbo.Sales ORDER (,
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
CREATE CLUSTERED COLUMNSTORE INDEX CCI ON dbo.Sales ORDER (Region);
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
                    start: first.indexOf("(Region)"),
                    end: first.indexOf("(Region)") + "(Region)".length,
                    text: "(Region, SoldOn DESC)",
                },
            ],
        });
    });
});
