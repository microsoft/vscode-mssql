/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    analyzeSql: analyze,
    createMetadata: metadata,
    messages,
    table,
} = require("../../support/semanticHarness.js");

suite("T-SQL index and temporal diagnostics", () => {
    // Index validation uses loaded column shapes and validates structural option ranges locally.
    test("validates index columns, types, and options", async () => {
        const provider = metadata({
            objects: [table("indexed", "dbo", "Indexed")],
            columns: new Map([
                [
                    "indexed",
                    [
                        { name: "Id", typeDisplay: "int" },
                        { name: "Payload", typeDisplay: "xml" },
                        { name: "Legacy", typeDisplay: "text" },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            `CREATE CLUSTERED INDEX ix_bad ON dbo.Indexed
                (Payload, Payload, Missing)
                INCLUDE (Legacy)
                WHERE 1
                WITH (FILLFACTOR = 101, MAXDOP = 65);`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes(
                "Cannot use duplicate column names in index. Column name 'Payload' listed more than once.",
            ),
        );
        assert.ok(
            output.includes("Column name 'Missing' does not exist in the target table or view."),
        );
        assert.ok(
            output.includes(
                "Column 'Payload' in table 'dbo.Indexed' is of a type that is invalid for use as a key column in an index.",
            ),
        );
        assert.ok(
            output.includes(
                " Column 'Legacy' in table 'dbo.Indexed' is of a type that is invalid for use as included column in an index.",
            ),
        );
        assert.ok(output.includes("Cannot specify included columns for a clustered index."));
        assert.ok(
            output.includes(
                "Fillfactor 101 is not a valid percentage; fillfactor must be between 1 and 100.",
            ),
        );
        assert.ok(
            output.some((message) =>
                message.startsWith("'65' is out of range for index option 'maxdop'"),
            ),
        );
        assert.ok(
            output.includes(
                "Incorrect WHERE clause for filtered index 'ix_bad' on table 'dbo.Indexed'.",
            ),
        );
    });
    // A semantic index cannot infer its embedding model from unrelated physical options.
    test("requires a semantic index external model", async () => {
        const diagnostics = await analyze(
            "CREATE SEMANTIC INDEX ix ON dbo.Documents (Body) WITH (MAXDOP = 4);",
            metadata(),
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) => code === "MissingSemanticIndexOption")
                .map(({ message }) => message),
            ["Missing EXTERNAL_MODEL in the CREATE SEMANTIC INDEX statement."],
        );
    });
    // Temporal table validation covers missing, duplicate, nullable, and mismatched period columns.
    test("validates temporal period contracts", async () => {
        const diagnostics = await analyze(
            `CREATE TABLE dbo.NoStart (Ended datetime2 GENERATED ALWAYS AS ROW END, PERIOD FOR SYSTEM_TIME (Ended, Ended));
GO
CREATE TABLE dbo.NoEnd (Started datetime2 GENERATED ALWAYS AS ROW START, PERIOD FOR SYSTEM_TIME (Started, Started));
GO
CREATE TABLE dbo.NoPeriod (Started datetime2 GENERATED ALWAYS AS ROW START);
GO
CREATE TABLE dbo.Duplicates (
    Started datetime2 GENERATED ALWAYS AS ROW START NULL,
    Ended datetime2 GENERATED ALWAYS AS ROW END,
    EndedAgain datetime2 GENERATED ALWAYS AS ROW END,
    PERIOD FOR SYSTEM_TIME (Started, WrongEnd),
    PERIOD FOR SYSTEM_TIME (Started, Ended)
);`,
            metadata(),
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes("Temporal 'GENERATED ALWAYS AS ROW START' column definition missing."),
        );
        assert.ok(
            output.includes("Temporal 'GENERATED ALWAYS AS ROW END' column definition missing."),
        );
        assert.ok(
            output.includes(
                "Cannot create generated always column when SYSTEM_TIME period is not defined.",
            ),
        );
        assert.ok(
            output.includes(
                "Period column 'Started' in a system-versioned temporal table cannot be nullable.",
            ),
        );
        assert.ok(
            output.includes(
                "Table cannot have more than one 'GENERATED ALWAYS AS ROW END' column.",
            ),
        );
        assert.ok(
            output.includes("Table cannot have more than one SYSTEM_TIME period definition."),
        );
        assert.ok(
            output.some((message) =>
                message.startsWith("Table SYSTEM_TIME period definition end column name"),
            ),
        );
    });
});
