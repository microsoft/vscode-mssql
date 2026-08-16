/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
// A foreign key with an explicit referenced column list must match a candidate key: a unique index
// compared on its key columns only, so an INCLUDE column never satisfies one.
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = require("../../../dist/index.js");

const catalog = {
    environment: { currentDatabase: "db", defaultSchema: "dbo" },
    schemas: [{ database: "db", name: "dbo" }],
    databases: [{ name: "db" }],
    objects: [
        {
            ref: { id: "parent", database: "db" },
            database: "db",
            schema: "dbo",
            name: "Parent",
            kind: "table",
        },
        {
            ref: { id: "proc", database: "db" },
            database: "db",
            schema: "dbo",
            name: "SaveOrder",
            kind: "procedure",
        },
    ],
    columns: new Map([
        [
            "parent",
            [
                { name: "Id", typeDisplay: "int", primaryKeyOrdinal: 1 },
                { name: "Code", typeDisplay: "int" },
                { name: "Region", typeDisplay: "int" },
                { name: "Note", typeDisplay: "int" },
            ],
        ],
    ]),
    parameters: new Map([["proc", []]]),
    indexes: new Map([
        [
            "parent",
            [
                {
                    name: "PK_Parent",
                    kind: "relational",
                    unique: true,
                    clustered: true,
                    columns: [{ name: "Id" }],
                },
                {
                    name: "UQ_CodeRegion",
                    kind: "relational",
                    unique: true,
                    columns: [
                        { name: "Code" },
                        { name: "Region" },
                        { name: "Note", included: true },
                    ],
                },
                {
                    name: "IX_Note",
                    kind: "relational",
                    unique: false,
                    columns: [{ name: "Note" }],
                },
            ],
        ],
    ]),
};

async function analyze(sql, patch = {}) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider({ ...catalog, ...patch }),
    );
    const snapshot = await runtime.open("file:///candidate-keys.sql", 1, sql);
    if (!patch.allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics.map(({ code, message, severity, range }) => ({
        code,
        message,
        severity,
        text: sql.slice(range.start, range.end),
    }));
}

const codes = (diagnostics) => diagnostics.map(({ code }) => code);
const foreignKey = (columns) =>
    `CREATE TABLE dbo.Child (a int, b int, CONSTRAINT FK_Child FOREIGN KEY (${
        columns.split(",").length === 1 ? "a" : "a, b"
    }) REFERENCES dbo.Parent (${columns}));`;

suite("T-SQL foreign key candidate key validation", () => {
    // Exact output when no unique index matches the referenced column list.
    test("reports a missing candidate key with exact output", async () => {
        assert.deepEqual(await analyze(foreignKey("Note")), [
            {
                code: "NoPrimaryKeysInReferencedTable",
                message:
                    "There are no primary or candidate keys in the referenced table 'dbo.Parent' that match the referencing column list in the foreign key 'FK_Child'.",
                severity: "error",
                text: "dbo.Parent",
            },
        ]);
    });

    // A primary key and a multi-column unique key both satisfy an explicit list.
    test("accepts a referenced list that matches a candidate key", async () => {
        assert.deepEqual(await analyze(foreignKey("Id")), []);
        assert.deepEqual(await analyze(foreignKey("Code, Region")), []);
        // Key column order does not matter to the match.
        assert.deepEqual(await analyze(foreignKey("Region, Code")), []);
    });

    // An INCLUDE column is stored by the index but is not part of its key.
    test("does not count an included column as a key column", async () => {
        assert.deepEqual(codes(await analyze(foreignKey("Code, Note"))), [
            "NoPrimaryKeysInReferencedTable",
        ]);
    });

    // A partial match of a wider key is not a candidate key.
    test("requires the whole key, not a prefix", async () => {
        assert.deepEqual(codes(await analyze(foreignKey("Code"))), [
            "NoPrimaryKeysInReferencedTable",
        ]);
    });

    // An implicit reference keeps its own rule, and an invalid column stops the check.
    test("does not apply to implicit or invalid references", async () => {
        assert.deepEqual(
            codes(
                await analyze(
                    "CREATE TABLE dbo.Child (a int, CONSTRAINT FK_Child FOREIGN KEY (a) REFERENCES dbo.Parent);",
                ),
            ),
            [],
        );
        assert.deepEqual(
            codes(
                await analyze(
                    "CREATE TABLE dbo.Child (a int, CONSTRAINT FK_Child FOREIGN KEY (a) REFERENCES dbo.Parent (Missing));",
                ),
            ),
            ["ForeignKeyInvalidReferencedColumn"],
        );
    });

    // An index set that is not loaded proves nothing about the referenced table's keys.
    test("never reports from an unloaded index set", async () => {
        for (const kind of ["loading", "notLoaded", "failed"]) {
            assert.deepEqual(
                codes(
                    await analyze(foreignKey("Note"), {
                        indexStates: new Map([["parent", { kind }]]),
                    }),
                ),
                [],
                kind,
            );
        }
        assert.deepEqual(
            codes(
                await analyze(foreignKey("Note"), {
                    indexes: new Map(),
                    completeness: { indexes: "partial" },
                }),
            ),
            [],
        );
    });

    // A table created in this document is newer than any catalog generation.
    test("never reports against a table created in this document", async () => {
        assert.deepEqual(
            codes(
                await analyze(`CREATE TABLE dbo.Local (Id int);
GO
CREATE TABLE dbo.Child (a int, CONSTRAINT FK_Child FOREIGN KEY (a) REFERENCES dbo.Local (Id));`),
            ),
            [],
        );
    });

    // Quoted names resolve to the same columns and keep the written spelling in the message.
    test("handles quoted names", async () => {
        assert.deepEqual(
            (
                await analyze(
                    "CREATE TABLE dbo.Child (a int, CONSTRAINT FK_Child FOREIGN KEY (a) REFERENCES [dbo].[Parent] ([Note]));",
                )
            ).map(({ code, text }) => [code, text]),
            [["NoPrimaryKeysInReferencedTable", "[dbo].[Parent]"]],
        );
    });
});

suite("T-SQL candidate key incremental equivalence", () => {
    // Incremental analysis of the same final text and generation must equal a fresh analysis.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const uri = "file:///candidate-incremental.sql";
        const first = `SELECT 1;\nGO\n${foreignKey("Id")}\n`;
        const final = `SELECT 1;\nGO\n${foreignKey("Note")}\n`;
        const initialSyntax = service.parse(new ImmutableTextSnapshot(uri, 1, first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        assert.deepEqual(initial.diagnostics, []);
        const change = {
            start: first.indexOf("Parent (Id)") + "Parent (".length,
            end: first.indexOf("Parent (Id)") + "Parent (Id".length,
            text: "Note",
        };
        const updatedSyntax = service.update(
            initialSyntax,
            new ImmutableTextSnapshot(uri, 2, final),
            [change],
        );
        const updated = binder.update(initial, {
            syntax: updatedSyntax,
            metadata: provider.pin(),
            previous: initial,
            changedRanges: updatedSyntax.changedRanges,
        });
        const fresh = binder.bind({
            syntax: service.parse(new ImmutableTextSnapshot(uri, 2, final)),
            metadata: provider.pin(),
        });
        const normalize = (snapshot) =>
            snapshot.diagnostics
                .map(({ code, message, range }) => `${code}:${range.start}:${range.end}:${message}`)
                .sort();
        assert.deepEqual(normalize(updated), normalize(fresh));
        assert.equal(normalize(fresh).length, 1);
    });
});
