/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { readdirSync, readFileSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
    TsqlLanguageFeatureService,
    collectFoldingRanges,
} = require("../../../dist/index.js");
const { describeRanges, script } = require("../../support/foldingHarness.js");

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

function countingSyntaxService() {
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

async function openFeatures(text, syntax = new LezerSyntaxService()) {
    const metadata = new NullMetadataProvider();
    const runtime = new InProcessLanguageServiceRuntime(
        syntax,
        new CatalogSemanticBinder(),
        metadata,
    );
    const snapshot = await runtime.open(uri, 1, text);
    return { runtime, snapshot, features: new TsqlLanguageFeatureService(runtime, metadata) };
}

function sqlFixtures() {
    const root = resolve("test/fixtures/real-world-sql");
    const files = [];
    const walk = (directory) => {
        for (const entry of readdirSync(directory)) {
            const path = join(directory, entry);
            if (statSync(path).isDirectory()) walk(path);
            else if (entry.endsWith(".sql")) files.push(path);
        }
    };
    walk(root);
    return files;
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

    test("holds its contract over every real-world fixture", async () => {
        const files = sqlFixtures();
        assert.ok(files.length > 0);
        for (const file of files) {
            const text = readFileSync(file, "utf8");
            const { features, snapshot } = await openFeatures(text);
            const ranges = features.foldingRanges(uri, 1);
            const open = [];
            let previousStartLine = -1;
            for (const range of ranges) {
                const startLine = snapshot.syntax.document.positionAt(range.start).line;
                const endLine = snapshot.syntax.document.positionAt(range.end).line;
                assert.ok(range.start >= 0 && range.end <= text.length, `${file}: out of bounds`);
                assert.ok(endLine > startLine, `${file}: single-line range at ${startLine}`);
                assert.ok(startLine > previousStartLine, `${file}: unsorted or repeated start`);
                previousStartLine = startLine;
                while (open.length > 0 && open.at(-1) < range.start) open.pop();
                if (open.length > 0) assert.ok(range.end <= open.at(-1), `${file}: overlap`);
                open.push(range.end);
            }
        }
    });
});
