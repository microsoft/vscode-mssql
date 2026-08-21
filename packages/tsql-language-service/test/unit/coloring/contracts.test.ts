/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    InProcessLanguageServiceRuntime,
    TsqlColorizationService,
    sqlColorTokenModifiers,
    sqlColorTokenTypes,
} from "../../../src/index.ts";
import { colorize } from "../support/coloringHarness.ts";

suite("coloring contracts", () => {
    test("publishes one stable SQL coloring legend", () => {
        assert.equal(new Set(sqlColorTokenTypes).size, sqlColorTokenTypes.length);
        assert.equal(new Set(sqlColorTokenModifiers).size, sqlColorTokenModifiers.length);
        assert.ok(sqlColorTokenTypes.includes("keyword"));
        assert.ok(sqlColorTokenTypes.includes("table"));
        assert.ok(sqlColorTokenTypes.includes("column"));
        assert.ok(sqlColorTokenTypes.includes("variable"));
        assert.ok(sqlColorTokenModifiers.includes("declaration"));
        assert.ok(sqlColorTokenModifiers.includes("write"));
    });

    test("the service publishes the legend it classifies with", async () => {
        const { service, tokens } = await colorize("SELECT 1;");
        assert.deepEqual(service.legend.tokenTypes, sqlColorTokenTypes);
        assert.deepEqual(service.legend.tokenModifiers, sqlColorTokenModifiers);
        for (const token of tokens) {
            assert.ok(
                sqlColorTokenTypes.includes(token.tokenType),
                `unpublished token type ${token.tokenType}`,
            );
            for (const modifier of token.modifiers) {
                assert.ok(
                    sqlColorTokenModifiers.includes(modifier),
                    `unpublished modifier ${modifier}`,
                );
            }
        }
    });

    test("returns versioned full, range, and incremental results", async () => {
        const runtime = new InProcessLanguageServiceRuntime();
        const first = await runtime.open("file:///colors.sql", 1, "SELECT 1;");
        const service = new TsqlColorizationService();
        const full = service.provideDocumentColors(first);
        const range = service.provideRangeColors({ ...first, range: { start: 0, end: 6 } });
        assert.equal(full.kind, "full");
        assert.equal(full.documentVersion, 1);
        assert.equal(range.kind, "full");
        assert.deepEqual(
            range.tokens.map((token) => token.tokenType),
            ["keyword"],
        );

        const change = { start: 7, end: 8, text: "2" };
        const second = await runtime.change("file:///colors.sql", 1, 2, [change]);
        const delta = service.provideColorEdits(full, second, [change]);
        assert.equal(delta.kind, "delta");
        assert.equal(delta.previousResultId, full.resultId);
        assert.equal(delta.documentVersion, 2);
        assert.notEqual(delta.resultId, full.resultId);
    });

    test("a result identifies the snapshot and range it was produced from", async () => {
        const { result } = await colorize("SELECT 1;");
        assert.equal(result.resultId, "1:1:0-9");
        assert.equal(result.metadataGeneration, 1);
    });

    test("rejects mismatched syntax and semantic snapshots", async () => {
        const { snapshot, service } = await colorize("SELECT 1;");
        const mismatched = {
            ...snapshot,
            semantics: { ...snapshot.semantics, documentVersion: 99 },
        };
        assert.throws(
            () => service.provideDocumentColors(mismatched),
            /Colorization snapshot mismatch/u,
        );
    });

    test("rejects a range outside the document", async () => {
        const { snapshot, service } = await colorize("SELECT 1;");
        assert.throws(
            () => service.provideRangeColors({ ...snapshot, range: { start: 0, end: 100 } }),
            RangeError,
        );
        assert.throws(
            () => service.provideRangeColors({ ...snapshot, range: { start: 5, end: 2 } }),
            RangeError,
        );
    });

    test("tokens are sorted, non-empty, non-overlapping, and inside the document", async () => {
        const sql = [
            "-- lead",
            "DECLARE @id int = 1;",
            "SELECT c.Name, COUNT(*) FROM dbo.Customers AS c WHERE c.Id = @id;",
        ].join("\n");
        const { tokens } = await colorize(sql);
        assert.ok(tokens.length > 0);
        let previousEnd = 0;
        for (const token of tokens) {
            assert.ok(token.start >= previousEnd, "tokens must be sorted and non-overlapping");
            assert.ok(token.end > token.start, "tokens must be non-empty");
            assert.ok(token.end <= sql.length, "tokens must stay inside the document");
            previousEnd = token.end;
        }
    });
});
