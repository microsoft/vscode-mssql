/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} from "../../../src/index.ts";

function runtime(): InProcessLanguageServiceRuntime {
    return new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
            objects: [
                {
                    ref: { id: "customers", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "Customers",
                    kind: "table",
                },
            ],
            columns: new Map([["customers", [{ name: "Id", typeDisplay: "int" }]]]),
        }),
    );
}

suite("SQLCMD projection in the analysis snapshot", () => {
    // An ordinary .sql file pays nothing for the projection layer: the projected snapshot is the
    // source snapshot, so a caller can compare by reference to learn the coordinates agree.
    test("projects an ordinary document as itself", async () => {
        const snapshot = await runtime().open(
            "file:///plain.sql",
            1,
            "SELECT Id FROM dbo.Customers;",
        );

        assert.equal(snapshot.projection.usesSqlCmd, false);
        assert.equal(snapshot.projectedText, snapshot.text);
        assert.deepEqual(snapshot.syntax.diagnostics, []);
    });

    // A directive and a substitution are read before the parser, so neither reaches the grammar and
    // neither can become a phantom SQL error.
    test("parses the projected SQL rather than the directives", async () => {
        const text = ":setvar tbl Customers\nSELECT Id FROM dbo.$(tbl);\n";
        const snapshot = await runtime().open("file:///vars.sql", 1, text);

        assert.equal(snapshot.projection.usesSqlCmd, true);
        assert.equal(snapshot.projectedText.text, "\nSELECT Id FROM dbo.Customers;\n");
        assert.notEqual(snapshot.projectedText, snapshot.text);
        assert.deepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(snapshot.projection.diagnostics, []);
    });

    // A substitution changes the text length, so a projected range maps back to the reference the
    // user actually wrote instead of to a character position that does not exist in the source.
    test("maps a projected range back to the written reference", async () => {
        const text = ":setvar tbl Customers\nSELECT Id FROM dbo.$(tbl);\n";
        const snapshot = await runtime().open("file:///vars.sql", 1, text);
        const start = snapshot.projectedText.text.indexOf("Customers");

        const [source] = snapshot.sourceRangeOf({ start, end: start + "Customers".length });
        assert.equal(source?.documentUri, "file:///vars.sql");
        assert.equal(text.slice(source?.start, source?.end), "$(tbl)");
        assert.equal(source?.approximate, true);
    });

    // An unresolved variable stays exactly as written, so it can never be reported as a missing
    // object; the SQLCMD layer reports it as the SQLCMD problem it is.
    test("keeps an unresolved variable out of the object namespace", async () => {
        const snapshot = await runtime().open(
            "file:///unresolved.sql",
            1,
            "SELECT Id FROM dbo.$(missing);\n",
        );

        assert.match(snapshot.projectedText.text, /\$\(missing\)/u);
        assert.ok(
            snapshot.projection.diagnostics.length > 0,
            "the unresolved reference is a SQLCMD diagnostic",
        );
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(({ code }) => code === "MSSQL208"),
            [],
        );
    });

    // The projection follows edits, and a document that stops using SQLCMD returns to the identity
    // projection rather than keeping a stale rewritten text.
    test("re-projects after an edit", async () => {
        const service = runtime();
        const text = ":setvar tbl Customers\nSELECT Id FROM dbo.$(tbl);\n";
        await service.open("file:///edit.sql", 1, text);

        const edited = await service.change("file:///edit.sql", 1, 2, [
            { start: 12, end: 21, text: "Orders" },
        ]);
        assert.equal(edited.projectedText.text, "\nSELECT Id FROM dbo.Orders;\n");

        const cleared = await service.change("file:///edit.sql", 2, 3, [
            { start: 0, end: edited.text.length, text: "SELECT 1;" },
        ]);
        assert.equal(cleared.projection.usesSqlCmd, false);
        assert.equal(cleared.projectedText, cleared.text);
    });
});
