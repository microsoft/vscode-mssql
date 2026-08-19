/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = require("../../../dist/index.js");

const uri = "file:///routine-matrix.sql";

/**
 * A catalog with a table-valued function in the connected database and one under `master.sys`,
 * so a four-part name and a cross-database system routine are both answerable.
 */
function metadata() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [
            { database: "db", name: "dbo" },
            { database: "master", name: "sys" },
        ],
        databases: [{ name: "db" }, { name: "master" }],
        objects: [
            {
                ref: { id: "rows", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Rows",
                kind: "tableFunction",
            },
            {
                ref: { id: "providers", database: "master" },
                database: "master",
                schema: "sys",
                name: "dm_cryptographic_provider_algorithms",
                kind: "tableFunction",
                system: true,
            },
        ],
        parameters: new Map([
            ["rows", [{ ordinal: 1, name: "@id", typeDisplay: "int", hasDefault: false }]],
            [
                "providers",
                [{ ordinal: 1, name: "@ProviderId", typeDisplay: "int", hasDefault: false }],
            ],
        ]),
        columns: new Map([
            ["rows", [{ name: "Id", typeDisplay: "int" }]],
            ["providers", [{ name: "algorithm_id", typeDisplay: "int" }]],
        ]),
    });
}

async function open(sql, provider = metadata()) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    return { runtime, provider, snapshot: await runtime.open(uri, 1, sql) };
}

suite("routine call matrix", () => {
    // The screenshot case: a system table-valued function under `master.sys`, called with the one
    // argument it requires, through the three- and four-part names a user actually writes.
    test("binds a system table-valued function under master.sys", async () => {
        for (const sql of [
            "SELECT * FROM master.sys.dm_cryptographic_provider_algorithms(10);",
            "SELECT * FROM master.sys.dm_cryptographic_provider_algorithms(10) AS a;",
        ]) {
            const { snapshot } = await open(sql);
            assert.deepEqual(snapshot.syntax.diagnostics, [], sql);
            assert.deepEqual(
                snapshot.semantics.diagnostics.map(({ code }) => code),
                [],
                sql,
            );
        }

        // The same routine with no argument is still a missing argument, not a silent pass.
        const { snapshot } = await open(
            "SELECT * FROM master.sys.dm_cryptographic_provider_algorithms();",
        );
        assert.deepEqual(
            snapshot.semantics.diagnostics.map(({ code }) => code),
            ["InsufficientArguments"],
        );
    });

    // A four-part name reaches a linked server, which the service has no catalog for. It must not
    // be reported as a missing local object, and it must not be validated as if it were one.
    test("leaves a four-part routine name to the remote server", async () => {
        const { snapshot } = await open("SELECT * FROM remote.db.dbo.Rows(1);");
        assert.deepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(({ code }) =>
                ["InsufficientArguments", "TooManyArguments", "MSSQL208"].includes(code),
            ),
            [],
        );
    });

    // Binding must not depend on how the snapshot was reached. An edit that changes only the
    // argument list has to leave the document saying exactly what a fresh parse says.
    test("agrees between a fresh bind and an incremental one", async () => {
        const before = "SELECT * FROM dbo.Rows(1);";
        const after = "SELECT * FROM dbo.Rows(1, 2);";
        const { runtime } = await open(before);

        const edited = await runtime.change(uri, 1, 2, [
            { start: before.indexOf("(1)") + 2, end: before.indexOf("(1)") + 2, text: ", 2" },
        ]);
        assert.equal(edited.text.text, after);

        const { snapshot: fresh } = await open(after);
        assert.deepEqual(
            edited.semantics.diagnostics.map(({ code, message, range }) => ({
                code,
                message,
                range,
            })),
            fresh.semantics.diagnostics.map(({ code, message, range }) => ({
                code,
                message,
                range,
            })),
        );

        // The bound call has to match too, not only the diagnostics it produced.
        const offset = after.indexOf("Rows");
        const incrementalCall = edited.semantics.model.callAt(offset);
        const freshCall = fresh.semantics.model.callAt(offset);
        assert.equal(incrementalCall.arguments.length, freshCall.arguments.length);
        assert.deepEqual(incrementalCall.target, freshCall.target);
        assert.deepEqual(edited.semantics.symbolAt(offset), fresh.semantics.symbolAt(offset));
    });

    // Editing inside one argument list must not disturb what an unrelated batch resolved to.
    test("keeps unrelated batches stable across an argument-list edit", async () => {
        const before = ["SELECT * FROM dbo.Rows(1);", "GO", "SELECT * FROM dbo.Rows(2);"].join(
            "\n",
        );
        const { runtime } = await open(before);
        const insertAt = before.indexOf("(1)") + 2;

        const edited = await runtime.change(uri, 1, 2, [
            { start: insertAt, end: insertAt, text: ", 9" },
        ]);
        const after = edited.text.text;
        const { snapshot: fresh } = await open(after);

        assert.deepEqual(
            edited.semantics.diagnostics.map(({ code, range }) => ({ code, range })),
            fresh.semantics.diagnostics.map(({ code, range }) => ({ code, range })),
        );
        // Both calls are still bound, and the untouched one still resolves to the same routine.
        const untouched = after.lastIndexOf("dbo.Rows");
        assert.deepEqual(
            edited.semantics.model.callAt(untouched).target,
            fresh.semantics.model.callAt(untouched).target,
        );
    });
});
