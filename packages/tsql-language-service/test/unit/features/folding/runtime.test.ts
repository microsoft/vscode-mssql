/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
    TsqlLanguageFeatureService,
    collectFoldingRanges,
    type SyntaxService,
} from "../../../../src/index.ts";
import { describeRanges, script } from "../../support/foldingHarness.ts";
import { defined } from "../../support/assertions.ts";

const uri = "file:///folding-runtime.sql";
const document = script(
    "-- #region report",
    "CREATE PROCEDURE dbo.usp_Report",
    "    @from date",
    "AS",
    "BEGIN",
    "    SELECT",
    "        Id",
    "    FROM dbo.Orders;",
    "END",
    "-- #endregion",
);

const representativeDocuments = [
    document,
    script(
        "WITH numbered AS (",
        "    SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS id",
        "    FROM sys.objects AS first",
        "    CROSS JOIN sys.objects AS second",
        ")",
        "SELECT id",
        "FROM numbered;",
    ),
    script(
        "BEGIN TRY",
        "    SELECT T.Spec",
        "    FROM dbo.Products AS p",
        "    CROSS APPLY p.XmlData.nodes('/product/specs/*') AS T(Spec);",
        "END TRY",
        "BEGIN CATCH",
        "    THROW;",
        "END CATCH;",
    ),
];

function countingSyntaxService(): {
    readonly counts: { parse: number; update: number };
    readonly service: SyntaxService;
} {
    const inner = new LezerSyntaxService();
    const counts = { parse: 0, update: 0 };
    return {
        counts,
        service: {
            parse(text) {
                counts.parse++;
                return inner.parse(text);
            },
            update(previous, text, changes) {
                counts.update++;
                return inner.update(previous, text, changes);
            },
        },
    };
}

async function openFeatures(text: string, syntax: SyntaxService = new LezerSyntaxService()) {
    const metadata = new NullMetadataProvider();
    const runtime = new InProcessLanguageServiceRuntime(
        syntax,
        new CatalogSemanticBinder(),
        metadata,
    );
    const snapshot = await runtime.open(uri, 1, text);
    return { runtime, snapshot, features: new TsqlLanguageFeatureService(runtime, metadata) };
}

suite("folding through the feature service", () => {
    test("serves the ranges of the published snapshot", async () => {
        const { features, snapshot } = await openFeatures(document);
        assert.deepEqual(features.foldingRanges(uri, 1), collectFoldingRanges(snapshot.syntax));
        assert.deepEqual(describeRanges(features.foldingRanges(uri, 1), snapshot.syntax), [
            "0-9 region",
            "1-8 code",
            "4-8 code",
            "5-7 code",
        ]);
    });

    test("rejects a stale document version", async () => {
        const { features } = await openFeatures(document);
        assert.throws(() => features.foldingRanges(uri, 2), /Stale document request/u);
    });

    test("folds an edited document exactly like a freshly opened one", async () => {
        const { features, runtime } = await openFeatures(document);
        const start = document.indexOf("        Id");
        const change = { start, end: start + 10, text: "        Id,\n        Total" };
        await runtime.change(uri, 1, 2, [change]);
        const edited = features.foldingRanges(uri, 2);

        const text = document.slice(0, change.start) + change.text + document.slice(change.end);
        const fresh = await openFeatures(text);
        assert.deepEqual(edited, fresh.features.foldingRanges(uri, 1));
    });

    test("folding performs no parse of its own", async () => {
        const counting = countingSyntaxService();
        const { features } = await openFeatures(document, counting.service);
        assert.deepEqual(counting.counts, { parse: 1, update: 0 });
        features.foldingRanges(uri, 1);
        features.foldingRanges(uri, 1);
        assert.deepEqual(counting.counts, { parse: 1, update: 0 });
    });

    test("keeps ranges ordered and nested across representative documents", async () => {
        for (const text of representativeDocuments) {
            const { features, snapshot } = await openFeatures(text);
            const ranges = features.foldingRanges(uri, 1);
            const open: number[] = [];
            let previousStartLine = -1;
            for (const range of ranges) {
                const startLine = snapshot.syntax.document.positionAt(range.start).line;
                const endLine = snapshot.syntax.document.positionAt(range.end).line;
                assert.ok(range.start >= 0 && range.end <= text.length, "range out of bounds");
                assert.ok(endLine > startLine, `single-line range at ${startLine}`);
                assert.ok(startLine > previousStartLine, "unsorted or repeated range start");
                previousStartLine = startLine;
                while (open.length > 0 && defined(open.at(-1)) < range.start) open.pop();
                if (open.length > 0) {
                    assert.ok(range.end <= defined(open.at(-1)), "overlapping ranges");
                }
                open.push(range.end);
            }
        }
    });
});
