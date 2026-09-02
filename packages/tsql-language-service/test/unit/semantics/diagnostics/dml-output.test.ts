/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as semanticHarness from "../../support/semanticHarness.ts";
import type { ObjectMetadata } from "../../../../src/index.ts";
const { analyzeSql: analyze, createMetadata: metadata, messages, table } = semanticHarness;

suite("T-SQL DML and OUTPUT diagnostics", () => {
    // INSERT and UPDATE list validation uses the resolved target shape, not textual heuristics.
    test("validates DML target columns and cardinality", async () => {
        const provider = metadata({
            objects: [table("target", "dbo", "Target")],
            columns: new Map([
                [
                    "target",
                    [
                        { name: "Id", typeDisplay: "int" },
                        { name: "Name", typeDisplay: "nvarchar(50)" },
                    ],
                ],
            ]),
        });
        const diagnostics = await analyze(
            `INSERT dbo.Target (Id, Id, Missing) VALUES (1, 2), (3);
             UPDATE dbo.Target SET Name = N'a', Name = N'b', Missing = 1;`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes("The column 'Id' was specified multiple times for 'dbo.Target'."),
        );
        assert.ok(
            output.includes("Column name 'Missing' does not exist in the target table or view."),
        );
        assert.ok(
            output.includes(
                "The number of columns for each row in a table value constructor must be the same.",
            ),
        );
        assert.ok(
            output.includes(
                "The column name 'Name' is specified more than once in the SET clause. A column cannot be assigned more than one value in the same SET clause. Modify the SET clause to make sure that a column is updated only once. If the SET clause updates columns of a view, then the column name 'Name' may appear twice in the view definition.",
            ),
        );
    });
    // OUTPUT expressions reject subqueries and aggregates while ordinary inserted/deleted column
    // projections remain valid.
    test("validates OUTPUT expression restrictions", async () => {
        const provider = metadata({
            objects: [table("items", "dbo", "Items")],
            columns: new Map([["items", [{ name: "Id", typeDisplay: "int" }]]]),
        });
        const diagnostics = await analyze(
            `UPDATE dbo.Items SET Id = 1
             OUTPUT (SELECT 1), COUNT(*), inserted.Id;`,
            provider,
        );

        assert.deepEqual(
            diagnostics
                .filter(({ code }) =>
                    ["SubqueriesNotAllowedInOutput", "AggregateNotAllowedInOutput"].includes(code),
                )
                .map(({ message }) => message),
            [
                "Subqueries are not allowed in the OUTPUT clause.",
                "An aggregate may not appear in the OUTPUT clause.",
            ],
        );
    });
    // OUTPUT INTO rejects views and CTEs, and table-variable identity columns cannot be named as
    // destinations. A regular table destination with an explicit nonidentity list stays valid.
    test("validates OUTPUT INTO targets and identity columns", async () => {
        const items = table("items", "dbo", "Items");
        const archive = table("archive", "dbo", "Archive");
        const destinationView: ObjectMetadata = {
            ref: { id: "destination-view", database: "db" },
            database: "db",
            schema: "dbo",
            name: "DestinationView",
            kind: "view",
        };
        const provider = metadata({
            objects: [items, archive, destinationView],
            columns: new Map([
                ["items", [{ name: "Id", typeDisplay: "int" }]],
                [
                    "archive",
                    [
                        { name: "ArchiveId", typeDisplay: "int", identity: true },
                        { name: "Id", typeDisplay: "int" },
                    ],
                ],
                ["destination-view", [{ name: "Id", typeDisplay: "int" }]],
            ]),
        });
        const diagnostics = await analyze(
            `DECLARE @results TABLE(ResultId int IDENTITY, Id int);
             UPDATE dbo.Items SET Id = 1 OUTPUT inserted.Id INTO @results(ResultId);
             UPDATE dbo.Items SET Id = 2 OUTPUT inserted.Id INTO dbo.DestinationView(Id);
             WITH Destination AS (SELECT Id FROM dbo.Archive)
             UPDATE dbo.Items SET Id = 3 OUTPUT inserted.Id INTO Destination(Id);
             UPDATE dbo.Items SET Id = 4 OUTPUT inserted.Id, inserted.Id INTO dbo.Archive;
             UPDATE dbo.Items SET Id = 5 OUTPUT inserted.Id INTO dbo.Archive(Id);`,
            provider,
        );
        const output = messages(diagnostics);
        assert.ok(
            output.includes("INSERT into an identity column not allowed on table variables."),
        );
        assert.ok(
            output.includes(
                "The target 'dbo.DestinationView' of the OUTPUT INTO clause cannot be a view or common table expression.",
            ),
        );
        assert.ok(
            output.includes(
                "The target 'Destination' of the OUTPUT INTO clause cannot be a view or common table expression.",
            ),
        );
        assert.ok(
            output.includes(
                "An explicit value for the identity column in table 'dbo.Archive' can only be specified when a column list is used and IDENTITY_INSERT is ON.",
            ),
        );
        assert.equal(
            diagnostics.filter(({ code }) => code === "ExplicitValueForIdentityColumn").length,
            1,
        );
    });
});
