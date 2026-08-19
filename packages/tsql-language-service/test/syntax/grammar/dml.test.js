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
const { parse } = createSyntaxHarness("dml.sql");

suite("T-SQL data-modification grammar", () => {
    // Verifies INSERT accepts VALUES rows while retaining target columns and DEFAULT cells.
    test("parses INSERT VALUES", () => {
        const snapshot = parse(`
INSERT INTO sales.Orders (UserId, Total, Note)
VALUES (1, 42.00, DEFAULT), (2, 84.00, N'next');
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /InsertStatement\(/);
        assert.match(snapshot.tree.toString(), /ValuesInsertSource\(/);
    });

    // Verifies DEFAULT VALUES is a complete INSERT source rather than a suppressed incomplete form.
    test("parses INSERT DEFAULT VALUES", () => {
        const snapshot = parse("INSERT dbo.Audit DEFAULT VALUES;");
        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /InsertSource\(Default,Values\)/);
    });

    // Verifies INSERT EXEC and query INSERT sources are modeled as distinct source nodes.
    test("parses INSERT EXEC and INSERT SELECT", () => {
        const snapshot = parse(`
INSERT dbo.Target (Id) EXEC dbo.read_rows @minimum = 1;
INSERT dbo.Target (Id) SELECT Id FROM dbo.Source WHERE Id > 1;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /InsertSource\(ExecuteStatement\(/);
        assert.match(tree, /InsertSource\(InsertQuerySource\(/);
        assert.match(tree, /NamedExecuteArgument\(/);
    });

    // INSERT target columns accept the omitted multipart names used by the ScriptDOM corpus.
    //
    // A named target keeps its parentheses as a callable argument list, so its columns arrive as
    // column references; a variable or OPENROWSET target has no callable form, so its columns
    // arrive as InsertColumn. Both paths reach the same omitted-component names.
    test("parses omitted and triple-dot INSERT column names", () => {
        const snapshot = parse(`
INSERT ..t1 (c1, a.b.c.d, a...d, .c.d) SELECT * FROM t2;
INSERT @v1 (..a1) DEFAULT VALUES;
INSERT OPENROWSET(something, @var1) (..a1, b.c) DEFAULT VALUES;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/TripleOmittedName\(/g) ?? []).length, 1);
        assert.equal((tree.match(/ColumnReference\(OmittedTableSourceName/g) ?? []).length, 1);
        assert.equal((tree.match(/InsertColumn\(OmittedTableSourceName/g) ?? []).length, 2);
    });

    // `a...d` is a column reference wherever one is read, not only inside an INSERT.
    test("parses a two-omitted-component column name", () => {
        const snapshot = parse("SELECT a...d FROM t1 WHERE x...y = 1;");

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/TripleOmittedName\(/g) ?? []).length, 2);
    });

    // ScriptDOM permits a parenthesized query as an INSERT source, including a grouped UNION.
    test("parses parenthesized INSERT query sources", () => {
        const snapshot = parse(`
INSERT table1 (c2, c3) (SELECT * FROM t1);
INSERT @v1 (..a1) ((SELECT * FROM t1) UNION SELECT * FROM t2);
`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/InsertQueryExpression\(/g) ?? []).length, 2);
        assert.equal((tree.match(/ParenthesizedQuery\(/g) ?? []).length, 3);
    });

    // Verifies INSERT cannot end after its target column list without an explicit source.
    test("reports a missing INSERT source", () => {
        const snapshot = parse("INSERT dbo.t (a);");
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near ';'.",
                severity: "error",
                range: { start: 16, end: 17 },
            },
        ]);
    });

    // Verifies UPDATE supports compound assignments, OUTPUT, joined sources, and filtering.
    test("parses UPDATE with OUTPUT and FROM", () => {
        const snapshot = parse(`
UPDATE target
SET Total += source.Delta, Modified = CURRENT_TIMESTAMP
OUTPUT inserted.Id, deleted.Total
FROM sales.Orders AS target
JOIN sales.Changes AS source ON source.Id = target.Id
WHERE target.Active = 1;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /UpdateStatement\(/);
        assert.match(tree, /PlusEqual/);
        assert.match(tree, /OutputClause\(/);
    });

    // Verifies DELETE supports its optional first FROM and a second joined FROM clause.
    test("parses DELETE with OUTPUT and joined FROM", () => {
        const snapshot = parse(`
DELETE FROM target
OUTPUT deleted.Id INTO dbo.DeletedIds (Id)
FROM sales.Orders AS target
WHERE target.Expired = 1;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /DeleteStatement\(/);
        assert.match(snapshot.tree.toString(), /OutputIntoClause\(/);
    });

    // Verifies MERGE models target/source aliases and matched and unmatched actions.
    test("parses a terminated MERGE statement", () => {
        const snapshot = parse(`
MERGE dbo.Target AS target
USING dbo.Source AS source ON source.Id = target.Id
WHEN MATCHED THEN UPDATE SET Value = source.Value
WHEN NOT MATCHED BY TARGET THEN INSERT (Id, Value) VALUES (source.Id, source.Value)
WHEN NOT MATCHED BY SOURCE THEN DELETE;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/MergeActionClause\(/g) ?? []).length, 3);
    });

    // Verifies the SQL Server-specific MERGE semicolon rule uses the reviewed diagnostic text.
    test("reports MERGE without its terminator", () => {
        const sql = "MERGE dbo.t AS t USING dbo.s AS s ON t.id=s.id WHEN MATCHED THEN DELETE";
        const snapshot = parse(sql);
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "A MERGE statement must be terminated by a semi-colon (;).",
                severity: "error",
                range: { start: 71, end: 71 },
            },
        ]);
    });

    // Verifies an edit between INSERT source forms reuses fragments and matches a fresh parse.
    test("keeps DML incremental and full parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const initial = new ImmutableTextSnapshot(
            "file:///dml.sql",
            1,
            "INSERT dbo.t (a) VALUES (1);\nGO\nUPDATE dbo.t SET a = 2;",
        );
        const first = service.parse(initial);
        const start = initial.text.indexOf("VALUES (1)");
        const change = { start, end: start + "VALUES (1)".length, text: "DEFAULT VALUES" };
        const edited = applyTextChanges(initial, 2, [change]);
        const incremental = service.update(first, edited, [change]);
        const fresh = service.parse(edited);

        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
    });
});
