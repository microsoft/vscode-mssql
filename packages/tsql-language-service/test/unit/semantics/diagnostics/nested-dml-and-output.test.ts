/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as api from "../../../../src/index.ts";
import type {
    InMemoryMetadataInput,
    ObjectMetadata,
    SemanticDiagnostic,
    SemanticSnapshot,
} from "../../../../src/index.ts";
// A DML statement written as a table source exposes its OUTPUT clause as the rowset, so a nested
// statement without one produces no columns. Inside an OUTPUT clause a user-defined scalar function
// is only allowed when the catalog proves it is schema bound.
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = api;

const object = (
    id: string,
    name: string,
    kind: ObjectMetadata["kind"],
    extra: Partial<ObjectMetadata> = {},
): ObjectMetadata => ({
    ref: { id, database: "db" },
    database: "db",
    schema: "dbo",
    name,
    kind,
    ...extra,
});

const catalog = {
    environment: { currentDatabase: "db", defaultSchema: "dbo" },
    schemas: [{ database: "db", name: "dbo" }],
    databases: [{ name: "db" }],
    objects: [
        object("t", "Orders", "table"),
        object("loose", "LooseFn", "scalarFunction", { schemaBound: false }),
        object("bound", "BoundFn", "scalarFunction", { schemaBound: true }),
        object("unknown", "UnknownFn", "scalarFunction"),
        object("tvf", "TableFn", "tableFunction", { schemaBound: false }),
    ],
    columns: new Map([["t", [{ name: "Id", typeDisplay: "int" }]]]),
    parameters: new Map([
        ["loose", []],
        ["bound", []],
        ["unknown", []],
        ["tvf", []],
    ]),
} satisfies InMemoryMetadataInput;

interface AnalyzePatch extends InMemoryMetadataInput {
    readonly allowSyntaxDiagnostics?: boolean;
}

async function analyze(sql: string, patch: AnalyzePatch = {}) {
    const { allowSyntaxDiagnostics = false, ...metadataPatch } = patch;
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider({ ...catalog, ...metadataPatch }),
    );
    const snapshot = await runtime.open("file:///nested-dml.sql", 1, sql);
    if (!allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics.map(({ code, message, severity, range }) => ({
        code,
        message,
        severity,
        text: sql.slice(range.start, range.end),
    }));
}

const codes = (diagnostics: readonly Pick<SemanticDiagnostic, "code">[]): string[] =>
    diagnostics.map(({ code }) => code);

suite("T-SQL nested DML table source validation", () => {
    // Exact output, ranged across the nested statement rather than the whole table source.
    test("reports a nested DML statement without OUTPUT with exact output", async () => {
        assert.deepEqual(
            await analyze("SELECT * FROM (INSERT dbo.Orders (Id) VALUES (1)) AS x (Id);"),
            [
                {
                    code: "NestedDmlMustHaveOutputClause",
                    message:
                        "A nested INSERT, UPDATE, DELETE, or MERGE statement must have an OUTPUT clause.",
                    severity: "error",
                    text: "INSERT dbo.Orders (Id) VALUES (1)",
                },
            ],
        );
    });

    // Every DML statement the grammar accepts as a table source follows the same rule.
    test("covers every nested DML statement form", async () => {
        for (const statement of [
            "INSERT dbo.Orders (Id) VALUES (1)",
            "UPDATE dbo.Orders SET Id = 1",
            "DELETE dbo.Orders",
            // A nested MERGE still carries the terminator SQL Server requires of every MERGE.
            "MERGE dbo.Orders AS target USING dbo.Orders AS source ON target.Id = source.Id WHEN MATCHED THEN DELETE;",
        ]) {
            assert.deepEqual(
                codes(await analyze(`SELECT * FROM (${statement}) AS x (Id);`)),
                ["NestedDmlMustHaveOutputClause"],
                statement,
            );
        }
    });

    // A nested statement that supplies an OUTPUT clause is valid and exposes its named columns.
    test("accepts a nested DML statement with an OUTPUT clause", async () => {
        for (const sql of [
            "SELECT * FROM (INSERT dbo.Orders (Id) OUTPUT inserted.Id VALUES (1)) AS x (Id);",
            "SELECT x.Id FROM (DELETE dbo.Orders OUTPUT deleted.Id) AS x (Id);",
            "SELECT x.Id FROM (UPDATE dbo.Orders SET Id = 1 OUTPUT inserted.Id) AS x (Id);",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // The nested statement keeps its own scope: its columns resolve through the declared list only.
    test("exposes only the nested statement's declared columns", async () => {
        assert.deepEqual(
            codes(
                await analyze(
                    "SELECT x.Missing FROM (DELETE dbo.Orders OUTPUT deleted.Id) AS x (Id);",
                ),
            ),
            ["MSSQL207"],
        );
        assert.deepEqual(
            codes(
                await analyze("SELECT y.Id FROM (DELETE dbo.Orders OUTPUT deleted.Id) AS x (Id);"),
            ),
            ["MultiPartIdentifierBindingError"],
        );
    });

    // An ordinary derived table and a top-level DML statement are untouched.
    test("does not report unrelated table sources or statements", async () => {
        for (const sql of [
            "SELECT * FROM (SELECT Id FROM dbo.Orders) AS x;",
            "SELECT * FROM (dbo.Orders AS y);",
            "INSERT dbo.Orders (Id) VALUES (1);",
            "DELETE dbo.Orders;",
        ]) {
            assert.deepEqual(
                codes(await analyze(sql)).filter(
                    (code) => code === "NestedDmlMustHaveOutputClause",
                ),
                [],
                sql,
            );
        }
    });

    // Damaged input never invents the requirement.
    test("stays silent on malformed editor input", async () => {
        for (const sql of ["SELECT * FROM (INSERT dbo.Orders", "SELECT * FROM (DELETE"]) {
            assert.deepEqual(
                codes(await analyze(sql, { allowSyntaxDiagnostics: true })).filter(
                    (code) => code === "NestedDmlMustHaveOutputClause",
                ),
                [],
                sql,
            );
        }
    });
});

suite("T-SQL OUTPUT clause function validation", () => {
    // Exact output for a user-defined scalar function the catalog proves is not schema bound.
    test("reports a non-schemabound function with exact output", async () => {
        assert.deepEqual(await analyze("INSERT dbo.Orders (Id) OUTPUT dbo.LooseFn() VALUES (1);"), [
            {
                code: "FunctionNotAllowedInOutput",
                message:
                    "Function 'dbo.LooseFn' is not allowed in the OUTPUT clause, because it performs user or system data access, or is assumed to perform this access. A function is assumed by default to perform data access if it is not schemabound.",
                severity: "error",
                text: "dbo.LooseFn",
            },
        ]);
    });

    // A schema-bound function is allowed, and an unknown binding must not become a false positive.
    test("accepts schema-bound and unknown functions", async () => {
        assert.deepEqual(
            await analyze("INSERT dbo.Orders (Id) OUTPUT dbo.BoundFn() VALUES (1);"),
            [],
        );
        assert.deepEqual(
            await analyze("INSERT dbo.Orders (Id) OUTPUT dbo.UnknownFn() VALUES (1);"),
            [],
        );
    });

    // Every DML statement carrying an OUTPUT clause is covered, including OUTPUT INTO.
    test("covers every statement that carries an OUTPUT clause", async () => {
        for (const sql of [
            "UPDATE dbo.Orders SET Id = 1 OUTPUT dbo.LooseFn();",
            "DELETE dbo.Orders OUTPUT dbo.LooseFn();",
            "INSERT dbo.Orders (Id) OUTPUT dbo.LooseFn() INTO dbo.Orders VALUES (1);",
        ]) {
            assert.deepEqual(codes(await analyze(sql)), ["FunctionNotAllowedInOutput"], sql);
        }
    });

    // Built-in functions, pseudo-table columns, and functions outside OUTPUT stay silent.
    test("does not report unrelated expressions", async () => {
        for (const sql of [
            "INSERT dbo.Orders (Id) OUTPUT inserted.Id VALUES (1);",
            "INSERT dbo.Orders (Id) OUTPUT GETDATE() VALUES (1);",
            "SELECT dbo.LooseFn();",
            "UPDATE dbo.Orders SET Id = 1 WHERE Id = dbo.LooseFn();",
        ]) {
            assert.deepEqual(
                codes(await analyze(sql)).filter((code) => code === "FunctionNotAllowedInOutput"),
                [],
                sql,
            );
        }
    });

    // A function created in this document is newer than the pinned catalog generation.
    test("never reports against a function created in this document", async () => {
        assert.deepEqual(
            codes(
                await analyze(`CREATE FUNCTION dbo.LooseFn () RETURNS int AS BEGIN RETURN 1; END;
GO
INSERT dbo.Orders (Id) OUTPUT dbo.LooseFn() VALUES (1);`),
            ).filter((code) => code === "FunctionNotAllowedInOutput"),
            [],
        );
    });

    // Quoted names resolve to the same object and keep the written spelling in the message.
    test("handles quoted names", async () => {
        assert.deepEqual(
            (await analyze("INSERT dbo.Orders (Id) OUTPUT [dbo].[LooseFn]() VALUES (1);")).map(
                ({ code, text }) => [code, text],
            ),
            [["FunctionNotAllowedInOutput", "[dbo].[LooseFn]"]],
        );
    });
});

suite("T-SQL nested DML incremental equivalence", () => {
    // Incremental analysis of the same final text and generation must equal a fresh analysis.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const uri = "file:///nested-dml-incremental.sql";
        const first =
            "SELECT 1;\nGO\nSELECT * FROM (DELETE dbo.Orders OUTPUT deleted.Id) AS x (Id);\n";
        const final = "SELECT 1;\nGO\nSELECT * FROM (DELETE dbo.Orders) AS x (Id);\n";
        const initialSyntax = service.parse(new ImmutableTextSnapshot(uri, 1, first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        assert.deepEqual(initial.diagnostics, []);
        const change = {
            start: first.indexOf(" OUTPUT deleted.Id"),
            end: first.indexOf(" OUTPUT deleted.Id") + " OUTPUT deleted.Id".length,
            text: "",
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
        const normalize = (snapshot: SemanticSnapshot): string[] =>
            snapshot.diagnostics
                .map(({ code, message, range }) => `${code}:${range.start}:${range.end}:${message}`)
                .sort();
        assert.deepEqual(normalize(updated), normalize(fresh));
        assert.equal(normalize(fresh).length, 1);
    });
});
