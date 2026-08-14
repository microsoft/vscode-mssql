/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const { ImmutableTextSnapshot, LezerSyntaxService } = require("../dist/index.js");

suite("T-SQL structural grammar regressions", () => {
    // ScriptDOM graph fixtures define named and unnamed edge-connection constraints.
    test("parses graph edge constraints", () => {
        const snapshot = parse(`
CREATE TABLE dbo.EdgeTable (
    CONSTRAINT EC CONNECTION (dbo.NodeA TO dbo.NodeB, dbo.NodeC TO dbo.NodeD)
        ON DELETE CASCADE
) AS EDGE;
ALTER TABLE dbo.EdgeTable ADD CONNECTION (dbo.NodeA TO dbo.NodeB);
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/GraphConnection\(/g) ?? []).length, 3);
    });

    // ScriptDOM ALTER TABLE fixtures combine attribute toggles and table-level defaults.
    test("parses advanced ALTER TABLE column and constraint forms", () => {
        const snapshot = parse(`
ALTER TABLE dbo.Sample ALTER COLUMN Secret ADD MASKED WITH (FUNCTION = 'default()');
ALTER TABLE dbo.Sample ALTER COLUMN RowId DROP ROWGUIDCOL WITH (ONLINE = ON);
ALTER TABLE dbo.Sample WITH CHECK ADD
    CONSTRAINT CK_Positive CHECK (Amount > 0),
    CONSTRAINT DF_Amount DEFAULT 2 FOR Amount WITH VALUES;
ALTER TABLE dbo.Sample DROP CONSTRAINT CK_Positive
    WITH (WAIT_AT_LOW_PRIORITY (MAX_DURATION = 10 MINUTES, ABORT_AFTER_WAIT = NONE));
`);

        assertValid(snapshot);
        assert.equal((snapshot.tree.toString().match(/AlterTableStatement\(/g) ?? []).length, 4);
    });

    // ScriptDOM expression fixtures use binary DEFAULTs, money literals, COLLATE, and LEFT/RIGHT.
    test("parses complete scalar default and keyword-built-in expressions", () => {
        const snapshot = parse(`
CREATE TABLE dbo.Expressions (
    Amount int DEFAULT c1 + c2 - c3 & 10 | 20 ^ c4 * 12,
    Price money DEFAULT -$10
);
SELECT USER COLLATE SQL_Latin1_General_CP1_CI_AS,
    LEFT('language', 4), RIGHT('service', 3);
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /MoneyLiteral/);
        assert.equal((tree.match(/KeywordFunctionCall\(/g) ?? []).length, 2);
    });

    // ScriptDOM security fixtures use column permissions, omitted parts, and multiword classes.
    test("parses complete permission and securable shapes", () => {
        const snapshot = parse(`
GRANT VIEW DEFINITION CONTROL CREATE ALTER (c1, c2)
    ON Application Role::a.b..d
    TO public, NULL, [user1] WITH GRANT OPTION AS dbo;
ALTER AUTHORIZATION ON Service::..ProductionService TO SCHEMA OWNER;
ALTER AUTHORIZATION ON Availability Group::ag1 TO [owner];
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /OmittedTableSourceName/);
    });

    // ScriptDOM source fixtures cover omitted components, legacy hints, and grouped joins.
    test("parses legacy and grouped table sources", () => {
        const snapshot = parse(`
SELECT * FROM .[MyDatabase].dbo.Source;
SELECT * FROM (dbo.LeftTable CROSS JOIN dbo.RightTable);
SELECT * FROM dbo.Source s (HOLDLOCK NOWAIT), dbo.Other WITH (INDEX = 0);
SELECT * FROM ::LegacyRows(1, NULL, DEFAULT) AS r;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /ParenthesizedTableSource/);
        assert.match(tree, /GlobalFunctionTableSource/);
    });

    // Synapse-compatible CTAS options remain structured so flavor gates can report them precisely.
    test("parses structured CTAS table options", () => {
        const snapshot = parse(`
CREATE TABLE dbo.Fact
WITH (DISTRIBUTION = HASH(Id), CLUSTERED INDEX(Id))
AS SELECT Id FROM dbo.Source;
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /TableOptionClause/);
    });
});

function assertValid(snapshot) {
    assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
    assert.deepEqual(snapshot.diagnostics, []);
}

function parse(sql) {
    return new LezerSyntaxService().parse(
        new ImmutableTextSnapshot("file:///structural-regression.sql", 1, sql),
    );
}
