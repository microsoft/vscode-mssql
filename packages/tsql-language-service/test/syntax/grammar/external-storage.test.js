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
const { assertValid, parse } = createSyntaxHarness("external-storage.sql");

suite("T-SQL external data and partition grammar", () => {
    // Verifies external data-source creation, alteration, and removal preserve named options.
    test("parses external data source lifecycle statements", () => {
        const snapshot = parse(`
CREATE EXTERNAL DATA SOURCE Lake WITH (
    LOCATION = 'abfss://container@account.dfs.core.windows.net',
    CREDENTIAL = LakeCredential
);
ALTER EXTERNAL DATA SOURCE Lake SET LOCATION = 'https://example.test';
DROP EXTERNAL DATA SOURCE Lake;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateExternalDataSourceStatement\(/);
        assert.match(tree, /AlterExternalDataSourceStatement\(/);
        assert.match(tree, /DropExternalDataSourceStatement\(/);
    });

    // Verifies nested FORMAT_OPTIONS remain structured instead of degrading into recovery nodes.
    test("parses external file formats with nested options", () => {
        const snapshot = parse(`
CREATE EXTERNAL FILE FORMAT CsvFormat WITH (
    FORMAT_TYPE = DELIMITEDTEXT,
    FORMAT_OPTIONS (FIELD_TERMINATOR = ',', FIRST_ROW = 2)
);
DROP EXTERNAL FILE FORMAT CsvFormat;
`);

        assertValid(snapshot);
        assert.match(snapshot.tree.toString(), /CreateExternalFileFormatStatement\(/);
        assert.ok((snapshot.tree.toString().match(/GenericOptionList\(/g) ?? []).length >= 2);
    });

    // Verifies declared external tables and guarded drops retain columns and external options.
    test("parses external table lifecycle statements", () => {
        const snapshot = parse(`
CREATE EXTERNAL TABLE ext.Sales (
    Id bigint NOT NULL,
    Payload nvarchar(max) NULL
) WITH (
    LOCATION = '/sales/', DATA_SOURCE = Lake, FILE_FORMAT = CsvFormat,
    DISTRIBUTION = ROUND_ROBIN
);
DROP EXTERNAL TABLE IF EXISTS ext.Sales;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreateExternalTableStatement\(/);
        assert.match(tree, /ExternalTableWithClause\(/);
        assert.match(tree, /DropExternalTableStatement\(/);
    });

    // Verifies partition functions and schemes cover create, split, merge, next-used, and drop.
    test("parses partition function and scheme lifecycle statements", () => {
        const snapshot = parse(`
CREATE PARTITION FUNCTION pfDate(date) AS RANGE RIGHT
FOR VALUES ('2025-01-01', '2026-01-01');
CREATE PARTITION SCHEME psDate AS PARTITION pfDate
TO ([PRIMARY], [Archive], [Archive]);
ALTER PARTITION SCHEME psDate NEXT USED [Archive];
ALTER PARTITION FUNCTION pfDate() SPLIT RANGE ('2027-01-01');
ALTER PARTITION FUNCTION pfDate() MERGE RANGE ('2025-01-01');
DROP PARTITION SCHEME psDate;
DROP PARTITION FUNCTION pfDate;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /CreatePartitionFunctionStatement\(/);
        assert.match(tree, /CreatePartitionSchemeStatement\(/);
        assert.equal((tree.match(/AlterPartitionFunctionStatement\(/g) ?? []).length, 2);
        assert.match(tree, /AlterPartitionSchemeStatement\(/);
        assert.match(tree, /DropPartitionFunctionStatement\(/);
    });

    // Verifies a missing option value remains an exact visible parser error.
    test("reports malformed external options", () => {
        const sql = "CREATE EXTERNAL DATA SOURCE Lake WITH (LOCATION = );";
        const snapshot = parse(sql);
        const close = sql.indexOf(")");

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(
            snapshot.diagnostics.some(
                (diagnostic) =>
                    diagnostic.message === "Incorrect syntax near ')'." &&
                    diagnostic.range.start === close,
            ),
        );
    });

    // Verifies a missing partition boundary delimiter remains visible at its exact token.
    test("reports malformed partition syntax", () => {
        const sql = "CREATE PARTITION FUNCTION pf(int) AS RANGE RIGHT FOR VALUES (1, );";
        const snapshot = parse(sql);

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.ok(snapshot.diagnostics.some((diagnostic) => diagnostic.range.start === 64));
    });

    // Verifies native fragment reuse remains identical to fresh parsing inside nested option lists.
    test("keeps external-data incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const sql = `CREATE EXTERNAL FILE FORMAT CsvFormat WITH (
FORMAT_TYPE = DELIMITEDTEXT, FORMAT_OPTIONS (FIRST_ROW = 2));`;
        const firstDocument = new ImmutableTextSnapshot("file:///external.sql", 1, sql);
        const first = service.parse(firstDocument);
        const start = sql.lastIndexOf("2");
        const change = { start, end: start + 1, text: "3" };
        const nextDocument = applyTextChanges(firstDocument, 2, [change]);
        const incremental = service.update(first, nextDocument, [change]);
        const fresh = service.parse(nextDocument);

        assert.ok(incremental.statistics.reusableFragmentCount > 0);
        assert.equal(incremental.tree.toString(), fresh.tree.toString());
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.deepEqual([...incremental.tokens()], [...fresh.tokens()]);
    });
});
