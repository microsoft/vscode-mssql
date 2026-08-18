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
    contextualKeywordNames,
    defaultTsqlFeatureProfile,
    isContextualKeyword,
    isReservedKeyword,
    isTsqlKeyword,
    keywordMetadata,
    reservedKeywordNames,
} = require("../../../dist/index.js");

const {
    assertIncrementalEquivalent,
    createSyntaxHarness,
} = require("../../support/syntaxHarness.js");
const { parse } = createSyntaxHarness("foundation.sql");

suite("T-SQL lexical and query grammar foundation", () => {
    // Verifies the checked-in vocabulary includes global, contextual, and SQL 2025 words.
    test("exposes the complete imported keyword catalog", () => {
        assert.equal(reservedKeywordNames.length, 183);
        assert.equal(contextualKeywordNames.length, 347);
        assert.equal(isReservedKeyword("SELECT"), true);
        assert.equal(isContextualKeyword("VECTOR"), true);
        assert.equal(isTsqlKeyword("REGEXP_LIKE"), true);
        assert.deepEqual(keywordMetadata("regexp_like"), {
            category: "reserved",
            minimumCompatibility: 170,
        });
    });

    // Verifies SQL Server 2025 is the default while the public profile can target 150 and 160.
    test("publishes an explicit SQL Server feature profile", () => {
        assert.deepEqual(defaultTsqlFeatureProfile, {
            serverMajorVersion: 17,
            compatibilityLevel: 170,
            engineProfile: "sql-server",
            previewFeatures: false,
        });
        const profile = {
            serverMajorVersion: 15,
            compatibilityLevel: 150,
            engineProfile: "sql-server",
            previewFeatures: false,
        };
        assert.equal(new LezerSyntaxService(undefined, profile).profile, profile);
    });

    // Verifies nested SQL Server comments remain one exact trivia token instead of ending early.
    test("preserves nested block comments as one lossless token", () => {
        const sql = "/* outside /* inside */ outside */ SELECT 1;";
        const snapshot = parse(sql);
        assert.deepEqual(snapshot.diagnostics, []);
        const comment = [...snapshot.tokens()].find((token) => token.kind === "BlockComment");
        assert.deepEqual(comment, {
            kind: "BlockComment",
            start: 0,
            end: 34,
            text: "/* outside /* inside */ outside */",
            trivia: true,
            lineStart: true,
            keyword: undefined,
        });
    });

    // Verifies GO is a batch command only at line start and remains an identifier inside SELECT.
    test("distinguishes line-leading GO from an identifier", () => {
        const sql = "SELECT go FROM dbo.t;\n  GO 2 -- repeat\nSELECT 2;";
        const snapshot = parse(sql);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go,IntegerLiteral\)/);
        const tokens = [...snapshot.tokens()];
        assert.equal(tokens.find((token) => token.text === "go")?.kind, "Identifier");
        const separator = tokens.find((token) => token.text === "GO");
        assert.equal(separator?.kind, "Keyword");
        assert.equal(separator?.lineStart, true);
        assert.equal(tokens.find((token) => token.text === "2")?.kind, "IntegerLiteral");
        assert.equal(tokens.find((token) => token.text === "-- repeat")?.kind, "LineComment");
    });

    // Verifies identifiers, variables, literals, punctuation, and Unicode offsets stay lossless.
    test("retains exact token text and UTF-16 ranges", () => {
        const sql = "SELECT @v, @@ROWCOUNT, #t.[a]]b], N\"x\", N'😀', 0xCAFE, 1.2e3;";
        const tokens = [...parse(sql).tokens()];
        for (const token of tokens) {
            assert.equal(sql.slice(token.start, token.end), token.text);
        }
        assert.ok(tokens.some((token) => token.kind === "Variable" && token.text === "@v"));
        assert.ok(
            tokens.some((token) => token.kind === "GlobalVariable" && token.text === "@@ROWCOUNT"),
        );
        assert.ok(tokens.some((token) => token.kind === "TempIdentifier" && token.text === "#t"));
        assert.ok(tokens.some((token) => token.kind === "BinaryLiteral"));
        assert.ok(tokens.some((token) => token.kind === "FloatLiteral"));
    });

    // Verifies the query slice covers CTEs, JSON rowsets, APPLY, grouping, windows, and pagination.
    test("parses representative modern query constructs", () => {
        const sql = `
WITH source AS (
    SELECT category, amount FROM OPENJSON(@json, '$.rows')
    WITH (category nvarchar(50), amount decimal(18,2)) AS j
)
SELECT category, SUM(amount) OVER totals AS amount
FROM source s
CROSS APPLY OPENJSON(@detail) d
GROUP BY GROUPING SETS ((category), ())
WINDOW totals AS (PARTITION BY category ORDER BY amount ROWS UNBOUNDED PRECEDING)
ORDER BY category OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY
FOR JSON PATH;
`;
        const snapshot = parse(sql);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        for (const kind of [
            "WithClause",
            "FunctionTableSource",
            "ApplyJoin",
            "GroupByClause",
            "WindowClause",
            "OffsetFetchClause",
            "ForClause",
        ]) {
            assert.match(tree, new RegExp(`${kind}\\(`));
        }
    });

    // Set-operator operands, CTE bodies, INSERT sources, and wrappers may group a query.
    // Statement-leading '(SELECT …) UNION …' remains a separate batch so '(' is not a
    // statement starter.
    test("parses parenthesized query expressions", () => {
        const snapshot = parse(`
SELECT 1 UNION (SELECT 2);
SELECT 1 EXCEPT (SELECT 2);
SELECT 1 INTERSECT (SELECT 2);
WITH c AS ((SELECT 1)) SELECT * FROM c;
WITH d AS ((SELECT 1 UNION SELECT 2)) SELECT * FROM d;
SELECT * FROM ((SELECT 1 UNION ALL SELECT 2)) AS t;
SELECT (((SELECT 1) UNION SELECT 2));
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        const tree = snapshot.tree.toString();
        assert.match(tree, /QueryPrimary\(ParenthesizedQuery\(/);
        assert.match(tree, /WithClause\(/);
        assert.match(tree, /DerivedTable\(/);
    });

    // Scalar subqueries and derived tables remain ParenthesizedQuery, not statement wrappers.
    test("keeps scalar subqueries and derived tables distinct from set grouping", () => {
        const snapshot = parse(`
SELECT (SELECT 1);
SELECT * FROM (SELECT 1 AS Id) AS t;
`);
        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        const tree = snapshot.tree.toString();
        assert.match(tree, /SelectElement\(Expression\(ParenthesizedQuery\(/);
        assert.match(tree, /DerivedTable\(ParenthesizedQuery\(/);
    });

    // A truncated grouped operand stays in its batch so the following GO batch remains a clean SELECT.
    test("keeps a damaged parenthesized query inside its GO batch", () => {
        const sql = "SELECT 1 UNION (\nGO\nSELECT 1;";
        const snapshot = parse(sql);
        const selectStart = sql.lastIndexOf("SELECT");
        const cleanSelect = parse("SELECT 1;");

        assert.ok(snapshot.diagnostics.length > 0);
        assert.ok(snapshot.diagnostics.every((diagnostic) => diagnostic.range.start < selectStart));
        assert.equal(cleanSelect.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(cleanSelect.diagnostics, []);
        assert.match(snapshot.tree.toString(), /SelectStatement\(/);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
    });

    // Incremental grouping of a UNION operand must match a fresh parse of the final text.
    test("keeps incremental parenthesized query grouping equivalent to a fresh parse", () => {
        const service = new LezerSyntaxService();
        const beforeText = "SELECT 1 UNION SELECT 2;\nGO\nSELECT 1;";
        const previousDocument = new ImmutableTextSnapshot(
            "file:///parenthesized-query.sql",
            1,
            beforeText,
        );
        const previousSnapshot = service.parse(previousDocument);
        const start = beforeText.indexOf("SELECT 2");
        const { incremental, fresh } = assertIncrementalEquivalent({
            service,
            previousDocument,
            previousSnapshot,
            version: 2,
            changes: [{ start, end: start + "SELECT 2".length, text: "(SELECT 2)" }],
            assertReuse: false,
        });
        assert.deepEqual(incremental.diagnostics, []);
        assert.deepEqual(fresh.diagnostics, []);
        assert.match(fresh.tree.toString(), /Union,QueryTerm\(QueryPrimary\(ParenthesizedQuery\(/);
    });

    // Verifies common rowset and scalar constructs have dedicated nodes rather than recovery gaps.
    test("parses OPENROWSET, CHANGETABLE, NEXT VALUE, and AT TIME ZONE", () => {
        const sql = `
SELECT sequence_value = NEXT VALUE FOR dbo.OrderSequence,
       local_time = CreatedAt AT TIME ZONE 'UTC'
FROM OPENROWSET(BULK 'data/items.csv', FORMAT = 'CSV') AS rows;
SELECT change.SYS_CHANGE_VERSION
FROM CHANGETABLE(CHANGES dbo.Items, @last_version) AS change;
`;
        const snapshot = parse(sql);
        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.match(tree, /NextValueExpression\(/);
        assert.match(tree, /AtTimeZone/);
        assert.match(tree, /OpenRowsetSource\(/);
        assert.match(tree, /ChangeTableSource\(/);
    });

    // Verifies Cartesian joins and CAST's contextual spelling match real SQL Server scripts.
    test("parses CROSS JOIN and contextual CAST expressions", () => {
        const snapshot = parse(`
SELECT CAST(a.object_id AS decimal(18,2)) AS object_id
FROM sys.all_objects AS a
CROSS JOIN sys.all_objects AS b;
`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /CrossJoin\(/);
        const cast = [...snapshot.tokens()].find((token) => token.text.toLowerCase() === "cast");
        assert.equal(cast?.kind, "Keyword");
        assert.equal(cast?.keyword, "contextual");
    });

    // Verifies malformed token diagnostics preserve the reviewed message, severity, and exact span.
    test("reports a precise syntax diagnostic at a bad token", () => {
        const snapshot = parse("SELECT FROM t");
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near the keyword 'FROM'.",
                severity: "error",
                range: { start: 7, end: 11 },
            },
        ]);
    });

    // Verifies an incomplete multipart name uses the reviewed EOF message and zero-width range.
    test("reports the expected multipart identifier at EOF", () => {
        const snapshot = parse("SELECT * FROM dbo.");
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'End Of File'.  Expecting '.', ID, or QUOTED_ID.",
                severity: "error",
                range: { start: 18, end: 18 },
            },
        ]);
    });

    // Verifies incremental lexing/parsing produces the same nodes and diagnostics as a fresh parse.
    test("keeps incremental and full results equivalent across lexical states", () => {
        const service = new LezerSyntaxService();
        const firstDocument = new ImmutableTextSnapshot(
            "file:///equivalent.sql",
            1,
            "SELECT a FROM dbo.t;\nGO\nSELECT 'old' AS value;",
        );
        const first = service.parse(firstDocument);
        const start = firstDocument.text.indexOf("'old'");
        const change = { start, end: start + 5, text: "N'new /* text */'" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });

    // Verifies OPENJSON and XML nodes rowsets retain correlation names and exposed columns.
    test("parses JSON and XML rowset aliases", () => {
        const snapshot = parse(`
SELECT j.value FROM OPENJSON(@json, '$.items') AS j;
SELECT T.Spec
FROM dbo.Products AS p
CROSS APPLY p.XmlData.nodes('/product/specs/*') AS T(Spec);
`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /FunctionTableSource\(/);
        assert.match(snapshot.tree.toString(), /ColumnNameList\(/);
    });

    // Verifies legacy FOR cursor modes and XML schema directives remain structured clauses.
    test("parses complete FOR clause variants", () => {
        const snapshot = parse(`
SELECT * FROM dbo.t FOR READ ONLY;
SELECT * FROM dbo.t FOR UPDATE OF c1, c2;
SELECT * FROM dbo.t FOR XML RAW, XMLDATA, XMLSCHEMA('urn:test'), ROOT('r');`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.equal((snapshot.tree.toString().match(/ForClause\(/g) ?? []).length, 3);
    });

    // Verifies FOR UPDATE requires a column after OF.
    test("reports an incomplete FOR UPDATE OF clause", () => {
        assert.ok(parse("SELECT * FROM dbo.t FOR UPDATE OF;").diagnostics.length > 0);
    });

    // Verifies mixed wildcard projections use the same select-element list as ordinary columns.
    test("parses an unqualified star alongside other projections", () => {
        const snapshot = parse("SELECT *, Id FROM dbo.Items;");
        assert.equal(snapshot.statistics.rawErrorNodeCount, 0);
        assert.deepEqual(snapshot.diagnostics, []);
    });

    // Verifies compound operator coloring retains three keywords and intervening trivia.
    test("exposes AT TIME ZONE as lossless public tokens", () => {
        const tokens = [...parse("SELECT CreatedAt AT TIME ZONE 'UTC';").tokens()];
        assert.deepEqual(
            tokens
                .filter((token) => ["AT", "TIME", "ZONE"].includes(token.text.toUpperCase()))
                .map((token) => [token.kind, token.text.toUpperCase()]),
            [
                ["Keyword", "AT"],
                ["Keyword", "TIME"],
                ["Keyword", "ZONE"],
            ],
        );
    });

    // Verifies incomplete nested comments remain lossless but are never silently accepted.
    test("reports an unterminated block comment", () => {
        const sql = "SELECT 1; /* outer /* nested */";
        const snapshot = parse(sql);
        assert.deepEqual(snapshot.diagnostics.at(-1), {
            code: "syntax",
            message: "Unclosed comment was found at the end of the batch.",
            severity: "error",
            range: { start: sql.indexOf("/*"), end: sql.length },
        });
    });
});
