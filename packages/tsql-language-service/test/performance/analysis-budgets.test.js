/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
} = require("../../dist/index.js");

const uri = "file:///budgets.sql";

/**
 * Latency and allocation gates for the four things an editor does constantly.
 *
 * The thresholds are deliberately loose: a gate exists to catch an order-of-magnitude regression on
 * a shared build machine, not to police a few milliseconds. What it protects is the shape of the
 * cost — an edit must not cost what a full open costs, and a viewport must not cost what the whole
 * document costs — because that shape is what keeps typing responsive.
 */
const statement =
    "SELECT c.Id, c.Name FROM dbo.Customers AS c" +
    " JOIN dbo.Orders AS o ON o.CustomerId = c.Id WHERE c.Id > 1;\n";

function document(lines) {
    return statement.repeat(lines);
}

function metadata() {
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
            {
                ref: { id: "orders", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Orders",
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
            [
                "orders",
                [
                    { name: "CustomerId", typeDisplay: "int", nullable: false },
                    { name: "Total", typeDisplay: "money", nullable: true },
                ],
            ],
        ]),
    });
}

function runtimeFor(provider) {
    return new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
}

/** Median of repeated attempts; a lucky best-of sample must never make a regression look green. */
async function median(attempts, action) {
    const values = [];
    for (let attempt = 0; attempt < attempts; attempt++) {
        const started = performance.now();
        await action(attempt);
        values.push(performance.now() - started);
    }
    values.sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)];
}

suite("analysis budgets", () => {
    // Opening a document is the one operation allowed to cost the whole document.
    test("opens a large document within the interactive budget", async () => {
        const provider = metadata();
        const text = document(400);
        const elapsed = await median(3, async (attempt) => {
            await runtimeFor(provider).open(`${uri}#${attempt}`, 1, text);
        });
        assert.ok(
            elapsed < 2_000,
            `opening ${text.length} characters took ${elapsed.toFixed(1)} ms`,
        );
    });

    // An edit must cost a fraction of an open. This is the property incremental reuse exists for,
    // so a regression that quietly reparses everything shows up here rather than as "feels slow".
    test("costs far less to edit than to open", async () => {
        const provider = metadata();
        const text = document(400);
        const service = runtimeFor(provider);
        await service.open(uri, 1, text);

        const openElapsed = await median(3, async (attempt) => {
            await runtimeFor(provider).open(`${uri}#open${attempt}`, 1, text);
        });

        let version = 1;
        const editElapsed = await median(5, async () => {
            const at = text.length - 1;
            version++;
            await service.change(uri, version - 1, version, [
                { start: at, end: at, text: version % 2 === 0 ? " " : "\n" },
            ]);
        });

        assert.ok(
            editElapsed < openElapsed,
            `an edit cost ${editElapsed.toFixed(1)} ms against an open of ${openElapsed.toFixed(1)} ms`,
        );
    });

    // A viewport request must not cost the whole document. Colouring is the feature a host asks
    // for on every scroll, so this is the one that has to stay proportional to what is visible.
    test("colors a viewport for a fraction of the document cost", async () => {
        const provider = metadata();
        const text = document(400);
        const snapshot = await runtimeFor(provider).open(uri, 1, text);
        const coloring = new TsqlColorizationService();

        const fullElapsed = await median(3, () => coloring.provideDocumentColors(snapshot));
        const viewport = { start: 0, end: Math.min(text.length, statement.length * 10) };
        const rangeElapsed = await median(5, () =>
            coloring.provideRangeColors({ ...snapshot, range: viewport }),
        );

        assert.ok(
            rangeElapsed <= fullElapsed,
            `a viewport cost ${rangeElapsed.toFixed(1)} ms against ${fullElapsed.toFixed(1)} ms`,
        );
    });

    // Rebinding after metadata arrives must not reparse. The parse is the expensive half, and a
    // catalog that finishes loading should not cost the user a reparse of what they are typing.
    test("rebinds against new metadata without reparsing", async () => {
        const provider = metadata();
        const text = document(400);
        const service = runtimeFor(provider);
        const opened = await service.open(uri, 1, text);

        const rebound = await service.rebind(uri, 1);
        // The parse is reused by identity, which is the only way to prove it was not redone.
        assert.equal(rebound.syntax, opened.syntax);
        assert.equal(rebound.text, opened.text);
        assert.notEqual(rebound.semantics, opened.semantics);
    });

    // The semantic model is published with the snapshot and reused by every feature request.
    test("builds the semantic model once per snapshot", async () => {
        const provider = metadata();
        const snapshot = await runtimeFor(provider).open(uri, 1, document(200));

        const first = snapshot.semantics.model;
        const second = snapshot.semantics.model;
        assert.equal(first, second, "the model is cached rather than rebuilt per reader");

        const repeated = await median(5, () => snapshot.semantics.model.scopes.length);
        assert.ok(repeated < 5, `a cached model read took ${repeated.toFixed(2)} ms`);
    });

    // Completion is asked on nearly every keystroke, so it has its own gate rather than relying on
    // the open budget it sits behind.
    test("answers completion inside a keystroke budget", async () => {
        const provider = metadata();
        const text = document(400);
        const service = runtimeFor(provider);
        await service.open(uri, 1, text);
        const features = new TsqlLanguageFeatureService(service, provider);

        const started = performance.now();
        features.completion(uri, 1, text.length - 2);
        const first = performance.now() - started;
        const warm = await median(5, () => features.completion(uri, 1, text.length - 2));
        assert.ok(first < 1_000, `first completion took ${first.toFixed(1)} ms`);
        assert.ok(warm < 500, `warm completion took ${warm.toFixed(1)} ms`);
    });

    // An allocation gate, expressed as retained heap rather than as a count: analysing a document
    // must not retain a multiple of its own text. Skipped when the runner did not expose gc.
    test("retains bounded memory for an analysed document", async (t) => {
        if (typeof globalThis.gc !== "function") {
            t.skip("run with --expose-gc to measure retention");
            return;
        }
        const provider = metadata();
        const text = document(400);
        globalThis.gc();
        const before = process.memoryUsage().heapUsed;
        const service = runtimeFor(provider);
        const snapshot = await service.open(uri, 1, text);
        // Touch the model so the measurement includes it rather than only the parse.
        assert.ok(snapshot.semantics.model.scopes.length >= 0);
        globalThis.gc();
        const retained = process.memoryUsage().heapUsed - before;

        assert.ok(
            retained < text.length * 200,
            `retained ${retained} bytes for ${text.length} characters`,
        );
    });
});
