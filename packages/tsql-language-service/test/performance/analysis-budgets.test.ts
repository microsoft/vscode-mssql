/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { suite, test } from "node:test";
import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlColorizationService,
    TsqlLanguageFeatureService,
    type MetadataProvider,
} from "../../src/index.ts";

const uri = "file:///budgets.sql";
const statement =
    "SELECT c.Id, c.Name FROM dbo.Customers AS c" +
    " JOIN dbo.Orders AS o ON o.CustomerId = c.Id WHERE c.Id > 1;\n";

function document(lines: number): string {
    return statement.repeat(lines);
}

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

function runtimeFor(provider: MetadataProvider): InProcessLanguageServiceRuntime {
    return new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
}

/** Median of repeated attempts; a lucky best-of sample must never make a regression look green. */
async function median(
    attempts: number,
    action: (attempt: number) => unknown | Promise<unknown>,
): Promise<number> {
    const values: number[] = [];
    for (let attempt = 0; attempt < attempts; attempt++) {
        const started = performance.now();
        await action(attempt);
        values.push(performance.now() - started);
    }
    values.sort((left, right) => left - right);
    const medianValue = values[Math.floor(values.length / 2)];
    if (medianValue === undefined) throw new Error("Median requires at least one attempt.");
    return medianValue;
}

suite("analysis budgets", () => {
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

    test("rebinds against new metadata without reparsing", async () => {
        const provider = metadata();
        const text = document(400);
        const service = runtimeFor(provider);
        const opened = await service.open(uri, 1, text);

        const rebound = await service.rebind(uri, 1);
        assert.equal(rebound.syntax, opened.syntax);
        assert.equal(rebound.text, opened.text);
        assert.notEqual(rebound.semantics, opened.semantics);
    });

    test("builds the semantic model once per snapshot", async () => {
        const provider = metadata();
        const snapshot = await runtimeFor(provider).open(uri, 1, document(200));

        const first = snapshot.semantics.model;
        const second = snapshot.semantics.model;
        assert.equal(first, second, "the model is cached rather than rebuilt per reader");

        const repeated = await median(5, () => snapshot.semantics.model.scopes.length);
        assert.ok(repeated < 5, `a cached model read took ${repeated.toFixed(2)} ms`);
    });

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

    test("retains bounded memory for an analysed document", async (context) => {
        if (typeof globalThis.gc !== "function") {
            context.skip("run with --expose-gc to measure retention");
            return;
        }
        const provider = metadata();
        const text = document(400);
        globalThis.gc();
        const before = process.memoryUsage().heapUsed;
        const service = runtimeFor(provider);
        const snapshot = await service.open(uri, 1, text);
        assert.ok(snapshot.semantics.model.scopes.length >= 0);
        globalThis.gc();
        const retained = process.memoryUsage().heapUsed - before;

        assert.ok(
            retained < text.length * 200,
            `retained ${retained} bytes for ${text.length} characters`,
        );
    });
});
