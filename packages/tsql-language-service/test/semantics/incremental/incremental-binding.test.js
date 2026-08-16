/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    applyTextChanges,
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    LezerSyntaxService,
} = require("../../../dist/index.js");

suite("incremental semantic binding", () => {
    // An ordinary edit rebinds its GO batch and retains the two unchanged batch results.
    test("reuses unchanged batches around a fixed-width edit", () => {
        const sql = "SELECT 1;\nGO\nSELECT 2;\nGO\nSELECT 3;";
        const analysis = analyze(sql);
        const offset = sql.indexOf("2");
        const updated = update(analysis, { start: offset, end: offset + 1, text: "4" });
        const fresh = analyze(updated.document.text, analysis.metadata);

        assert.equal(updated.semantics.statistics.unitsReused, 2);
        assert.equal(updated.semantics.statistics.unitsRebound, 1);
        assertEquivalent(updated.semantics, fresh.semantics);
    });

    // Reused units after a growing edit must shift declarations, references, and diagnostics.
    test("shifts reusable semantic ranges after an insertion", () => {
        const sql =
            "SELECT 1;\nGO\nSELECT 2;\nGO\nSELECT c.Id FROM dbo.Customers AS c WHERE c.Id > 0;";
        const metadata = new InMemoryMetadataProvider({
            objects: [
                {
                    ref: { id: "customers" },
                    schema: "dbo",
                    name: "Customers",
                    kind: "table",
                },
            ],
            columns: new Map([
                ["customers", [{ name: "Id", typeDisplay: "int", nullable: false }]],
            ]),
        });
        const analysis = analyze(sql, metadata);
        const offset = sql.indexOf("2");
        const updated = update(analysis, { start: offset, end: offset + 1, text: "200" });
        const fresh = analyze(updated.document.text, metadata);

        assert.equal(updated.semantics.statistics.unitsReused, 2);
        assert.equal(updated.semantics.statistics.unitsRebound, 1);
        assertEquivalent(updated.semantics, fresh.semantics);
    });

    // Changing exported DDL invalidates every later batch whose local catalog view can change.
    test("invalidates dependent batches after local DDL changes", () => {
        const sql = "CREATE TABLE dbo.Work (Id int);\nGO\nSELECT Id FROM dbo.Work;\nGO\nSELECT 1;";
        const analysis = analyze(sql, new InMemoryMetadataProvider({ schemas: [{ name: "dbo" }] }));
        const offset = sql.indexOf("Work");
        const updated = update(analysis, {
            start: offset,
            end: offset + "Work".length,
            text: "Gone",
        });
        const fresh = analyze(updated.document.text, analysis.metadata);

        assert.equal(updated.semantics.statistics.unitsReused, 0);
        assert.equal(updated.semantics.statistics.unitsRebound, 3);
        assert.deepEqual(
            updated.semantics.diagnostics.map(({ code, message }) => ({ code, message })),
            [{ code: "MSSQL208", message: "Invalid object name 'dbo.Work'." }],
        );
        assertEquivalent(updated.semantics, fresh.semantics);
    });

    // A query-only edit reuses the document DDL timeline while validating against the local table.
    test("retains local DDL visibility while incrementally validating a later batch", () => {
        const sql =
            "CREATE TABLE dbo.Work (Id int);\nGO\nSELECT Missing FROM dbo.Work;\nGO\nSELECT 1;";
        const metadata = new InMemoryMetadataProvider({ schemas: [{ name: "dbo" }] });
        const analysis = analyze(sql, metadata);
        const offset = sql.indexOf("Missing");
        const updated = update(analysis, {
            start: offset,
            end: offset + "Missing".length,
            text: "Unknown",
        });
        const fresh = analyze(updated.document.text, metadata);

        assert.equal(updated.semantics.statistics.unitsReused, 2);
        assert.equal(updated.semantics.statistics.unitsRebound, 1);
        assertEquivalent(updated.semantics, fresh.semantics);
    });

    // SELECT INTO exports a relation just like CREATE TABLE, so renaming it invalidates consumers.
    test("invalidates dependent batches after SELECT INTO changes", () => {
        const sql = "SELECT 1 AS Id INTO dbo.First;\nGO\nSELECT Id FROM dbo.First;";
        const metadata = new InMemoryMetadataProvider({ schemas: [{ name: "dbo" }] });
        const analysis = analyze(sql, metadata);
        const offset = sql.indexOf("First");
        const updated = update(analysis, {
            start: offset,
            end: offset + "First".length,
            text: "Other",
        });
        const fresh = analyze(updated.document.text, metadata);

        assert.equal(updated.semantics.statistics.unitsReused, 0);
        assert.equal(updated.semantics.statistics.unitsRebound, 2);
        assertEquivalent(updated.semantics, fresh.semantics);
    });

    // A new pinned catalog generation must never inherit results from the previous generation.
    test("rebinds every unit when metadata changes", () => {
        const sql = "SELECT * FROM dbo.NewTable;\nGO\nSELECT 1;";
        const metadata = new InMemoryMetadataProvider();
        const analysis = analyze(sql, metadata);
        metadata.replace({
            objects: [
                {
                    ref: { id: "new-table" },
                    schema: "dbo",
                    name: "NewTable",
                    kind: "table",
                },
            ],
        });
        const semantics = analysis.binder.update(analysis.semantics, {
            syntax: analysis.syntax,
            metadata: metadata.pin(),
            previous: analysis.semantics,
            changedRanges: [],
        });

        assert.equal(semantics.statistics.unitsReused, 0);
        assert.equal(semantics.statistics.unitsRebound, 2);
        assert.deepEqual(semantics.diagnostics, []);
    });
});

function analyze(sql, metadata = new InMemoryMetadataProvider()) {
    const document = new ImmutableTextSnapshot("file:///incremental-binding.sql", 1, sql);
    const syntaxService = new LezerSyntaxService();
    const binder = new CatalogSemanticBinder();
    const syntax = syntaxService.parse(document);
    const semantics = binder.bind({ syntax, metadata: metadata.pin() });
    return { document, syntaxService, binder, metadata, syntax, semantics };
}

function update(analysis, change) {
    const document = applyTextChanges(analysis.document, 2, [change]);
    const syntax = analysis.syntaxService.update(analysis.syntax, document, [change]);
    const semantics = analysis.binder.update(analysis.semantics, {
        syntax,
        metadata: analysis.metadata.pin(),
        previous: analysis.semantics,
        changedRanges: syntax.changedRanges,
    });
    return { ...analysis, document, syntax, semantics };
}

function assertEquivalent(actual, expected) {
    assert.deepEqual(actual.units, expected.units);
    assert.deepEqual(actual.diagnostics, expected.diagnostics);
}
