/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as api from "../../../../src/index.ts";
import type { InMemoryMetadataInput, SemanticSnapshot } from "../../../../src/index.ts";
// CREATE EXTERNAL STREAM carries a fixed named parameter set. Every stream must declare a data
// source, and no parameter may be given twice. Both rules read the parsed parameter nodes, so a
// repeat is reported at the parameter that repeats and an absence across the whole statement.
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = api;

const catalog = {
    environment: { currentDatabase: "db", defaultSchema: "dbo" },
    schemas: [{ database: "db", name: "dbo" }],
    databases: [{ name: "db" }],
} satisfies InMemoryMetadataInput;

async function analyze(sql: string, options: { readonly allowSyntaxDiagnostics?: boolean } = {}) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider(catalog),
    );
    const snapshot = await runtime.open("file:///external-stream.sql", 1, sql);
    if (!options.allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics.map(({ code, message, severity, range }) => ({
        code,
        message,
        severity,
        text: sql.slice(range.start, range.end),
    }));
}

const codes = (diagnostics: readonly { readonly code: string }[]): string[] =>
    diagnostics.map(({ code }) => code);

suite("T-SQL external stream parameter validation", () => {
    // Exact output when the required data source is absent, ranged across the statement.
    test("reports a missing required parameter with exact output", async () => {
        const sql = "CREATE EXTERNAL STREAM dbo.Events WITH (LOCATION = 'events');";
        assert.deepEqual(await analyze(sql), [
            {
                code: "RequiredParam",
                message: "The external stream option 'DATA_SOURCE' must be included in the ddl.",
                severity: "error",
                text: sql.slice(0, -1),
            },
        ]);
    });

    // Exact output when a parameter repeats, ranged at the repeat rather than the first use.
    test("reports a repeated parameter with exact output", async () => {
        assert.deepEqual(
            await analyze(
                "CREATE EXTERNAL STREAM dbo.Events WITH (DATA_SOURCE = src, DATA_SOURCE = other);",
            ),
            [
                {
                    code: "DuplicateParam",
                    message: "The external stream option 'DATA_SOURCE' is already included in ddl.",
                    severity: "error",
                    text: "DATA_SOURCE = other",
                },
            ],
        );
        // Every repeat after the first is reported, and each parameter is tracked separately.
        assert.deepEqual(
            (
                await analyze(
                    "CREATE EXTERNAL STREAM dbo.Events WITH (DATA_SOURCE = src, LOCATION = 'a', LOCATION = 'b', LOCATION = 'c');",
                )
            ).map(({ code, text }) => [code, text]),
            [
                ["DuplicateParam", "LOCATION = 'b'"],
                ["DuplicateParam", "LOCATION = 'c'"],
            ],
        );
    });

    // A complete parameter list, with and without the optional input row shape, stays silent.
    test("accepts a complete parameter list", async () => {
        for (const sql of [
            "CREATE EXTERNAL STREAM dbo.Events WITH (DATA_SOURCE = src);",
            "CREATE EXTERNAL STREAM dbo.Events WITH (DATA_SOURCE = src, LOCATION = 'events', FILE_FORMAT = fmt);",
            "CREATE EXTERNAL STREAM dbo.Events WITH (DATA_SOURCE = src, INPUT_OPTIONS = 'a', OUTPUT_OPTIONS = 'b');",
            "CREATE EXTERNAL STREAM dbo.Events (Id int, Body nvarchar(max)) WITH (DATA_SOURCE = src);",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Parameter names are matched without regard to case or quoting.
    test("matches parameter names case-insensitively", async () => {
        assert.deepEqual(await analyze("CREATE EXTERNAL STREAM s WITH (data_source = src);"), []);
        assert.deepEqual(
            codes(
                await analyze(
                    "CREATE EXTERNAL STREAM s WITH ([DATA_SOURCE] = a, data_source = b);",
                ),
            ),
            ["DuplicateParam"],
        );
    });

    // A name outside the parameter set is not one of these rules' concern.
    test("ignores names outside the parameter set", async () => {
        assert.deepEqual(
            codes(await analyze("CREATE EXTERNAL STREAM s WITH (DATA_SOURCE = src, BOGUS = x);")),
            [],
        );
        assert.deepEqual(
            codes(await analyze("CREATE EXTERNAL STREAM s WITH (BOGUS = x, BOGUS = y);")),
            ["RequiredParam"],
        );
    });

    // Unrelated external statements keep their own shapes.
    test("does not report unrelated statements", async () => {
        for (const sql of [
            "DROP EXTERNAL STREAM dbo.Events;",
            "CREATE EXTERNAL FILE FORMAT fmt WITH (FORMAT_TYPE = DELIMITEDTEXT);",
            "CREATE EXTERNAL DATA SOURCE src WITH (LOCATION = 'x');",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Damaged input never invents a parameter result.
    test("stays silent on malformed editor input", async () => {
        for (const sql of [
            "CREATE EXTERNAL STREAM dbo.Events WITH (",
            "CREATE EXTERNAL STREAM dbo.Events WITH (DATA_SOURCE =",
            "CREATE EXTERNAL STREAM",
        ]) {
            assert.deepEqual(await analyze(sql, { allowSyntaxDiagnostics: true }), [], sql);
        }
    });
});

suite("T-SQL external stream incremental equivalence", () => {
    // Incremental analysis of the same final text and generation must equal a fresh analysis.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const uri = "file:///external-stream-incremental.sql";
        const first = "SELECT 1;\nGO\nCREATE EXTERNAL STREAM s WITH (DATA_SOURCE = src);\n";
        const final = "SELECT 1;\nGO\nCREATE EXTERNAL STREAM s WITH (LOCATION = 'src');\n";
        const initialSyntax = service.parse(new ImmutableTextSnapshot(uri, 1, first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        assert.deepEqual(initial.diagnostics, []);
        const change = {
            start: first.indexOf("DATA_SOURCE = src"),
            end: first.indexOf("DATA_SOURCE = src") + "DATA_SOURCE = src".length,
            text: "LOCATION = 'src'",
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
