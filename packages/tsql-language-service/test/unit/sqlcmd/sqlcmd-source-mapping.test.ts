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
    SourceMappedColorizationService,
    SourceMappedFeatureService,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
    sqlCmdDirectiveDescriptors,
} from "../../../src/index.ts";
import { defined } from "../support/assertions.ts";

const uri = "file:///mapped.sql";

function metadata(): InMemoryMetadataProvider {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        objects: [
            {
                ref: { id: "customers", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Customers",
                kind: "table",
            },
        ],
        columns: new Map([
            [
                "customers",
                [
                    { name: "Id", typeDisplay: "int", nullable: false },
                    { name: "Name", typeDisplay: "nvarchar(100)", nullable: true },
                ],
            ],
        ]),
    });
}

async function open(sql: string) {
    const provider = metadata();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open(uri, 1, sql);
    const inner = new TsqlLanguageFeatureService(runtime, provider);
    return {
        snapshot,
        runtime,
        inner,
        mapped: new SourceMappedFeatureService(inner, runtime),
        sql,
    };
}

suite("SQLCMD source mapping for feature results", () => {
    // Every supported directive is removed from the SQL projection through the same map. This
    // exhaustive matrix prevents a newly registered command from accidentally making positional
    // features address unrelated SQL at the directive's now-shorter numeric offset.
    test("keeps every feature neutral inside every supported directive", async () => {
        const directives = [
            ...sqlCmdDirectiveDescriptors.map((descriptor) => directiveExample(descriptor.name)),
            "!! echo never-executed",
        ];

        for (const directive of directives) {
            const sql = `${directive}\nDECLARE @value int;\nSELECT COUNT(Id)\nFROM dbo.Customers\nWHERE Id = @value;\nSELECT * FROM dbo.;\n`;
            const { inner, mapped, snapshot } = await open(sql);
            const offset = Math.min(directive.length - 1, Math.max(1, directive.indexOf(":") + 1));

            assert.deepEqual(mapped.completion(uri, 1, offset), { items: [], incomplete: false });
            assert.equal(mapped.hover(uri, 1, offset), undefined);
            assert.deepEqual(mapped.definition(uri, 1, offset), []);
            assert.deepEqual(mapped.definitionTarget(uri, 1, offset), { locations: [] });
            assert.deepEqual(mapped.references(uri, 1, offset), []);
            assert.equal(mapped.prepareRename(uri, 1, offset), undefined);
            assert.deepEqual(mapped.rename(uri, 1, offset, "replacement"), []);
            assert.deepEqual(mapped.selectionRanges(uri, 1, [offset]), []);
            assert.equal(mapped.signatureHelp(uri, 1, offset), undefined);

            const colors = new SourceMappedColorizationService(new TsqlColorizationService());
            const inside = colors.provideRangeColors({
                ...snapshot,
                range: { start: 0, end: directive.length },
            });
            assert.deepEqual(inside.tokens, [], directive);

            // The SQL immediately after the removed line remains reachable for positional and
            // structural features, proving that neutral handling is limited to the directive.
            const tableOffset = sql.indexOf("Customers") + 1;
            const variableOffset = sql.lastIndexOf("@value") + 1;
            const completionOffset = sql.lastIndexOf("dbo.") + "dbo.".length;
            assert.match(
                mapped.hover(uri, 1, tableOffset)?.markdown ?? "",
                /Customers/u,
                directive,
            );
            assert.ok(mapped.selectionRanges(uri, 1, [tableOffset]).length > 0, directive);
            const projectedCompletionOffset = snapshot.projection.toProjected(
                uri,
                completionOffset,
            );
            assert.notEqual(projectedCompletionOffset, undefined, directive);
            assert.deepEqual(
                mapped.completion(uri, 1, completionOffset).items.map((item) => item.label),
                inner
                    .completion(
                        uri,
                        1,
                        defined(
                            projectedCompletionOffset,
                            "expected a projected completion offset",
                        ),
                    )
                    .items.map((item) => item.label),
                directive,
            );
            assert.ok(mapped.definition(uri, 1, variableOffset).length > 0, directive);
            assert.ok(
                mapped.definitionTarget(uri, 1, variableOffset).locations.length > 0,
                directive,
            );
            assert.ok(mapped.references(uri, 1, variableOffset).length > 0, directive);
            assert.ok(mapped.prepareRename(uri, 1, variableOffset), directive);
            assert.ok(mapped.rename(uri, 1, variableOffset, "@renamed").length > 0, directive);
            assert.ok(mapped.signatureHelp(uri, 1, sql.indexOf("COUNT(") + 6), directive);
            for (const range of mapped.foldingRanges(uri, 1)) {
                assert.ok(
                    range.start >= directive.length,
                    `${directive}: ${JSON.stringify(range)}`,
                );
            }
            for (const token of colors.provideDocumentColors(snapshot).tokens) {
                assert.ok(
                    token.start >= directive.length,
                    `${directive}: ${JSON.stringify(token)}`,
                );
            }
        }
    });

    // A document with no SQLCMD syntax projects itself, so the wrapper must be transparent: the
    // identity case is detected by reference and returns the inner result untouched.
    test("passes an ordinary document straight through", async () => {
        const sql = "SELECT Id FROM dbo.Customers;";
        const { inner, mapped } = await open(sql);
        const offset = sql.indexOf("Id");

        assert.deepEqual(
            mapped.completion(uri, 1, offset).items.map(({ label, edit }) => ({ label, edit })),
            inner.completion(uri, 1, offset).items.map(({ label, edit }) => ({ label, edit })),
        );
        assert.deepEqual(mapped.foldingRanges(uri, 1), inner.foldingRanges(uri, 1));
    });

    // The directive line disappears from the projection, so every projected offset is shifted.
    // A host asking about a source offset must still be answered about the right token.
    test("converts a host offset into the projected document", async () => {
        const sql = ":setvar unused 1\nSELECT Name FROM dbo.Customers;\n";
        const { mapped } = await open(sql);

        const hover = mapped.hover(uri, 1, sql.indexOf("Customers"));
        assert.ok(hover, "the caret lands on the table in projected coordinates");
        assert.match(hover.markdown, /Customers/u);
        assert.deepEqual(hover.range, {
            start: sql.indexOf("dbo.Customers"),
            end: sql.indexOf("dbo.Customers") + "dbo.Customers".length,
        });
    });

    // A diagnostic's range is produced in projected coordinates. Published unmapped it would
    // underline the wrong characters in every SQLCMD document.
    test("maps a diagnostic range back to the source", async () => {
        const sql = ":setvar unused 1\nSELECT Id FROM dbo.Missing;\n";
        const { inner, mapped } = await open(sql);

        const projected = defined(
            inner.diagnostics(uri, 1).semantic[0],
            "expected a projected diagnostic",
        );
        const source = defined(
            mapped.diagnostics(uri, 1).semantic[0],
            "expected a source-mapped diagnostic",
        );
        assert.equal(source.code, "MSSQL208");
        assert.notDeepEqual(source.range, projected.range, "the projection shifted the offsets");
        assert.equal(sql.slice(source.range.start, source.range.end), "dbo.Missing");
    });

    // A completion edit is written back into the file. An edit whose span came from inside a
    // substitution cannot be written without changing the variable, so no edit is offered rather
    // than one that corrupts the document.
    test("drops a completion edit that would land inside a substitution", async () => {
        const sql = ":setvar tbl Customers\nSELECT Id FROM dbo.$(tbl);\n";
        const { mapped } = await open(sql);

        for (const item of mapped.completion(uri, 1, sql.indexOf("$(tbl)") + 3).items) {
            if (!item.edit) continue;
            assert.ok(
                sql.slice(item.edit.start, item.edit.end) !== "",
                "an offered edit names real source text",
            );
            assert.ok(item.edit.start >= 0 && item.edit.end <= sql.length);
        }
    });

    // Folding ranges are structural, so they map cleanly and must stay inside the source document.
    test("keeps folding ranges inside the source document", async () => {
        const sql = ":setvar unused 1\nSELECT Id,\n  Name\nFROM dbo.Customers;\n";
        const { mapped } = await open(sql);

        for (const range of mapped.foldingRanges(uri, 1)) {
            assert.ok(range.start >= 0 && range.end <= sql.length, JSON.stringify(range));
        }
    });

    // Directive text has no projected position. Falling back to the same numeric offset would
    // address unrelated SQL in the shorter projected document, so position-based features must
    // return their neutral response without invoking analysis at an invented position.
    test("returns neutral feature results inside removed directive text", async () => {
        const sql = ":setvar unused 1\nSELECT Id FROM dbo.Customers;\n";
        const { mapped } = await open(sql);
        const offset = sql.indexOf("unused");

        assert.deepEqual(mapped.completion(uri, 1, offset), { items: [], incomplete: false });
        assert.equal(mapped.hover(uri, 1, offset), undefined);
        assert.deepEqual(mapped.definition(uri, 1, offset), []);
        assert.deepEqual(mapped.definitionTarget(uri, 1, offset), { locations: [] });
        assert.deepEqual(mapped.references(uri, 1, offset), []);
        assert.equal(mapped.prepareRename(uri, 1, offset), undefined);
        assert.deepEqual(mapped.rename(uri, 1, offset, "replacement"), []);
        assert.deepEqual(mapped.selectionRanges(uri, 1, [offset]), []);
        assert.equal(mapped.signatureHelp(uri, 1, offset), undefined);
    });

    // A mapped full result cannot be passed back to a projected-coordinate token diff: includes
    // may drop tokens and substitutions may coalesce them. Until projected baselines carry their
    // own opaque identity, a SQLCMD edit is safely represented by a complete mapped result.
    test("returns a full mapped color result for SQLCMD edits", async () => {
        const sql = ":setvar schema dbo\nSELECT Id FROM $(schema).Customers;\n";
        const { snapshot, runtime } = await open(sql);
        const colors = new SourceMappedColorizationService(new TsqlColorizationService());
        const previous = colors.provideDocumentColors(snapshot);
        assert.match(previous.resultId, /^source:/u);
        const start = sql.indexOf("Id");
        const edited = await runtime.change(uri, 1, 2, [{ start, end: start + 2, text: "Name" }]);

        const update = colors.provideColorEdits(previous, edited, [
            { start, end: start + 2, text: "Name" },
        ]);
        assert.equal(update.kind, "full");
        assert.deepEqual(update, colors.provideDocumentColors(edited));
    });

    // A viewport entirely inside a directive has no projected range and therefore no colors.
    test("does not project a color range inside directive text", async () => {
        const sql = ":setvar unused 1\nSELECT Id FROM dbo.Customers;\n";
        const { snapshot } = await open(sql);
        const colors = new SourceMappedColorizationService(new TsqlColorizationService());
        const start = sql.indexOf("unused");
        const result = colors.provideRangeColors({
            ...snapshot,
            range: { start, end: start + "unused".length },
        });

        assert.equal(result.kind, "full");
        assert.deepEqual(result.tokens, []);
    });
});

function directiveExample(name: string): string {
    switch (name) {
        case ":connect":
            return ":connect localhost";
        case ":error":
            return ":error stderr";
        case ":exit":
            return ":exit";
        case ":on error":
            return ":on error ignore";
        case ":out":
        case ":perftrace":
            return `${name} output.txt`;
        case ":r":
            return ":r missing.sql";
        case ":setvar":
            return ":setvar schema dbo";
        case ":xml":
            return ":xml on";
        default:
            return name;
    }
}
